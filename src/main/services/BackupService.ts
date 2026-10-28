import { singleton } from 'tsyringe'
import { existsSync, statSync } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { getSqlite, isDbOpen } from '../db'
import { latestMigrationMillis } from '../db/migrate'
import { getStorageBasePath } from '../utils/fileStorage'
import { BACKUP_RETENTION, isBackupDue } from '../backup/policy'
import {
  applyStagedRestore,
  cancelRestore,
  isInsideFolder,
  prepareRestore,
  pruneBackups,
  readBackupState,
  stageRestore,
  writeBackup,
  writeBackupState,
  type BackupState,
  type DataLocations,
  type RestoreManifest
} from '../backup/files'
import type { BackupStatusDto } from '../api/schemas/backup.schema'

/** The first check waits until startup is over */
const STARTUP_DELAY_MS = 30_000
/** While the app runs, it checks hourly whether the daily backup is due */
const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Database, storage and the backup work folder inside a data folder (userData) */
export function backupLocations(userData: string): DataLocations {
  return {
    dataDir: join(userData, 'data'),
    storageDir: join(userData, 'storage'),
    workDir: join(userData, 'backup')
  }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/**
 * Automatic backups into a folder the user chose (typically synced by OneDrive or Dropbox), the
 * manual "Sicherung erstellen…", and restoring a backup.
 *
 * When: at start (after a delay) once the last success is about a day old, and then hourly while
 * the app runs, so an app left open for days still backs up daily. Not on close: quitting would
 * wait for the copy, and a shutdown would cut it off.
 */
// One instance: it owns the timers and the running backup
@singleton()
export class BackupService {
  private running: Promise<BackupState> | null = null
  private timers: NodeJS.Timeout[] = []
  private appVersion = ''

  private storageDir(): string {
    return getStorageBasePath()
  }

  /** The data folder; its storage/ is the one the app uses */
  private userData(): string {
    return dirname(this.storageDir())
  }

  private workDir(): string {
    return backupLocations(this.userData()).workDir
  }

  private snapshotDb = (file: string) => getSqlite().backup(file)

  status(): BackupStatusDto {
    return {
      ...readBackupState(this.workDir()),
      running: this.running !== null,
      retention: BACKUP_RETENTION
    }
  }

  private update(change: Partial<BackupState>): void {
    writeBackupState(this.workDir(), { ...readBackupState(this.workDir()), ...change })
  }

  /** Sets the target folder and switches automatic backups on */
  setFolder(folder: string): BackupStatusDto {
    if (!existsSync(folder) || !statSync(folder).isDirectory())
      throw new Error(`Ordner nicht gefunden: ${folder}`)
    if (isInsideFolder(folder, this.userData()))
      throw new Error('Bitte einen Ordner außerhalb des Bookingium-Datenordners wählen.')
    this.update({ folder, enabled: true })
    return this.status()
  }

  setEnabled(enabled: boolean): BackupStatusDto {
    if (enabled && !readBackupState(this.workDir()).folder)
      throw new Error('Bitte zuerst einen Ordner wählen.')
    this.update({ enabled })
    return this.status()
  }

  /** An automatic backup now, if switched on and due; null when none was needed */
  runIfDue(now = new Date()): Promise<BackupState> | null {
    const state = readBackupState(this.workDir())
    if (!state.enabled || !state.folder || !isBackupDue(state.lastSuccessAt, now)) return null
    return this.run(now)
  }

  /**
   * An automatic backup into the chosen folder, then the retention. Never throws: the outcome
   * is in the returned state (lastError). A second call while one runs joins it.
   */
  run(now = new Date()): Promise<BackupState> {
    if (!this.running) {
      this.running = this.backUp(now).finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async backUp(now: Date): Promise<BackupState> {
    const { folder } = readBackupState(this.workDir())
    try {
      if (!folder) throw new Error('Kein Ordner für die Sicherung gewählt.')
      const written = await writeBackup({
        parent: folder,
        snapshotDb: this.snapshotDb,
        storageDir: this.storageDir(),
        workDir: this.workDir(),
        kind: 'auto',
        now,
        appVersion: this.appVersion
      })
      this.update({
        lastAttemptAt: now.toISOString(),
        lastSuccessAt: now.toISOString(),
        lastFolder: written,
        lastError: null
      })
      // A failed cleanup leaves one backup too many; the next run tries again
      await pruneBackups(folder, now).catch((error) =>
        console.error('Removing old backups failed:', error)
      )
    } catch (error) {
      this.update({ lastAttemptAt: now.toISOString(), lastError: errorMessage(error) })
    }
    return readBackupState(this.workDir())
  }

  /** "Sicherung erstellen…": a backup into any folder, never deleted by the retention */
  createManualBackup(parent: string, now = new Date()): Promise<string> {
    return writeBackup({
      parent,
      snapshotDb: this.snapshotDb,
      storageDir: this.storageDir(),
      workDir: this.workDir(),
      kind: 'manual',
      now,
      appVersion: this.appVersion
    })
  }

  /** Copies and checks a backup; nothing is replaced until confirmRestore */
  prepareRestore(source: string): Promise<RestoreManifest> {
    return prepareRestore(source, this.workDir(), latestMigrationMillis())
  }

  cancelRestore(): Promise<void> {
    return cancelRestore(this.workDir())
  }

  /**
   * Backs up the current state, then stages the prepared restore for the next start. The caller
   * restarts the app; until then nothing is replaced.
   */
  async confirmRestore(now = new Date()): Promise<{ beforeRestoreFolder: string }> {
    await this.running
    const parent = join(this.workDir(), 'before-restore')
    await mkdir(parent, { recursive: true })
    const beforeRestoreFolder = await writeBackup({
      parent,
      snapshotDb: this.snapshotDb,
      storageDir: this.storageDir(),
      workDir: this.workDir(),
      kind: 'before-restore',
      now,
      appVersion: this.appVersion
    })
    await stageRestore(this.workDir())
    this.update({ beforeRestoreFolder })
    return { beforeRestoreFolder }
  }

  /**
   * Applies a staged restore. Called at startup before anything opens the database; the
   * outcome is shown in the settings.
   */
  applyStagedRestore(now = new Date()): void {
    if (isDbOpen()) throw new Error('A restore must be applied before the database opens')
    const outcome = applyStagedRestore(backupLocations(this.userData()), now)
    if (!outcome) return
    if (outcome.error) console.error('Restoring a backup failed:', outcome.error)
    this.update({ lastRestore: outcome })
  }

  /** Starts the startup check and the hourly one */
  start(appVersion: string): void {
    this.appVersion = appVersion
    const check = () => {
      void this.runIfDue()
    }
    this.timers.push(setTimeout(check, STARTUP_DELAY_MS), setInterval(check, CHECK_INTERVAL_MS))
    for (const timer of this.timers) timer.unref()
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer)
    this.timers = []
  }
}
