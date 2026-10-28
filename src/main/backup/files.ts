// ========================================
// Backups on disk: write, prune, stage and apply a restore
// ========================================
// No Electron here: the caller passes the folders and how to snapshot the database, so
// tests run it against temp folders. Rules on names and retention live in `policy.ts`.
import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'fs/promises'
import { randomUUID } from 'crypto'
import { basename, dirname, join, relative, resolve, isAbsolute } from 'path'
import {
  BACKUP_MARKER,
  BACKUP_RETENTION,
  BACKUP_TEMP_PREFIX,
  backupFolderName,
  parseBackupFolderName,
  parseBackupMarker,
  selectBackupsToDelete,
  type BackupKind,
  type BackupMarker,
  type BackupRetention
} from './policy'

export const DB_FILE = 'bookingum.db'
/** The live database and its WAL companions, all replaced together by a restore */
const DB_FILES = [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]
const STORAGE = 'storage'
/** A restore picked and checked, waiting for the user's confirmation */
const RESTORE_INCOMING = 'restore-incoming'
/** A confirmed restore, applied at the next start before the database opens */
const RESTORE_STAGED = 'restore-staged'
const RESTORE_MANIFEST = 'restore.json'
const STATE_FILE = 'state.json'
/** Interrupted backups (temp folders) older than this are removed from the target */
const TEMP_TTL_MS = 24 * 60 * 60 * 1000

const RESTORE_NOTE = `Bookingium – Sicherung

Inhalt
  bookingum.db   die Datenbank (alle Einträge)
  storage/       Dokumente und Logos

Wiederherstellen
  In Bookingium unter Einstellungen › Daten › „Sicherung wiederherstellen…“
  diesen Ordner wählen. Bookingium sichert vorher den aktuellen Stand und
  startet dann neu.

Von Hand wiederherstellen
  1. Bookingium beenden.
  2. Im Datenordner (Einstellungen › Daten › „Datenordner öffnen“) die Datei
     data/bookingum.db durch die bookingum.db dieser Sicherung ersetzen und
     dort vorhandene bookingum.db-wal und bookingum.db-shm löschen.
  3. Den Ordner storage durch den storage-Ordner dieser Sicherung ersetzen.
  4. Bookingium starten.

Nicht enthalten
  E-Mails und E-Mail-Konten: Die E-Mails lädt Bookingium wieder vom Server,
  gespeicherte Passwörter funktionieren nur auf dem Rechner, auf dem sie
  eingegeben wurden.
`

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Whether `path` is `folder` or lies inside it */
export function isInsideFolder(path: string, folder: string): boolean {
  const rel = relative(resolve(folder), resolve(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** A sync client (OneDrive, Dropbox) briefly holds files it uploads; a rename is retried */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (attempt >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(code)) throw error
      await new Promise((done) => setTimeout(done, 250 * (attempt + 1)))
    }
  }
}

async function readMarker(folder: string): Promise<BackupMarker | null> {
  try {
    return parseBackupMarker(await readFile(join(folder, BACKUP_MARKER), 'utf-8'))
  } catch {
    return null
  }
}

export type WriteBackupOptions = {
  /** The folder the dated backup folder is created in */
  parent: string
  /** Writes a consistent copy of the live database to the given file */
  snapshotDb: (file: string) => Promise<unknown>
  storageDir: string
  /** Local, never synced folder for the database snapshot */
  workDir: string
  kind: BackupKind
  now?: Date
  appVersion?: string
}

/**
 * Writes a backup into a new dated folder inside `parent` and returns that folder.
 *
 * The database is snapshotted locally first (SQLite's backup API, safe while the app runs), so
 * no live or half-written database ever sits in a synced folder. Everything is written under a
 * temp name and renamed when complete: a folder named like a backup always is a whole one.
 */
export async function writeBackup(options: WriteBackupOptions): Promise<string> {
  const { parent, storageDir, workDir } = options
  if (!existsSync(parent)) throw new Error(`Ordner nicht gefunden: ${parent}`)
  // storage/ is copied into the backup: a backup inside it would copy itself
  if (isInsideFolder(parent, storageDir))
    throw new Error('Die Sicherung kann nicht im Datenordner von Bookingium liegen.')
  const now = options.now ?? new Date()
  const id = randomUUID().slice(0, 8)
  await mkdir(workDir, { recursive: true })
  const snapshot = join(workDir, `snapshot-${id}.db`)
  const temp = join(parent, `${BACKUP_TEMP_PREFIX}${id}`)
  try {
    await options.snapshotDb(snapshot)
    await mkdir(temp)
    // The marker first, so an interrupted backup is recognisable as ours (pruneBackups)
    const marker: BackupMarker = {
      app: 'bookingium',
      format: 1,
      kind: options.kind,
      createdAt: now.toISOString(),
      appVersion: options.appVersion ?? ''
    }
    await writeFile(join(temp, BACKUP_MARKER), JSON.stringify(marker, null, 2), 'utf-8')
    await copyFile(snapshot, join(temp, DB_FILE))
    if (existsSync(storageDir)) await cp(storageDir, join(temp, STORAGE), { recursive: true })
    await writeFile(join(temp, 'LIESMICH.txt'), RESTORE_NOTE, 'utf-8')
    // A manual backup in the same minute gets "(2)"
    const base = backupFolderName(now)
    for (let n = 1; n < 100; n++) {
      const folder = join(parent, n === 1 ? base : `${base} (${n})`)
      if (existsSync(folder)) continue
      await renameWithRetry(temp, folder)
      return folder
    }
    throw new Error('Kein freier Name für die Sicherung')
  } catch (error) {
    await rm(temp, { recursive: true, force: true }).catch(() => {})
    throw error
  } finally {
    await rm(snapshot, { force: true }).catch(() => {})
  }
}

export type BackupFolder = { name: string; date: Date; marker: BackupMarker | null }

/** The complete backup folders in `parent`, by their names; marker null for foreign ones */
export async function listBackups(parent: string): Promise<BackupFolder[]> {
  const out: BackupFolder[] = []
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const date = parseBackupFolderName(entry.name)
    if (!date) continue
    out.push({ name: entry.name, date, marker: await readMarker(join(parent, entry.name)) })
  }
  return out
}

/**
 * Deletes the automatic backups the retention no longer keeps, and interrupted ones older than a
 * day. Only folders named like ours AND carrying our marker of kind "auto" (or, for interrupted
 * ones, the temp name and our marker) are touched; manual backups and everything else stay.
 * Returns the deleted folder names.
 */
export async function pruneBackups(
  parent: string,
  now = new Date(),
  retention: BackupRetention = BACKUP_RETENTION
): Promise<string[]> {
  const automatic = (await listBackups(parent)).filter((backup) => backup.marker?.kind === 'auto')
  const deleted = selectBackupsToDelete(automatic, retention)
  for (const name of deleted) await rm(join(parent, name), { recursive: true })

  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(BACKUP_TEMP_PREFIX)) continue
    const marker = await readMarker(join(parent, entry.name))
    if (!marker || now.getTime() - Date.parse(marker.createdAt) < TEMP_TTL_MS) continue
    await rm(join(parent, entry.name), { recursive: true })
    deleted.push(entry.name)
  }
  return deleted
}

/**
 * Throws a German message unless `file` is an intact Bookingium database this app can run on.
 * `appMigrationMillis` is the created-at of the app's newest migration: a backup whose database
 * records a later one comes from a newer version, and this app would run on a schema it does
 * not know.
 */
export function checkBackupDatabase(file: string, appMigrationMillis: number): void {
  let sqlite: Database.Database
  try {
    sqlite = new Database(file, { readonly: true, fileMustExist: true })
  } catch {
    throw new Error('Die Datenbank der Sicherung lässt sich nicht öffnen.')
  }
  try {
    if (sqlite.pragma('quick_check', { simple: true }) !== 'ok')
      throw new Error('Die Datenbank der Sicherung ist beschädigt.')
    const table = sqlite
      .prepare("select 1 from sqlite_master where type = 'table' and name = 'app_setting'")
      .get()
    if (!table) throw new Error('Die Datei ist keine Bookingium-Datenbank.')
    const journal = sqlite
      .prepare("select 1 from sqlite_master where type = 'table' and name = '__drizzle_migrations'")
      .get()
    const last = journal
      ? (
          sqlite.prepare('select max(created_at) as last from __drizzle_migrations').get() as {
            last: number | null
          }
        ).last
      : null
    if (last !== null && Number(last) > appMigrationMillis)
      throw new Error(
        'Die Sicherung stammt aus einer neueren Version von Bookingium. Bitte zuerst Bookingium aktualisieren, dann wiederherstellen.'
      )
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Die ')) throw error
    throw new Error('Die Datenbank der Sicherung ist beschädigt.')
  } finally {
    sqlite.close()
  }
}

export type RestoreManifest = {
  /** The backup folder it came from */
  source: string
  /** When the backup was taken (ISO), null when unknown */
  backupCreatedAt: string | null
  hasStorage: boolean
}

/**
 * Copies a backup into the local work folder and checks it, without replacing anything yet.
 * The copy is what a confirmed restore applies, so the chosen folder is only read once and a
 * synced folder changing meanwhile cannot matter. `appMigrationMillis`: see checkBackupDatabase.
 */
export async function prepareRestore(
  source: string,
  workDir: string,
  appMigrationMillis: number
): Promise<RestoreManifest> {
  const name = basename(source)
  if (name.startsWith(BACKUP_TEMP_PREFIX))
    throw new Error('Diese Sicherung wurde nicht fertig geschrieben.')
  if (!existsSync(join(source, DB_FILE)))
    throw new Error('Der Ordner enthält keine Bookingium-Sicherung (bookingum.db fehlt).')
  const incoming = join(workDir, RESTORE_INCOMING)
  await rm(incoming, { recursive: true, force: true })
  await mkdir(incoming, { recursive: true })
  try {
    await copyFile(join(source, DB_FILE), join(incoming, DB_FILE))
    checkBackupDatabase(join(incoming, DB_FILE), appMigrationMillis)
    const hasStorage = existsSync(join(source, STORAGE))
    if (hasStorage) await cp(join(source, STORAGE), join(incoming, STORAGE), { recursive: true })
    const marker = await readMarker(source)
    const manifest: RestoreManifest = {
      source,
      backupCreatedAt: marker?.createdAt ?? parseBackupFolderName(name)?.toISOString() ?? null,
      hasStorage
    }
    await writeFile(join(incoming, RESTORE_MANIFEST), JSON.stringify(manifest, null, 2), 'utf-8')
    return manifest
  } catch (error) {
    await rm(incoming, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

/** The prepared restore, or null when none is waiting for confirmation */
export function preparedRestore(workDir: string): RestoreManifest | null {
  try {
    return JSON.parse(
      readFileSync(join(workDir, RESTORE_INCOMING, RESTORE_MANIFEST), 'utf-8')
    ) as RestoreManifest
  } catch {
    return null
  }
}

/** Confirms the prepared restore: from now on the next start applies it */
export async function stageRestore(workDir: string): Promise<RestoreManifest> {
  const manifest = preparedRestore(workDir)
  if (!manifest) throw new Error('Keine Wiederherstellung vorbereitet.')
  const staged = join(workDir, RESTORE_STAGED)
  await rm(staged, { recursive: true, force: true })
  await rename(join(workDir, RESTORE_INCOMING), staged)
  return manifest
}

export async function cancelRestore(workDir: string): Promise<void> {
  await rm(join(workDir, RESTORE_INCOMING), { recursive: true, force: true })
}

export type RestoreOutcome = {
  /** ISO timestamp of the attempt */
  at: string
  source: string
  backupCreatedAt: string | null
  /** null when it worked */
  error: string | null
}

export type DataLocations = { dataDir: string; storageDir: string; workDir: string }

/** A failed restore is set aside, or removed if that fails, so the next start does not retry */
function setAsideFailed(staged: string, to: string): void {
  try {
    renameSync(staged, to)
  } catch {
    rmSync(staged, { recursive: true, force: true })
  }
}

/**
 * Applies a staged restore. Runs at startup BEFORE the database opens; synchronous, it is only
 * renames within the data folder. The current database and storage move aside first and come
 * back if any step fails; after a success they are removed (the backup taken before the restore
 * holds them). Returns null when no restore was staged.
 */
export function applyStagedRestore(
  { dataDir, storageDir, workDir }: DataLocations,
  now = new Date()
): RestoreOutcome | null {
  // Picked but never confirmed
  rmSync(join(workDir, RESTORE_INCOMING), { recursive: true, force: true })
  const staged = join(workDir, RESTORE_STAGED)
  if (!existsSync(staged)) return null
  let manifest: RestoreManifest | null = null
  try {
    manifest = JSON.parse(readFileSync(join(staged, RESTORE_MANIFEST), 'utf-8')) as RestoreManifest
  } catch {
    // staged by rename, so it always has one; without it, it is not ours to apply
  }
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const outcome = (error: string | null): RestoreOutcome => ({
    at: now.toISOString(),
    source: manifest?.source ?? '',
    backupCreatedAt: manifest?.backupCreatedAt ?? null,
    error
  })
  if (!manifest || !existsSync(join(staged, DB_FILE))) {
    setAsideFailed(staged, join(workDir, `restore-failed-${stamp}`))
    return outcome('Die vorbereitete Wiederherstellung ist unvollständig.')
  }

  const aside = join(workDir, `replaced-${stamp}`)
  const moved: Array<[string, string]> = []
  const move = (from: string, to: string) => {
    mkdirSync(dirname(to), { recursive: true })
    renameSync(from, to)
    moved.push([from, to])
  }
  try {
    for (const file of DB_FILES) {
      if (existsSync(join(dataDir, file))) move(join(dataDir, file), join(aside, 'data', file))
    }
    if (existsSync(storageDir)) move(storageDir, join(aside, STORAGE))
    move(join(staged, DB_FILE), join(dataDir, DB_FILE))
    if (existsSync(join(staged, STORAGE))) move(join(staged, STORAGE), storageDir)
  } catch (error) {
    // Everything back where it was, last move first
    let allBack = true
    for (const [from, to] of moved.reverse()) {
      try {
        renameSync(to, from)
      } catch {
        // stays in `aside`, which is then kept
        allBack = false
      }
    }
    setAsideFailed(staged, join(workDir, `restore-failed-${stamp}`))
    if (allBack) rmSync(aside, { recursive: true, force: true })
    return outcome(errorMessage(error))
  }
  rmSync(aside, { recursive: true, force: true })
  rmSync(staged, { recursive: true, force: true })
  return outcome(null)
}

// ========================================
// Settings and status (machine-local)
// ========================================
// Kept in the work folder, not the database: the target is a path on this computer, and
// restoring an older database must not switch backups off or send them elsewhere.

export type BackupState = {
  enabled: boolean
  /** The target folder, '' for none chosen */
  folder: string
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  /** The folder the last successful backup was written to */
  lastFolder: string | null
  /** null when the last attempt worked */
  lastError: string | null
  lastRestore: RestoreOutcome | null
  /** Where the backup taken before the last restore went */
  beforeRestoreFolder: string | null
}

export const EMPTY_BACKUP_STATE: BackupState = {
  enabled: false,
  folder: '',
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastFolder: null,
  lastError: null,
  lastRestore: null,
  beforeRestoreFolder: null
}

export function readBackupState(workDir: string): BackupState {
  try {
    const stored = JSON.parse(readFileSync(join(workDir, STATE_FILE), 'utf-8')) as object
    return { ...EMPTY_BACKUP_STATE, ...stored }
  } catch {
    return { ...EMPTY_BACKUP_STATE }
  }
}

export function writeBackupState(workDir: string, state: BackupState): void {
  mkdirSync(workDir, { recursive: true })
  const file = join(workDir, STATE_FILE)
  writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(`${file}.tmp`, file)
}
