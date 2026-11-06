import { singleton } from 'tsyringe'
import { existsSync, statSync } from 'fs'
import { mkdir } from 'fs/promises'
import { dirname, join } from 'path'
import { getSqlite, isDbOpen } from '../db'
import { latestMigrationMillis } from '../db/migrate'
import { getStorageBasePath } from '../utils/fileStorage'
import { BACKUP_RETENTION, isBackupDue } from '../backup/policy'
import { DEFAULT_KDF, deriveBackupKey, type BackupKey, type KdfParams } from '../backup/encryption'
import {
  applyStagedRestore,
  cancelRestore,
  isEncryptedBackup,
  isInsideFolder,
  prepareRestore,
  readBackupMarker,
  pruneBackups,
  pruneBeforeRestore,
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
 * #54: keeps the backup key on this computer between backups. In the app it is Electron's
 * safeStorage (the Windows account's protection); services do not import Electron, so index.ts
 * passes it in. Tests pass a fake.
 */
export type KeyStore = {
  available(): boolean
  seal(plain: string): string
  open(sealed: string): string
}

const KEY_UNREADABLE =
  'Die Sicherungen sind mit Passwort verschlüsselt, der Schlüssel lässt sich auf diesem Rechner aber nicht lesen. Bitte in den Einstellungen das Passwort neu setzen.'

/** The folder of an encrypted backup the user picked, and what its marker says */
export type EncryptedRestorePick = { folder: string; backupCreatedAt: string | null }

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
  private keyStore: KeyStore | null = null
  /** #54: an encrypted backup picked for a restore, waiting for its password */
  private pendingEncrypted: string | null = null

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
    // the sealed key stays in the main process
    const { encryption, ...state } = readBackupState(this.workDir())
    return {
      ...state,
      encrypted: encryption !== null,
      encryptedSince: encryption?.since ?? null,
      encryptionAvailable: this.keyStore?.available() ?? false,
      running: this.running !== null,
      retention: BACKUP_RETENTION
    }
  }

  setKeyStore(keyStore: KeyStore | null): void {
    this.keyStore = keyStore
  }

  /**
   * #54: encrypts every backup from now on with `password` (or a new one). Only the key derived
   * from it is kept, sealed by the system; backups written before keep their password.
   */
  async setPassword(
    password: string,
    now = new Date(),
    params: KdfParams = DEFAULT_KDF
  ): Promise<BackupStatusDto> {
    const keyStore = this.keyStore
    if (!keyStore?.available())
      throw new Error('Verschlüsselte Sicherungen sind auf diesem Rechner nicht möglich.')
    const { key, kdf } = await deriveBackupKey(password, params)
    const sealedKey = keyStore.seal(key.toString('base64'))
    this.update({ encryption: { sealedKey, kdf, since: now.toISOString() } })
    return this.status()
  }

  /** #54: plain backups again; encrypted ones already written stay encrypted */
  disableEncryption(): BackupStatusDto {
    this.update({ encryption: null })
    return this.status()
  }

  /**
   * The key for the next backup, undefined for plain ones. A key that cannot be read fails the
   * backup: falling back to a plain copy would put the data unencrypted where the user did not
   * want it.
   */
  private backupKey(): BackupKey | undefined {
    const { encryption } = readBackupState(this.workDir())
    if (!encryption) return undefined
    if (!this.keyStore?.available()) throw new Error(KEY_UNREADABLE)
    let key: Buffer
    try {
      key = Buffer.from(this.keyStore.open(encryption.sealedKey), 'base64')
    } catch {
      throw new Error(KEY_UNREADABLE)
    }
    if (key.length !== 32) throw new Error(KEY_UNREADABLE)
    return { key, kdf: encryption.kdf }
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
        appVersion: this.appVersion,
        encryption: this.backupKey()
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
  async createManualBackup(parent: string, now = new Date()): Promise<string> {
    return writeBackup({
      parent,
      snapshotDb: this.snapshotDb,
      storageDir: this.storageDir(),
      workDir: this.workDir(),
      kind: 'manual',
      now,
      appVersion: this.appVersion,
      encryption: this.backupKey()
    })
  }

  /**
   * #54: an encrypted backup needs its password first: returns the pick, and the restore goes on
   * with unlockRestore. Null for a plain backup, which prepareRestore takes directly.
   */
  async pickEncryptedRestore(source: string): Promise<EncryptedRestorePick | null> {
    this.pendingEncrypted = null
    if (!isEncryptedBackup(source)) return null
    this.pendingEncrypted = source
    return { folder: source, backupCreatedAt: (await readBackupMarker(source))?.createdAt ?? null }
  }

  /** #54: the picked encrypted backup with its password; a wrong one can be retried */
  async unlockRestore(password: string): Promise<RestoreManifest> {
    if (!this.pendingEncrypted) throw new Error('Keine verschlüsselte Sicherung gewählt.')
    return prepareRestore(this.pendingEncrypted, this.workDir(), latestMigrationMillis(), password)
  }

  /** Copies and checks a backup; nothing is replaced until confirmRestore */
  prepareRestore(source: string, password?: string): Promise<RestoreManifest> {
    return prepareRestore(source, this.workDir(), latestMigrationMillis(), password)
  }

  cancelRestore(): Promise<void> {
    this.pendingEncrypted = null
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
    this.pendingEncrypted = null
    // The copy just taken is the newest and stays; a failed cleanup never blocks the restore
    await pruneBeforeRestore(parent).catch((error) =>
      console.error('Cleaning up backup/before-restore failed:', error)
    )
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
  start(appVersion: string, keyStore: KeyStore | null = this.keyStore): void {
    this.appVersion = appVersion
    this.keyStore = keyStore
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
