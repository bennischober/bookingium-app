import { singleton, inject } from 'tsyringe'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { getSqlite } from '../db'
import { latestMigrationMillis, migrateOtherDatabase } from '../db/migrate'
import { getStorageBasePath } from '../utils/fileStorage'
import { isInsideFolder } from '../backup/files'
import { SyncEngine, createGroup, type EngineOptions, type RunResult } from '../sync/engine'
import { prepareJoin } from '../sync/join'
import { FolderTransport } from '../sync/transport'
import { configureRowIds } from '../sync/ids'
import { dropSyncTriggers, getMeta, hasBookkeeping } from '../sync/store'
import { BackupService, backupLocations } from './BackupService'
import type { SyncFolderDto, SyncJoinDto, SyncStatusDto } from '../api/schemas/sync.schema'

/** The first run waits until startup is over */
const STARTUP_DELAY_MS = 5_000
/** While the app runs, it syncs this often */
const RUN_INTERVAL_MS = 20_000
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
        devices = (await new FolderTransport(state.folder).listDevices()).map((d) => ({
          id: d.id,
          name: d.name,
          self: d.id === state.deviceId,
          appVersion: d.appVersion
        }))
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
      conflicts
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

  private startTimers(): void {
    this.stopTimers()
    const tick = () => {
      void this.run()
    }
    this.timers.push(setTimeout(tick, STARTUP_DELAY_MS), setInterval(tick, RUN_INTERVAL_MS))
    for (const timer of this.timers) timer.unref()
  }

  private stopTimers(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
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
          `Der Abgleich-Ordner ist nicht erreichbar: ${state.folder}. Läuft Google Drive?`
        )
      const { changedHere, ...result } = await engine.run()
      this.update({
        lastRunAt: at,
        lastSuccessAt: at,
        lastError: null,
        lastResult: result,
        lastExportSeq: Math.max(state.lastExportSeq, engine.exportSeq)
      })
      if (changedHere) this.host.onChanged()
    } catch (error) {
      this.update({ lastRunAt: at, lastError: errorMessage(error) })
    }
  }

  /** On quit: the last changes out, waiting a few seconds at most */
  async stop(): Promise<void> {
    this.stopTimers()
    if (!this.engine) return
    await Promise.race([this.run(), new Promise((done) => setTimeout(done, STOP_TIMEOUT_MS))])
  }
}
