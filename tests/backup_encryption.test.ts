// #54: password-encrypted backups: the archive format, a wrong or changed file, paths that try to
// leave the restore folder, encrypted backups through writeBackup / prepareRestore, and the
// service keeping the key sealed between runs.
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
  ENCRYPTED_FILE,
  WRONG_PASSWORD,
  backupEntries,
  deriveBackupKey,
  extractEncryptedArchive,
  unlockEncryptedArchive,
  writeEncryptedArchive,
  type KdfParams
} from '../src/main/backup/encryption'
import { BACKUP_MARKER, parseBackupMarker } from '../src/main/backup/policy'
import {
  isEncryptedBackup,
  prepareRestore,
  preparedRestore,
  readBackupState,
  writeBackup
} from '../src/main/backup/files'
import { BackupService, backupLocations, type KeyStore } from '../src/main/services/BackupService'
import { backupPasswordProblem } from '../src/renderer/src/components/settings/backupPassword'
import { setStorageBasePath } from '../src/main/utils/fileStorage'
import { setupTestDb } from './helpers/setup'

/** Cheap enough for tests; the app uses DEFAULT_KDF */
const FAST: KdfParams = { N: 2 ** 10, r: 8, p: 1 }
const PASSWORD = 'richtig-langes-passwort'
const APP_MIGRATION = 1_800_000_000_000

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bookingum-backup-enc-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function makeDb(file: string, label: string): void {
  mkdirSync(join(file, '..'), { recursive: true })
  const sqlite = new Database(file)
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

/** A database and a storage folder with nested, empty and non-ASCII entries */
function arrangeData(): { dbFile: string; storageDir: string } {
  const dbFile = join(root, 'live', 'bookingum.db')
  makeDb(dbFile, 'gesichert')
  const storageDir = join(root, 'live', 'storage')
  mkdirSync(join(storageDir, 'documents', 'bands', '1-beispiel'), { recursive: true })
  mkdirSync(join(storageDir, 'logos'), { recursive: true })
  writeFileSync(join(storageDir, 'documents', 'bands', '1-beispiel', 'Vertrag für Ü.pdf'), 'pdf')
  writeFileSync(join(storageDir, 'documents', 'leer.txt'), '')
  // bigger than one read chunk
  writeFileSync(join(storageDir, 'documents', 'gross.bin'), Buffer.alloc(3 * 1024 * 1024 + 7, 7))
  return { dbFile, storageDir }
}

const flip = (file: string, at: number) => {
  const bytes = readFileSync(file)
  bytes[at] ^= 0xff
  writeFileSync(file, bytes)
}

describe('#54: the encrypted archive', () => {
  it('round-trips the database and every document, folders included', async () => {
    const { dbFile, storageDir } = arrangeData()
    const key = await deriveBackupKey(PASSWORD, FAST)
    const file = join(root, ENCRYPTED_FILE)
    await writeEncryptedArchive(file, await backupEntries(dbFile, storageDir), key)
    // nothing readable in it
    expect(readFileSync(file).includes(Buffer.from('Vertrag'))).toBe(false)
    expect(readFileSync(file).includes(Buffer.from('gesichert'))).toBe(false)

    const unlocked = await unlockEncryptedArchive(file, PASSWORD)
    expect(unlocked.equals(key.key)).toBe(true)
    const out = join(root, 'out')
    await extractEncryptedArchive(file, unlocked, out, join(root, 'work'))
    expect(readLabel(join(out, 'bookingum.db'))).toBe('gesichert')
    expect(
      readFileSync(
        join(out, 'storage', 'documents', 'bands', '1-beispiel', 'Vertrag für Ü.pdf'),
        'utf-8'
      )
    ).toBe('pdf')
    expect(readFileSync(join(out, 'storage', 'documents', 'leer.txt'), 'utf-8')).toBe('')
    expect(
      readFileSync(join(out, 'storage', 'documents', 'gross.bin')).equals(
        readFileSync(join(storageDir, 'documents', 'gross.bin'))
      )
    ).toBe(true)
    expect(existsSync(join(out, 'storage', 'logos'))).toBe(true)
    // the plain archive does not stay in the work folder
    expect(readdirSync(join(root, 'work'))).toEqual([])
  })

  it('tells a wrong password at once, and the same password in another form is the same', async () => {
    const { dbFile } = arrangeData()
    const file = join(root, ENCRYPTED_FILE)
    // "ü" composed in the backup, decomposed when typed: the same password
    await writeEncryptedArchive(
      file,
      await backupEntries(dbFile, null),
      await deriveBackupKey('Grüße-aus-Köln', FAST)
    )
    await expect(unlockEncryptedArchive(file, 'Grüsse-aus-Köln')).rejects.toThrow(WRONG_PASSWORD)
    await expect(
      unlockEncryptedArchive(file, 'Grüße-aus-Köln'.normalize('NFD'))
    ).resolves.toBeTruthy()
    await expect(deriveBackupKey('kurz', FAST)).rejects.toThrow('mindestens 8')
  })

  it('refuses a changed body, tag or header, and unpacks nothing then', async () => {
    const { dbFile, storageDir } = arrangeData()
    const key = await deriveBackupKey(PASSWORD, FAST)
    const original = join(root, 'original')
    await writeEncryptedArchive(original, await backupEntries(dbFile, storageDir), key)
    const size = readFileSync(original).length
    const headerEnd = 12 + readFileSync(original).readUInt32BE(8)

    for (const at of [headerEnd + 5, size - 40, size - 1]) {
      const file = join(root, `changed-${at}`)
      writeFileSync(file, readFileSync(original))
      flip(file, at)
      const out = join(root, `out-${at}`)
      await expect(extractEncryptedArchive(file, key.key, out, join(root, 'work'))).rejects.toThrow(
        WRONG_PASSWORD
      )
      expect(existsSync(join(out, 'bookingum.db'))).toBe(false)
    }
    expect(readdirSync(join(root, 'work'))).toEqual([])

    // the header is the additional data: a changed salt or IV fails like a wrong password
    const header = join(root, 'header')
    const bytes = readFileSync(original)
    const json = JSON.parse(bytes.subarray(12, headerEnd).toString('utf-8'))
    const iv = Buffer.from(json.iv, 'base64')
    iv[0] ^= 1
    const changed = Buffer.from(JSON.stringify({ ...json, iv: iv.toString('base64') }))
    const length = Buffer.alloc(4)
    length.writeUInt32BE(changed.length)
    writeFileSync(
      header,
      Buffer.concat([bytes.subarray(0, 8), length, changed, bytes.subarray(headerEnd)])
    )
    await expect(
      extractEncryptedArchive(header, key.key, join(root, 'h'), join(root, 'work'))
    ).rejects.toThrow(WRONG_PASSWORD)
  })

  it('refuses a header asking for more memory than the app ever uses', async () => {
    const { dbFile } = arrangeData()
    const key = await deriveBackupKey(PASSWORD, FAST)
    const file = join(root, ENCRYPTED_FILE)
    await writeEncryptedArchive(file, await backupEntries(dbFile, null), key)
    const bytes = readFileSync(file)
    const headerEnd = 12 + bytes.readUInt32BE(8)
    const json = JSON.parse(bytes.subarray(12, headerEnd).toString('utf-8'))
    for (const cost of [{ N: 2 ** 22 }, { r: 64 }, { p: 32 }, { N: 1000 }]) {
      const changed = Buffer.from(JSON.stringify({ ...json, ...cost }))
      const length = Buffer.alloc(4)
      length.writeUInt32BE(changed.length)
      writeFileSync(
        file,
        Buffer.concat([bytes.subarray(0, 8), length, changed, bytes.subarray(headerEnd)])
      )
      await expect(unlockEncryptedArchive(file, PASSWORD), JSON.stringify(cost)).rejects.toThrow(
        WRONG_PASSWORD
      )
    }
    writeFileSync(file, 'kein Archiv')
    await expect(unlockEncryptedArchive(file, PASSWORD)).rejects.toThrow('keine verschlüsselte')
  })

  it('never writes outside the restore folder', async () => {
    const { dbFile } = arrangeData()
    const key = await deriveBackupKey(PASSWORD, FAST)
    for (const path of [
      '../ausserhalb.txt',
      'storage/../../ausserhalb.txt',
      '/abs.txt',
      'C:/x.txt',
      'storage\\x.txt',
      'anderes/x.txt'
    ]) {
      const file = join(root, 'evil')
      await writeEncryptedArchive(file, [{ path, source: dbFile }], key)
      const out = join(root, 'out', 'inner')
      await expect(
        extractEncryptedArchive(file, key.key, out, join(root, 'work')),
        path
      ).rejects.toThrow('beschädigt')
      expect(existsSync(join(root, 'out', 'ausserhalb.txt'))).toBe(false)
      expect(existsSync(join(root, 'ausserhalb.txt'))).toBe(false)
    }
  })
})

describe('#54: encrypted backups on disk', () => {
  const snapshotOf = (dbFile: string) => async (file: string) =>
    writeFileSync(file, readFileSync(dbFile))

  it('holds no plain database or document, and restores with the right password only', async () => {
    const { dbFile, storageDir } = arrangeData()
    const parent = join(root, 'Sicherungen')
    mkdirSync(parent)
    const workDir = join(root, 'work')
    const folder = await writeBackup({
      parent,
      snapshotDb: snapshotOf(dbFile),
      storageDir,
      workDir,
      kind: 'auto',
      now: new Date(2026, 10, 6, 9, 0),
      encryption: await deriveBackupKey(PASSWORD, FAST)
    })
    expect(readdirSync(folder).sort()).toEqual(
      [BACKUP_MARKER, 'LIESMICH.txt', ENCRYPTED_FILE].sort()
    )
    expect(parseBackupMarker(readFileSync(join(folder, BACKUP_MARKER), 'utf-8'))).toMatchObject({
      kind: 'auto',
      encrypted: true
    })
    expect(readFileSync(join(folder, 'LIESMICH.txt'), 'utf-8')).toContain('Passwort')
    expect(isEncryptedBackup(folder)).toBe(true)
    // the plain snapshot does not stay behind locally either
    expect(readdirSync(workDir)).toEqual([])

    await expect(prepareRestore(folder, workDir, APP_MIGRATION)).rejects.toThrow('verschlüsselt')
    await expect(
      prepareRestore(folder, workDir, APP_MIGRATION, 'falsches-passwort')
    ).rejects.toThrow(WRONG_PASSWORD)
    expect(preparedRestore(workDir)).toBeNull()

    const manifest = await prepareRestore(folder, workDir, APP_MIGRATION, PASSWORD)
    expect(manifest).toMatchObject({ source: folder, hasStorage: true })
    const incoming = join(workDir, 'restore-incoming')
    expect(readLabel(join(incoming, 'bookingum.db'))).toBe('gesichert')
    expect(existsSync(join(incoming, 'storage', 'documents', 'leer.txt'))).toBe(true)
    expect(preparedRestore(workDir)).toMatchObject({ source: folder })
  })

  it('removes what it unpacked when the database inside is not ours', async () => {
    const dbFile = join(root, 'fremd.db')
    new Database(dbFile).exec('create table other (id)').close()
    const parent = join(root, 'Sicherungen')
    mkdirSync(parent)
    const workDir = join(root, 'work')
    const folder = await writeBackup({
      parent,
      snapshotDb: snapshotOf(dbFile),
      storageDir: join(root, 'fehlt'),
      workDir,
      kind: 'manual',
      encryption: await deriveBackupKey(PASSWORD, FAST)
    })
    await expect(prepareRestore(folder, workDir, APP_MIGRATION, PASSWORD)).rejects.toThrow(
      'keine Bookingium-Datenbank'
    )
    expect(existsSync(join(workDir, 'restore-incoming'))).toBe(false)
  })
})

describe('#54: the password dialog', () => {
  it('asks for the length, the same twice and the note', () => {
    expect(backupPasswordProblem({ password: 'kurz', repeat: 'kurz', noted: true })).toMatch(/8/)
    expect(backupPasswordProblem({ password: PASSWORD, repeat: 'anders!!', noted: true })).toMatch(
      /nicht gleich/
    )
    expect(backupPasswordProblem({ password: PASSWORD, repeat: PASSWORD, noted: false })).toMatch(
      /notiert/
    )
    expect(backupPasswordProblem({ password: PASSWORD, repeat: PASSWORD, noted: true })).toBeNull()
  })
})

describe('#54: BackupService with a password', () => {
  setupTestDb()

  let userData: string
  beforeAll(() => {
    userData = mkdtempSync(join(tmpdir(), 'bookingum-backup-enc-service-'))
    setStorageBasePath(join(userData, 'storage'))
    mkdirSync(join(userData, 'storage', 'documents'), { recursive: true })
    writeFileSync(join(userData, 'storage', 'documents', 'rider.pdf'), 'rider')
  })
  afterAll(() => {
    setStorageBasePath(null)
    rmSync(userData, { recursive: true, force: true })
  })

  /** Seals by reversing, so a test sees the sealed key is not the key */
  function fakeKeyStore(): KeyStore & { broken: boolean; on: boolean } {
    return {
      broken: false,
      on: true,
      available() {
        return this.on
      },
      seal: (plain) => `sealed:${[...plain].reverse().join('')}`,
      open(sealed) {
        if (this.broken || !sealed.startsWith('sealed:')) throw new Error('cannot decrypt')
        return [...sealed.slice('sealed:'.length)].reverse().join('')
      }
    }
  }

  it('needs the system to keep the key', async () => {
    const service = container.resolve(BackupService)
    service.setKeyStore(null)
    expect(service.status()).toMatchObject({ encrypted: false, encryptionAvailable: false })
    await expect(service.setPassword(PASSWORD, new Date(), FAST)).rejects.toThrow('nicht möglich')
    const keyStore = fakeKeyStore()
    keyStore.on = false
    service.setKeyStore(keyStore)
    await expect(service.setPassword(PASSWORD, new Date(), FAST)).rejects.toThrow('nicht möglich')
    expect(readBackupState(backupLocations(userData).workDir).encryption).toBeNull()
  })

  it('encrypts manual backups once set, keeps the key sealed and out of the status', async () => {
    const service = container.resolve(BackupService)
    const keyStore = fakeKeyStore()
    service.setKeyStore(keyStore)
    const since = new Date(2026, 10, 6, 10, 0)
    const status = await service.setPassword(PASSWORD, since, FAST)
    expect(status).toMatchObject({
      encrypted: true,
      encryptedSince: since.toISOString(),
      encryptionAvailable: true
    })
    expect(JSON.stringify(status)).not.toContain('sealed')
    expect(status).not.toHaveProperty('encryption')
    const stored = readBackupState(backupLocations(userData).workDir).encryption
    expect(stored?.sealedKey.startsWith('sealed:')).toBe(true)

    const target = join(root, 'Sicherungen')
    mkdirSync(target)
    const folder = await service.createManualBackup(target, new Date(2026, 10, 6, 11, 0))
    expect(existsSync(join(folder, ENCRYPTED_FILE))).toBe(true)
    expect(existsSync(join(folder, 'bookingum.db'))).toBe(false)
    expect(existsSync(join(folder, 'storage'))).toBe(false)

    // a restore of it: picked, then the password, retried after a wrong one
    expect(await service.pickEncryptedRestore(folder)).toMatchObject({ folder })
    await expect(service.unlockRestore('falsches-passwort')).rejects.toThrow(WRONG_PASSWORD)
    const manifest = await service.unlockRestore(PASSWORD)
    expect(manifest).toMatchObject({ source: folder, hasStorage: true })
    await service.cancelRestore()
    await expect(service.unlockRestore(PASSWORD)).rejects.toThrow('Keine verschlüsselte')

    // a plain backup is not one to unlock
    expect(await service.pickEncryptedRestore(join(root, 'irgendwo'))).toBeNull()
  })

  it('fails instead of writing a plain backup when the key cannot be read', async () => {
    const service = container.resolve(BackupService)
    const keyStore = fakeKeyStore()
    service.setKeyStore(keyStore)
    await service.setPassword(PASSWORD, new Date(), FAST)
    keyStore.broken = true
    const target = join(root, 'Sicherungen')
    mkdirSync(target)
    await expect(service.createManualBackup(target)).rejects.toThrow('Passwort neu setzen')
    expect(readdirSync(target)).toEqual([])

    // the automatic run keeps the reason for the settings
    service.setFolder(target)
    const state = await service.run(new Date(2026, 10, 7, 9, 0))
    expect(state.lastError).toContain('Passwort neu setzen')
    expect(readdirSync(target)).toEqual([])
    service.setEnabled(false)
  })

  it('writes plain backups again once switched off', async () => {
    const service = container.resolve(BackupService)
    service.setKeyStore(fakeKeyStore())
    await service.setPassword(PASSWORD, new Date(), FAST)
    expect(service.disableEncryption()).toMatchObject({ encrypted: false, encryptedSince: null })
    const target = join(root, 'Sicherungen')
    mkdirSync(target)
    const folder = await service.createManualBackup(target)
    expect(existsSync(join(folder, 'bookingum.db'))).toBe(true)
    expect(existsSync(join(folder, ENCRYPTED_FILE))).toBe(false)
  })
})
