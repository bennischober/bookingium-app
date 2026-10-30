// Automatic backups: the due rule, retention, writing into a (synced) target folder, pruning
// only our own folders, and the staged restore applied at the next start.
import 'reflect-metadata'
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import Database from 'better-sqlite3'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  BACKUP_DUE_AFTER_MS,
  BACKUP_MARKER,
  BACKUP_TEMP_PREFIX,
  backupFolderName,
  isBackupDue,
  parseBackupFolderName,
  parseBackupMarker,
  selectBackupsToDelete,
  type BackupKind
} from '../src/main/backup/policy'
import {
  applyStagedRestore,
  cancelRestore,
  listBackups,
  preparedRestore,
  prepareRestore,
  pruneBackups,
  pruneBeforeRestore,
  readBackupState,
  stageRestore,
  writeBackup
} from '../src/main/backup/files'
import { BackupService, backupLocations } from '../src/main/services/BackupService'
import { setStorageBasePath } from '../src/main/utils/fileStorage'
import { setupTestDb } from './helpers/setup'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bookingum-backup-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const at = (day: number, hours = 9, month = 9) => new Date(2026, month, day, hours, 0)

/** Created-at of the app's newest migration, as prepareRestore is told */
const APP_MIGRATION = 1_800_000_000_000

/** A small Bookingium-like database file in WAL mode, as the live one is */
function makeDb(file: string, label: string): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const sqlite = new Database(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.exec('create table app_setting (key text primary key, value text)')
  sqlite.prepare('insert into app_setting values (?, ?)').run('label', label)
  sqlite.close()
}

function readLabel(file: string): string {
  const sqlite = new Database(file, { readonly: true })
  try {
    return (
      sqlite.prepare("select value from app_setting where key = 'label'").get() as {
        value: string
      }
    ).value
  } finally {
    sqlite.close()
  }
}

/** A finished backup folder as writeBackup leaves it */
function fakeBackup(parent: string, date: Date, kind: BackupKind | null): string {
  const folder = join(parent, backupFolderName(date))
  mkdirSync(folder, { recursive: true })
  if (kind)
    writeFileSync(
      join(folder, BACKUP_MARKER),
      JSON.stringify({ app: 'bookingium', format: 1, kind, createdAt: date.toISOString() })
    )
  return folder
}

describe('backup policy', () => {
  it('is due without a success, after about a day, and when the clock went back', () => {
    const now = at(28, 12)
    expect(isBackupDue(null, now)).toBe(true)
    expect(isBackupDue('kaputt', now)).toBe(true)
    expect(isBackupDue(at(28, 9).toISOString(), now)).toBe(false)
    // opened a little earlier than yesterday: still one backup a day
    expect(isBackupDue(at(27, 17).toISOString(), now)).toBe(false)
    expect(isBackupDue(new Date(now.getTime() - BACKUP_DUE_AFTER_MS).toISOString(), now)).toBe(true)
    expect(isBackupDue(at(26, 12).toISOString(), now)).toBe(true)
    expect(isBackupDue(at(29, 12).toISOString(), now)).toBe(true)
  })

  it('reads back only the folder names it writes', () => {
    const date = new Date(2026, 9, 19, 14, 30)
    const name = backupFolderName(date)
    expect(name).toBe('Bookingium-Sicherung 2026-10-19 14-30')
    expect(parseBackupFolderName(name)?.getTime()).toBe(date.getTime())
    expect(parseBackupFolderName(`${name} (2)`)?.getTime()).toBe(date.getTime())
    expect(parseBackupFolderName('Bookingium-Sicherung 2026-02-31 10-00')).toBeNull()
    expect(parseBackupFolderName(`${name} Kopie`)).toBeNull()
    expect(parseBackupFolderName('Fotos 2026-10-19 14-30')).toBeNull()
  })

  it('accepts only its own marker', () => {
    const marker = { app: 'bookingium', format: 1, kind: 'auto', createdAt: at(1).toISOString() }
    expect(parseBackupMarker(JSON.stringify(marker))).toMatchObject({ kind: 'auto' })
    expect(parseBackupMarker(JSON.stringify({ ...marker, app: 'other' }))).toBeNull()
    expect(parseBackupMarker(JSON.stringify({ ...marker, kind: 'whatever' }))).toBeNull()
    expect(parseBackupMarker(JSON.stringify({ ...marker, createdAt: 'gestern' }))).toBeNull()
    expect(parseBackupMarker('{')).toBeNull()
  })

  it('keeps the newest of the last 7 days and of the last 4 weeks', () => {
    // one backup a day for 40 days (Oct 1 to Nov 9), two on the newest day
    const entries = Array.from({ length: 40 }, (_, i) => {
      const date = new Date(2026, 9, 1 + i, 9, 0)
      return { name: backupFolderName(date), date }
    })
    entries.push({ name: 'later today', date: new Date(2026, 10, 9, 18, 0) })
    const deleted = new Set(selectBackupsToDelete(entries))
    const kept = entries.filter((entry) => !deleted.has(entry.name)).map((entry) => entry.name)
    expect(kept).toEqual([
      // weekly: the newest of the weeks starting Mon Oct 19 and Oct 26; those of Nov 2
      // (Nov 8) and Nov 9 are daily ones anyway
      'Bookingium-Sicherung 2026-10-25 09-00',
      'Bookingium-Sicherung 2026-11-01 09-00',
      // daily: Nov 3 to 9, the newest of Nov 9 only
      'Bookingium-Sicherung 2026-11-03 09-00',
      'Bookingium-Sicherung 2026-11-04 09-00',
      'Bookingium-Sicherung 2026-11-05 09-00',
      'Bookingium-Sicherung 2026-11-06 09-00',
      'Bookingium-Sicherung 2026-11-07 09-00',
      'Bookingium-Sicherung 2026-11-08 09-00',
      'later today'
    ])
  })

  it('never empties the folder after a long break', () => {
    const entries = [at(1), at(2), at(3)].map((date) => ({ name: backupFolderName(date), date }))
    // days without a backup do not count, so all three are kept months later
    expect(selectBackupsToDelete(entries)).toEqual([])
    expect(selectBackupsToDelete([])).toEqual([])
  })
})

describe('writing and pruning backups', () => {
  const write = (parent: string, kind: BackupKind, now: Date) =>
    writeBackup({
      parent,
      snapshotDb: async (file) => makeDb(file, 'live'),
      storageDir: join(root, 'userData', 'storage'),
      workDir: join(root, 'userData', 'backup'),
      kind,
      now,
      appVersion: '1.2.3'
    })

  it('writes a complete, marked folder and leaves nothing behind', async () => {
    const storage = join(root, 'userData', 'storage', 'documents')
    mkdirSync(storage, { recursive: true })
    writeFileSync(join(storage, 'vertrag.pdf'), 'pdf')
    const target = join(root, 'OneDrive', 'Sicherungen')
    mkdirSync(target, { recursive: true })

    const folder = await write(target, 'auto', at(28, 14))
    expect(folder).toBe(join(target, 'Bookingium-Sicherung 2026-10-28 14-00'))
    expect(readLabel(join(folder, 'bookingum.db'))).toBe('live')
    expect(readFileSync(join(folder, 'storage', 'documents', 'vertrag.pdf'), 'utf-8')).toBe('pdf')
    expect(existsSync(join(folder, 'LIESMICH.txt'))).toBe(true)
    expect(JSON.parse(readFileSync(join(folder, BACKUP_MARKER), 'utf-8'))).toMatchObject({
      app: 'bookingium',
      kind: 'auto',
      appVersion: '1.2.3'
    })
    // no temp folder in the target, no snapshot in the work folder
    expect(readdirSync(target)).toEqual(['Bookingium-Sicherung 2026-10-28 14-00'])
    expect(readdirSync(join(root, 'userData', 'backup'))).toEqual([])

    // a second one in the same minute gets its own name
    expect(await write(target, 'manual', at(28, 14))).toBe(`${folder} (2)`)
  })

  it('removes its temp folder when writing fails', async () => {
    const target = join(root, 'Sicherungen')
    mkdirSync(target)
    await expect(
      writeBackup({
        parent: target,
        snapshotDb: async () => {
          throw new Error('Datenträger voll')
        },
        storageDir: join(root, 'userData', 'storage'),
        workDir: join(root, 'userData', 'backup'),
        kind: 'auto'
      })
    ).rejects.toThrow('Datenträger voll')
    expect(readdirSync(target)).toEqual([])
  })

  it('refuses a missing target and one inside the documents folder', async () => {
    await expect(write(join(root, 'fehlt'), 'auto', at(1))).rejects.toThrow('nicht gefunden')
    const inside = join(root, 'userData', 'storage', 'sicherungen')
    mkdirSync(inside, { recursive: true })
    await expect(write(inside, 'auto', at(1))).rejects.toThrow('Datenordner')
  })

  it('deletes only old automatic backups and stale temp folders of its own', async () => {
    const target = join(root, 'Sicherungen')
    mkdirSync(target)
    for (let day = 1; day <= 10; day++) fakeBackup(target, at(day), 'auto')
    const manual = fakeBackup(target, at(1, 10), 'manual')
    const beforeRestore = fakeBackup(target, at(1, 11), 'before-restore')
    // named like ours but without our marker: not ours to delete
    const unmarked = fakeBackup(target, at(1, 12), null)
    mkdirSync(join(target, 'Urlaubsfotos'))
    writeFileSync(join(target, 'notizen.txt'), 'bleibt')
    // an interrupted backup from two days ago, a running one, a foreign dot folder
    const stale = join(target, `${BACKUP_TEMP_PREFIX}alt`)
    mkdirSync(stale)
    writeFileSync(
      join(stale, BACKUP_MARKER),
      JSON.stringify({ app: 'bookingium', format: 1, kind: 'auto', createdAt: at(8).toISOString() })
    )
    const running = join(target, `${BACKUP_TEMP_PREFIX}neu`)
    mkdirSync(running)
    writeFileSync(
      join(running, BACKUP_MARKER),
      JSON.stringify({
        app: 'bookingium',
        format: 1,
        kind: 'auto',
        createdAt: at(10).toISOString()
      })
    )
    mkdirSync(join(target, `${BACKUP_TEMP_PREFIX}fremd`))

    const deleted = await pruneBackups(target, at(10, 12), { daily: 3, weekly: 2 })
    // kept: Oct 8-10 daily, Oct 4 for the week of Sep 28 (Oct 5-7 fall in the week of Oct 5,
    // whose newest, Oct 10, is already kept)
    expect(deleted.sort()).toEqual(
      [
        ...[1, 2, 3, 5, 6, 7].map((day) => backupFolderName(at(day))),
        `${BACKUP_TEMP_PREFIX}alt`
      ].sort()
    )
    for (const folder of [manual, beforeRestore, unmarked, running]) {
      expect(existsSync(folder)).toBe(true)
    }
    expect(existsSync(join(target, 'Urlaubsfotos'))).toBe(true)
    expect(existsSync(join(target, `${BACKUP_TEMP_PREFIX}fremd`))).toBe(true)
    expect(readFileSync(join(target, 'notizen.txt'), 'utf-8')).toBe('bleibt')
    expect((await listBackups(target)).filter((b) => b.marker?.kind === 'auto')).toHaveLength(4)
  })

  it('keeps only the newest copies from before a restore (#56)', async () => {
    const parent = join(root, 'before-restore')
    mkdirSync(parent)
    for (let day = 1; day <= 5; day++) fakeBackup(parent, at(day), 'before-restore')
    // not a before-restore copy, or not ours: stays
    const manual = fakeBackup(parent, at(1, 10), 'manual')
    const unmarked = fakeBackup(parent, at(1, 12), null)

    const deleted = await pruneBeforeRestore(parent, 3)
    expect(deleted.sort()).toEqual([backupFolderName(at(1)), backupFolderName(at(2))].sort())
    for (const day of [3, 4, 5])
      expect(existsSync(join(parent, backupFolderName(at(day))))).toBe(true)
    expect(existsSync(manual)).toBe(true)
    expect(existsSync(unmarked)).toBe(true)
  })
})

describe('restoring a backup', () => {
  const locations = () => backupLocations(join(root, 'userData'))

  /** Current data (database "current", one document) and a backup ("backup", another one) */
  function arrange(): { source: string } {
    const { dataDir, storageDir } = locations()
    makeDb(join(dataDir, 'bookingum.db'), 'current')
    writeFileSync(join(dataDir, 'bookingum.db-wal'), '')
    mkdirSync(join(storageDir, 'documents'), { recursive: true })
    writeFileSync(join(storageDir, 'documents', 'aktuell.pdf'), 'current')

    const source = fakeBackup(join(root, 'Sicherungen'), at(20), 'auto')
    makeDb(join(source, 'bookingum.db'), 'backup')
    mkdirSync(join(source, 'storage', 'documents'), { recursive: true })
    writeFileSync(join(source, 'storage', 'documents', 'alt.pdf'), 'backup')
    return { source }
  }

  it('checks the chosen folder before anything is staged', async () => {
    const { workDir } = locations()
    const empty = join(root, 'leer')
    mkdirSync(empty)
    await expect(prepareRestore(empty, workDir, APP_MIGRATION)).rejects.toThrow(
      'bookingum.db fehlt'
    )

    const broken = join(root, 'kaputt')
    mkdirSync(broken)
    writeFileSync(join(broken, 'bookingum.db'), 'keine Datenbank')
    await expect(prepareRestore(broken, workDir, APP_MIGRATION)).rejects.toThrow(
      'Datenbank der Sicherung'
    )

    const foreign = join(root, 'fremd')
    mkdirSync(foreign)
    new Database(join(foreign, 'bookingum.db')).exec('create table other (id)').close()
    await expect(prepareRestore(foreign, workDir, APP_MIGRATION)).rejects.toThrow(
      'keine Bookingium-Datenbank'
    )

    const unfinished = join(root, `${BACKUP_TEMP_PREFIX}abc`)
    mkdirSync(unfinished)
    await expect(prepareRestore(unfinished, workDir, APP_MIGRATION)).rejects.toThrow('nicht fertig')
    expect(preparedRestore(workDir)).toBeNull()
  })

  it('refuses a backup from a newer version and accepts one from this or an older one', async () => {
    const { source } = arrange()
    const { workDir } = locations()
    const sqlite = new Database(join(source, 'bookingum.db'))
    sqlite.exec(
      'create table __drizzle_migrations (id integer primary key, hash text, created_at numeric)'
    )
    const record = sqlite.prepare(
      'insert into __drizzle_migrations (hash, created_at) values (?, ?)'
    )
    record.run('older', APP_MIGRATION - 1000)
    record.run('newer', APP_MIGRATION + 1000)
    sqlite.close()

    await expect(prepareRestore(source, workDir, APP_MIGRATION)).rejects.toThrow('neueren Version')
    expect(preparedRestore(workDir)).toBeNull()

    await expect(prepareRestore(source, workDir, APP_MIGRATION + 1000)).resolves.toMatchObject({
      source
    })
  })

  it('applies a confirmed restore at the next start', async () => {
    const { source } = arrange()
    const { dataDir, storageDir, workDir } = locations()

    const manifest = await prepareRestore(source, workDir, APP_MIGRATION)
    expect(manifest).toEqual({
      source,
      backupCreatedAt: at(20).toISOString(),
      hasStorage: true
    })
    // only prepared: a start now changes nothing
    expect(applyStagedRestore(locations(), at(21))).toBeNull()
    expect(preparedRestore(workDir)).toBeNull()
    expect(readLabel(join(dataDir, 'bookingum.db'))).toBe('current')

    await prepareRestore(source, workDir, APP_MIGRATION)
    await stageRestore(workDir)
    const outcome = applyStagedRestore(locations(), at(21))
    expect(outcome).toEqual({
      at: at(21).toISOString(),
      source,
      backupCreatedAt: at(20).toISOString(),
      error: null
    })
    // the old WAL would replay the replaced database's changes onto the restored one
    expect(existsSync(join(dataDir, 'bookingum.db-wal'))).toBe(false)
    expect(readLabel(join(dataDir, 'bookingum.db'))).toBe('backup')
    expect(readdirSync(join(storageDir, 'documents'))).toEqual(['alt.pdf'])
    expect(readdirSync(workDir)).toEqual([])
    // applied once
    expect(applyStagedRestore(locations(), at(22))).toBeNull()
    // the chosen backup itself is untouched
    expect(readLabel(join(source, 'bookingum.db'))).toBe('backup')
  })

  it('discards a restore that was picked but not confirmed', async () => {
    const { source } = arrange()
    const { workDir } = locations()
    await prepareRestore(source, workDir, APP_MIGRATION)
    await cancelRestore(workDir)
    expect(preparedRestore(workDir)).toBeNull()
    await expect(stageRestore(workDir)).rejects.toThrow('Keine Wiederherstellung')
  })

  it('puts the current data back when a step fails', async () => {
    const { source } = arrange()
    const userData = join(root, 'userData')
    const { dataDir, workDir } = locations()
    await prepareRestore(source, workDir, APP_MIGRATION)
    await stageRestore(workDir)
    // the documents cannot go to a folder whose parent is a file
    writeFileSync(join(root, 'blockiert'), '')
    const storageDir = join(root, 'blockiert', 'storage')

    const outcome = applyStagedRestore({ dataDir, storageDir, workDir }, at(21))
    expect(outcome?.error).toBeTruthy()
    expect(readLabel(join(dataDir, 'bookingum.db'))).toBe('current')
    expect(existsSync(join(dataDir, 'bookingum.db-wal'))).toBe(true)
    expect(readFileSync(join(userData, 'storage', 'documents', 'aktuell.pdf'), 'utf-8')).toBe(
      'current'
    )
    // set aside, so the next start does not try again
    expect(readdirSync(workDir).filter((name) => name.startsWith('restore-failed-'))).toHaveLength(
      1
    )
    expect(applyStagedRestore({ dataDir, storageDir, workDir }, at(22))).toBeNull()
  })
})

describe('BackupService', () => {
  setupTestDb()

  let userData: string
  beforeAll(() => {
    userData = mkdtempSync(join(tmpdir(), 'bookingum-backup-service-'))
    setStorageBasePath(join(userData, 'storage'))
  })
  afterAll(() => {
    setStorageBasePath(null)
    rmSync(userData, { recursive: true, force: true })
  })

  it('backs up once a day into the chosen folder and reports failures', async () => {
    const service = container.resolve(BackupService)
    expect(service.status()).toMatchObject({ enabled: false, folder: '', lastSuccessAt: null })
    expect(() => service.setEnabled(true)).toThrow('Ordner')
    // nothing switched on: nothing runs
    expect(service.runIfDue(at(1))).toBeNull()
    expect(() => service.setFolder(join(userData, 'storage'))).toThrow()
    expect(() => service.setFolder(join(root, 'fehlt'))).toThrow('nicht gefunden')

    const target = join(root, 'Sicherungen')
    mkdirSync(target)
    expect(service.setFolder(target)).toMatchObject({ enabled: true, folder: target })

    const first = service.runIfDue(at(1, 9))
    // a second check while it runs joins the same backup
    expect(service.run(at(1, 9))).toBe(first)
    expect(service.status().running).toBe(true)
    const state = await first
    expect(state).toMatchObject({ lastSuccessAt: at(1, 9).toISOString(), lastError: null })
    expect(service.status().running).toBe(false)
    expect(readdirSync(target)).toEqual([backupFolderName(at(1, 9))])

    // later that day: not due
    expect(service.runIfDue(at(1, 18))).toBeNull()
    // the next day, with the folder gone: the error is kept, the last success too
    rmSync(target, { recursive: true })
    const failed = await service.runIfDue(at(2, 9))
    expect(failed).toMatchObject({
      lastAttemptAt: at(2, 9).toISOString(),
      lastSuccessAt: at(1, 9).toISOString()
    })
    expect(failed?.lastError).toContain('nicht gefunden')
    // still due, so the next check tries again
    mkdirSync(target)
    expect(await service.runIfDue(at(2, 10))).toMatchObject({ lastError: null })

    service.setEnabled(false)
    expect(service.runIfDue(at(5))).toBeNull()
    // the state lives in the data folder, outside the database
    expect(readBackupState(join(userData, 'backup'))).toMatchObject({
      enabled: false,
      folder: target
    })
  })

  it('backs up the current state before staging a restore', async () => {
    const service = container.resolve(BackupService)
    const source = await service.createManualBackup(join(root), at(3))
    await service.prepareRestore(source)
    const { beforeRestoreFolder } = await service.confirmRestore(at(4))
    expect(beforeRestoreFolder.startsWith(join(userData, 'backup', 'before-restore'))).toBe(true)
    expect(JSON.parse(readFileSync(join(beforeRestoreFolder, BACKUP_MARKER), 'utf-8')).kind).toBe(
      'before-restore'
    )
    expect(existsSync(join(userData, 'backup', 'restore-staged', 'bookingum.db'))).toBe(true)
    expect(service.status().beforeRestoreFolder).toBe(beforeRestoreFolder)
    // only before the database opens
    expect(() => service.applyStagedRestore()).toThrow('before the database opens')
  })
})
