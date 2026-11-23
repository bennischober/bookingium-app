import { singleton, inject } from 'tsyringe'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  watch,
  writeFileSync,
  type FSWatcher
} from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { getSqlite } from '../db'
import { latestMigrationMillis, migrateOtherDatabase } from '../db/migrate'
import { getStorageBasePath } from '../utils/fileStorage'
import { isInsideFolder } from '../backup/files'
import { SyncEngine, createGroup, type EngineOptions, type RunResult } from '../sync/engine'
import { prepareJoin } from '../sync/join'
import { FolderTransport } from '../sync/transport'
import { latestOf } from '../sync/format'
import { cloudRoots, findSyncFolders } from '../sync/findFolders'
import { configureRowIds } from '../sync/ids'
import { isLocalSettingKey } from '../sync/tables'
import { dropSyncTriggers, getMeta, hasBookkeeping, syncedTables } from '../sync/store'
import { listChannels, revokeChannel, runChannel, type BridgeEnv } from '../staff/bridge'
import { readdirSync, rmSync } from 'fs'
import { BackupService, backupLocations } from './BackupService'
import type {
  SyncBriefDto,
  SyncFolderDto,
  SyncJoinDto,
  SyncStatusDto
} from '../api/schemas/sync.schema'

/** The first run waits until startup is over */
const STARTUP_DELAY_MS = 5_000
/** While the app runs, it syncs this often at the latest */
const RUN_INTERVAL_MS = 20_000
/** Own changes are looked for this often and go out right away */
const LOCAL_CHECK_MS = 2_000
/** Files arriving in the shared folder (or a wake-up) start a run after this pause */
const NUDGE_DELAY_MS = 1_500
/** Looking for a sync group in the cloud folders again at most this often */
const SUGGEST_TTL_MS = 60_000
/** Quitting waits at most this long for the last changes to go out */
const STOP_TIMEOUT_MS = 5_000

/** Machine-local settings and status (sync/state.json in the data folder, not the database) */
export type SyncState = {
  enabled: boolean
  /** The shared folder, '' for none */
  folder: string
  /** This computer's id in the group, as the database must say too */
  deviceId: string | null
  /** The highest batch number this computer wrote; a database behind it was restored */
  lastExportSeq: number
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  lastResult: Omit<RunResult, 'changedHere'> | null
  /** Set when the identity changed (a backup was restored), for the settings page */
  reidentifiedAt: string | null
}

export const EMPTY_SYNC_STATE: SyncState = {
  enabled: false,
  folder: '',
  deviceId: null,
  lastExportSeq: 0,
  lastRunAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastResult: null,
  reidentifiedAt: null
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** What the app passes in at start: no Electron in services */
export type SyncHost = {
  appVersion: string
  deviceName: string
  /** Removes a file another computer deleted; the app moves it to the trash */
  removeFile: (file: string) => Promise<void>
  /** Data changed from elsewhere: windows refresh, the calendar file is rewritten */
  onChanged: () => void
  /** Another computer's batches wait for a newer version: the app looks for an update */
  onNewerVersionElsewhere?: () => void
}

/**
 * Keeps this computer's data in step with the others through a shared folder (src/main/sync):
 * setting up the first computer, joining further ones (their data merged in, like a restore with
 * a restart), and the run every few seconds while the app is open.
 */
@singleton()
export class SyncService {
  private engine: SyncEngine | null = null
  private running: Promise<void> | null = null
  private timers: NodeJS.Timeout[] = []
  private watcher: FSWatcher | null = null
  private nudgeTimer: NodeJS.Timeout | null = null
  private suggested: { at: number; folders: Promise<SyncFolderDto[]> } | null = null
  private host: SyncHost = {
    appVersion: '',
    deviceName: 'Computer',
    removeFile: async () => {},
    onChanged: () => {}
  }

  constructor(@inject(BackupService) private backups: BackupService) {}

  private userData(): string {
    return dirname(getStorageBasePath())
  }

  private stateFile(): string {
    return join(this.userData(), 'sync', 'state.json')
  }

  readState(): SyncState {
    try {
      return {
        ...EMPTY_SYNC_STATE,
        ...(JSON.parse(readFileSync(this.stateFile(), 'utf-8')) as object)
      }
    } catch {
      return { ...EMPTY_SYNC_STATE }
    }
  }

  private update(change: Partial<SyncState>): SyncState {
    const state = { ...this.readState(), ...change }
    const file = this.stateFile()
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(`${file}.tmp`, file)
    return state
  }

  private options(folder: string): EngineOptions {
    return {
      sqlite: getSqlite(),
      transport: new FolderTransport(folder),
      storageDir: getStorageBasePath(),
      schema: latestMigrationMillis(),
      appVersion: this.host.appVersion,
      deviceName: this.host.deviceName,
      removeFile: (file) => this.host.removeFile(file)
    }
  }

  private checkFolder(folder: string): void {
    if (!existsSync(folder) || !statSync(folder).isDirectory())
      throw new Error(`Ordner nicht gefunden: ${folder}`)
    if (isInsideFolder(folder, this.userData()))
      throw new Error('Bitte einen Ordner außerhalb des Bookingium-Datenordners wählen.')
  }

  // ---------- status ----------

  async status(): Promise<SyncStatusDto> {
    const state = this.readState()
    const sqlite = getSqlite()
    const synced = this.engine !== null && hasBookkeeping(sqlite)
    const conflicts = synced
      ? (sqlite
          .prepare('SELECT id, at, message FROM sync_conflict ORDER BY id DESC LIMIT 20')
          .all() as Array<{ id: number; at: string; message: string }>)
      : []
    const pending = synced
      ? (
          sqlite
            .prepare(
              'SELECT (SELECT COUNT(*) FROM sync_change) + (SELECT COUNT(*) FROM sync_outbox) AS n'
            )
            .get() as {
            n: number
          }
        ).n
      : 0
    let devices: SyncStatusDto['devices'] = []
    if (state.enabled && state.folder) {
      try {
        const transport = new FolderTransport(state.folder)
        const listed = await transport.listDevices()
        devices = await Promise.all(
          listed.map(async (d) => {
            const lastBatchAt = await transport.deviceLastBatchAt(d.id)
            return {
              id: d.id,
              name: d.name,
              self: d.id === state.deviceId,
              appVersion: d.appVersion,
              createdAt: d.createdAt,
              lastBatchAt,
              lastSeenAt: latestOf(d.lastSeenAt ?? null, lastBatchAt),
              // this computer is never an earlier entry, even next to a newer one of its name
              superseded:
                d.id !== state.deviceId &&
                listed.some(
                  (other) =>
                    other.id !== d.id && other.name === d.name && other.createdAt > d.createdAt
                )
            }
          })
        )
      } catch {
        devices = []
      }
    }
    return {
      enabled: state.enabled,
      active: this.engine !== null,
      folder: state.folder,
      deviceId: state.deviceId,
      running: this.running !== null,
      lastRunAt: state.lastRunAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      newerVersionElsewhere: state.lastResult?.newerVersionElsewhere ?? false,
      waitingFiles: state.lastResult?.waitingFiles ?? 0,
      pendingChanges: pending,
      reidentifiedAt: state.reidentifiedAt,
      devices,
      conflicts,
      suggestions: state.enabled ? [] : await this.suggestions()
    }
  }

  /** The top bar's view: no folder reading, so it can be asked every few seconds */
  async brief(): Promise<SyncBriefDto> {
    const state = this.readState()
    const suggestions = state.enabled ? [] : await this.suggestions()
    return {
      enabled: state.enabled,
      active: this.engine !== null,
      running: this.running !== null,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      pendingChanges: this.engine ? this.localChangeCount() : 0,
      suggestedFolder: suggestions.find((folder) => folder.kind === 'group')?.folder ?? ''
    }
  }

  /** Sync groups in this computer's OneDrive, Google Drive or Dropbox (cached for a minute) */
  private suggestions(): Promise<SyncFolderDto[]> {
    // e2e runs never look into the real OneDrive of the computer they run on
    if (process.env.BOOKINGIUM_NO_SYNC_DISCOVERY === '1') return Promise.resolve([])
    if (!this.suggested || Date.now() - this.suggested.at > SUGGEST_TTL_MS) {
      const folders = findSyncFolders(cloudRoots(process.env, homedir()))
        .then((found) =>
          Promise.all(found.map((folder) => this.inspectFolder(folder).catch(() => null)))
        )
        .then((inspected) => inspected.filter((folder): folder is SyncFolderDto => folder !== null))
        .catch(() => [] as SyncFolderDto[])
      this.suggested = { at: Date.now(), folders }
    }
    return this.suggested.folders
  }

  private localChangeCount(): number {
    try {
      return (
        getSqlite()
          .prepare(
            'SELECT (SELECT COUNT(*) FROM sync_change) + (SELECT COUNT(*) FROM sync_outbox) AS n'
          )
          .get() as { n: number }
      ).n
    } catch {
      return 0
    }
  }

  /** What the chosen folder holds: nothing yet (set up here) or a group (join it) */
  async inspectFolder(folder: string): Promise<SyncFolderDto> {
    this.checkFolder(folder)
    const transport = new FolderTransport(folder)
    const group = await transport.readGroup()
    if (!group) return { folder, kind: 'new', devices: [], snapshotCreatedAt: null }
    const devices = (await transport.listDevices()).map((d) => d.name)
    const snapshot = await transport.latestSnapshot()
    return { folder, kind: 'group', devices, snapshotCreatedAt: snapshot?.info.createdAt ?? null }
  }

  // ---------- setting up ----------

  /** The first computer: makes the folder the group's, with this computer's data as the start */
  async setUp(folder: string): Promise<SyncStatusDto> {
    this.checkFolder(folder)
    if (this.engine) throw new Error('Der Abgleich ist auf diesem Computer schon eingerichtet.')
    const tempFile = join(backupLocations(this.userData()).workDir, 'sync-snapshot.db')
    mkdirSync(dirname(tempFile), { recursive: true })
    const engine = await createGroup(this.options(folder), tempFile)
    this.engine = engine
    this.update({
      ...EMPTY_SYNC_STATE,
      enabled: true,
      folder,
      deviceId: engine.deviceId,
      lastSuccessAt: new Date().toISOString()
    })
    this.startTimers()
    return this.status()
  }

  /**
   * A further computer: merges this computer's data into the group's starting point and stages
   * the result like a restore (the current state is backed up first). The caller restarts the app.
   */
  async join(folder: string): Promise<SyncJoinDto> {
    this.checkFolder(folder)
    if (this.engine) throw new Error('Der Abgleich ist auf diesem Computer schon eingerichtet.')
    await this.running
    const workDir = backupLocations(this.userData()).workDir
    const prepared = await prepareJoin({
      transport: new FolderTransport(folder),
      liveSqlite: getSqlite(),
      liveStorage: getStorageBasePath(),
      workDir,
      schema: latestMigrationMillis(),
      migrate: migrateOtherDatabase
    })
    const { beforeRestoreFolder } = await this.backups.confirmRestore()
    this.update({ ...EMPTY_SYNC_STATE, enabled: true, folder, deviceId: prepared.device })
    const counts = Object.values(prepared.stats)
    return {
      beforeRestoreFolder,
      matched: counts.reduce((sum, s) => sum + s.matched, 0),
      inserted: counts.reduce((sum, s) => sum + s.inserted, 0)
    }
  }

  /** Stops syncing on this computer; joining again merges what changed meanwhile */
  /**
   * #243: removes a computer's earlier entry (the same computer joined again later) from the
   * folder, but only one that never wrote a change: nothing can get lost.
   */
  async removeDevice(id: string): Promise<SyncStatusDto> {
    const state = this.readState()
    if (!state.enabled || !state.folder) throw new Error('Der Abgleich ist nicht eingerichtet.')
    if (id === state.deviceId) throw new Error('Dieser Computer kann sich nicht selbst entfernen.')
    const transport = new FolderTransport(state.folder)
    const listed = await transport.listDevices()
    const device = listed.find((d) => d.id === id)
    if (!device) throw new Error('Diesen Eintrag gibt es im Ordner nicht mehr.')
    const superseded = listed.some(
      (other) => other.id !== id && other.name === device.name && other.createdAt > device.createdAt
    )
    if (!superseded) {
      throw new Error('Nur frühere Einträge eines Computers lassen sich entfernen.')
    }
    await transport.removeEmptyDevice(id)
    return this.status()
  }

  leave(): Promise<SyncStatusDto> {
    this.stopTimers()
    this.engine = null
    configureRowIds(null)
    dropSyncTriggers(getSqlite())
    this.update({ enabled: false })
    return this.status()
  }

  // ---------- running ----------

  /**
   * At startup, once the database has its final schema: checks that the database is the one the
   * group knows (a restored backup gets a new identity), switches the triggers and id range on
   * and starts the timers.
   */
  async start(host: SyncHost): Promise<void> {
    this.host = host
    const state = this.readState()
    if (!state.enabled || !state.folder) return
    const sqlite = getSqlite()
    if (!hasBookkeeping(sqlite) || !getMeta(sqlite, 'device_id')) {
      this.update({
        enabled: false,
        lastError:
          'Die Daten auf diesem Computer gehören zu keinem Abgleich mehr (zum Beispiel nach dem Wiederherstellen einer älteren Sicherung). Bitte dem Abgleich neu beitreten.'
      })
      return
    }
    const engine = new SyncEngine(this.options(state.folder))
    try {
      if (engine.deviceId !== state.deviceId || engine.exportSeq < state.lastExportSeq) {
        const { device } = await engine.reidentify()
        this.update({
          deviceId: device,
          lastExportSeq: 0,
          reidentifiedAt: new Date().toISOString()
        })
      } else {
        engine.activate()
      }
    } catch (error) {
      // the shared folder is not reachable right now: the next run tries again
      engine.activate()
      this.update({ lastError: errorMessage(error) })
    }
    this.engine = engine
    this.startTimers()
  }

  /**
   * Runs at startup, every few seconds at the latest, within seconds of an own change, and as
   * soon as another computer's files arrive in the shared folder
   */
  private startTimers(): void {
    this.stopTimers()
    const tick = () => {
      void this.run()
    }
    const checkLocal = () => {
      if (!this.running && this.localChangeCount() > 0) void this.run()
    }
    this.timers.push(
      setTimeout(tick, STARTUP_DELAY_MS),
      setInterval(tick, RUN_INTERVAL_MS),
      setInterval(checkLocal, LOCAL_CHECK_MS)
    )
    for (const timer of this.timers) timer.unref()
    this.watchFolder()
  }

  /** Another computer's batch or file landing in the shared folder starts a run */
  private watchFolder(): void {
    const { folder, deviceId } = this.readState()
    if (!folder) return
    const own = deviceId ? join('geraete', deviceId) : null
    try {
      this.watcher = watch(folder, { recursive: true }, (_event, file) => {
        const name = String(file ?? '')
        // own writes and half-written temporary files say nothing new
        if (own && name.startsWith(own)) return
        if (name.includes('.tmp-')) return
        this.nudge()
      })
      // never keeps the process alive on its own (tests, quitting)
      this.watcher.unref()
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      // a folder that cannot be watched (some network shares): the timer still runs
      this.watcher = null
    }
  }

  /** A run shortly: files arrived, the computer woke up, the window got the focus */
  nudge(): void {
    if (!this.engine) return
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer)
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null
      void this.run()
    }, NUDGE_DELAY_MS)
    this.nudgeTimer.unref()
  }

  private stopTimers(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
    if (this.nudgeTimer) clearTimeout(this.nudgeTimer)
    this.nudgeTimer = null
    this.watcher?.close()
    this.watcher = null
  }

  /** One run now; a second call while one runs joins it. Never throws (lastError) */
  run(): Promise<void> {
    if (!this.running) {
      this.running = this.runOnce().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async runOnce(): Promise<void> {
    const engine = this.engine
    const state = this.readState()
    if (!engine || !state.enabled) return
    const at = new Date().toISOString()
    try {
      if (!existsSync(state.folder))
        throw new Error(
          `Der Abgleich-Ordner ist nicht erreichbar: ${state.folder}. Läuft OneDrive bzw. Google Drive?`
        )
      // #262: an employee's computer whose access was taken away clears the company's data
      if (await this.revokedHere(state.folder)) return
      const { changedHere: changedBySync, ...result } = await engine.run()
      const changedByStaff = await this.runBridges()
      const changedHere = changedBySync || changedByStaff
      this.update({
        lastRunAt: at,
        lastSuccessAt: at,
        lastError: null,
        lastResult: result,
        lastExportSeq: Math.max(state.lastExportSeq, engine.exportSeq)
      })
      if (changedHere) this.host.onChanged()
      if (result.newerVersionElsewhere && !state.lastResult?.newerVersionElsewhere)
        this.host.onNewerVersionElsewhere?.()
    } catch (error) {
      this.update({ lastRunAt: at, lastError: errorMessage(error) })
    }
  }

  // ---------- employees (#262) ----------

  /** What the staff bridges of this computer need; only while this computer syncs */
  bridgeEnv(): BridgeEnv {
    const engine = this.engine
    if (!engine)
      throw new Error(
        'Für Mitarbeiter muss auf diesem Computer zuerst der Abgleich eingerichtet sein (Einstellungen › Daten › Abgleich). Das geht auch, wenn es nur dieser eine Computer ist.'
      )
    return {
      sqlite: getSqlite(),
      storageDir: getStorageBasePath(),
      schema: latestMigrationMillis(),
      appVersion: this.host.appVersion,
      deviceName: this.host.deviceName,
      adminDevice: engine.deviceId,
      adminPrefix: engine.prefix,
      workDir: backupLocations(this.userData()).workDir
    }
  }

  /** The id prefixes of the group's computers, so an employee's range differs from them */
  async takenPrefixes(): Promise<number[]> {
    const { folder } = this.readState()
    if (!folder) return []
    return (await new FolderTransport(folder).listDevices()).map((d) => d.prefix)
  }

  /** Serves the employees' folders this computer bridges; true when data changed here */
  private async runBridges(): Promise<boolean> {
    let env: BridgeEnv
    try {
      env = this.bridgeEnv()
    } catch {
      return false
    }
    let changed = false
    for (const channel of listChannels(env.sqlite)) {
      const employee = env.sqlite
        .prepare('SELECT id, name, id_prefix, revoked_at FROM employee WHERE id = ?')
        .get(channel.employee_id) as
        | { id: number; name: string; id_prefix: number; revoked_at: string | null }
        | undefined
      if (!employee || employee.revoked_at) {
        // removed or revoked on another admin computer
        await revokeChannel(env, channel.employee_id).catch(() => {})
        continue
      }
      const result = await runChannel(env, {
        id: employee.id,
        name: employee.name,
        idPrefix: employee.id_prefix
      })
      if (result.changedHere) changed = true
    }
    return changed
  }

  /**
   * On an employee's computer: when the admin took the access away, syncing stops and the
   * company's data (records and documents) is removed from this computer. Returns true then.
   */
  private async revokedHere(folder: string): Promise<boolean> {
    const sqlite = getSqlite()
    const row = sqlite.prepare("SELECT value FROM app_setting WHERE key = 'staffDevice'").get() as
      | { value: string }
      | undefined
    if (row?.value !== 'true') return false
    const revokedAt = await new FolderTransport(folder).readRevocation()
    if (!revokedAt) return false
    this.stopTimers()
    this.engine = null
    configureRowIds(null)
    dropSyncTriggers(sqlite)
    sqlite.pragma('foreign_keys = OFF')
    try {
      sqlite.pragma('secure_delete = ON')
      sqlite.transaction(() => {
        for (const table of syncedTables(sqlite)) {
          if (table === 'app_setting') continue
          sqlite.exec(`DELETE FROM "${table.replace(/"/g, '""')}"`)
        }
        // this computer's own settings (mail, calendar file) stay; it is no staff computer any more
        const keys = sqlite.prepare('SELECT key FROM app_setting').all() as Array<{ key: string }>
        const remove = sqlite.prepare('DELETE FROM app_setting WHERE key = ?')
        for (const { key } of keys)
          if (!isLocalSettingKey(key) || key.startsWith('staff')) remove.run(key)
        sqlite.exec('DELETE FROM sync_meta')
      })()
    } finally {
      sqlite.pragma('foreign_keys = ON')
    }
    sqlite.exec('VACUUM')
    const storage = getStorageBasePath()
    for (const name of existsSync(storage) ? readdirSync(storage) : [])
      rmSync(join(storage, name), { recursive: true, force: true })
    this.update({
      enabled: false,
      lastError: `Der Zugang dieses Computers wurde am ${new Date(revokedAt).toLocaleDateString('de-DE')} entzogen. Die Daten der Firma wurden von diesem Computer entfernt.`
    })
    this.host.onChanged()
    return true
  }

  /** On quit: the last changes out, waiting a few seconds at most */
  async stop(): Promise<void> {
    this.stopTimers()
    if (!this.engine) return
    await Promise.race([this.run(), new Promise((done) => setTimeout(done, STOP_TIMEOUT_MS))])
  }
}
