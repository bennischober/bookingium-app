// ========================================
// Password-encrypted backups (#54)
// ========================================
// An encrypted backup keeps its marker and its note in plain text and puts the database and the
// documents into one file, `daten.bookingium`:
//
//   header   "BKSICH01", u32 length, JSON {v, kdf: "scrypt", N, r, p, salt, iv, check}
//   body     the archive, encrypted with AES-256-GCM; the header is its additional data
//   tag      the 16-byte GCM tag
//
// The archive is a list of entries, each u16 path length, the path ("bookingum.db",
// "storage/…", a folder ends in "/"), u64 size and the bytes; a zero length ends it.
//
// The key comes from the password via scrypt. `check` (an HMAC of a fixed text under the key)
// tells a wrong password at once, without decrypting the whole file; the tag then proves the
// rest. A changed header fails like a wrong password, since it is the additional data.
//
// No Electron: the caller keeps the key between backups (BackupService seals it with
// safeStorage), so the daily backup runs without asking for the password.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual
} from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { appendFile, mkdir, open, readdir, rm, stat, writeFile } from 'fs/promises'
import { pipeline } from 'stream/promises'
import { join } from 'path'
import { MIN_BACKUP_PASSWORD_LENGTH } from './policy'

/** The one encrypted file in an encrypted backup folder */
export const ENCRYPTED_FILE = 'daten.bookingium'
export const WRONG_PASSWORD = 'Falsches Passwort oder beschädigte Sicherung.'

const MAGIC = Buffer.from('BKSICH01', 'ascii')
const TAG_BYTES = 16
const IV_BYTES = 12
const MAX_HEADER_JSON = 4096
const CHECK_TEXT = 'bookingium-backup-key-check'
/** Read and written in pieces of this size */
const CHUNK = 1024 * 1024

export type KdfParams = { N: number; r: number; p: number }
/** The salt (base64) a key was derived with, and the cost */
export type KdfSettings = KdfParams & { salt: string }
export type BackupKey = { key: Buffer; kdf: KdfSettings }

/** About 128 MiB and half a second on a current laptop */
export const DEFAULT_KDF: KdfParams = { N: 2 ** 17, r: 8, p: 1 }
/**
 * What a header read from a backup may ask for: a crafted file must not make the app reserve
 * gigabytes or compute for minutes. Twice the default memory, at most.
 */
const MAX_N_TIMES_R = 2 * DEFAULT_KDF.N * DEFAULT_KDF.r
const MAX_P = 4

type Header = KdfSettings & { v: 1; kdf: 'scrypt'; iv: string; check: string }

function checkKdf({ N, r, p }: KdfParams): void {
  const powerOfTwo = Number.isInteger(N) && N > 1 && (N & (N - 1)) === 0
  if (!powerOfTwo || !Number.isInteger(r) || r < 1 || !Number.isInteger(p) || p < 1)
    throw new Error(WRONG_PASSWORD)
  if (N * r > MAX_N_TIMES_R || p > MAX_P) throw new Error(WRONG_PASSWORD)
}

function scrypt(password: string, salt: Buffer, { N, r, p }: KdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCallback(
      password.normalize('NFC'),
      salt,
      32,
      // scrypt needs 128·N·r bytes; Node's default limit (32 MiB) is below the default cost
      { N, r, p, maxmem: 2 * 128 * N * r + 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key))
    )
  )
}

const keyCheck = (key: Buffer) =>
  createHmac('sha256', key).update(CHECK_TEXT).digest().subarray(0, 16)

/** A new key from the password, with a new salt */
export async function deriveBackupKey(
  password: string,
  params: KdfParams = DEFAULT_KDF
): Promise<BackupKey> {
  if (password.length < MIN_BACKUP_PASSWORD_LENGTH)
    throw new Error(`Das Passwort braucht mindestens ${MIN_BACKUP_PASSWORD_LENGTH} Zeichen.`)
  checkKdf(params)
  const salt = randomBytes(16)
  return {
    key: await scrypt(password, salt, params),
    kdf: { ...params, salt: salt.toString('base64') }
  }
}

function headerBytes(header: Header): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf-8')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(json.length)
  return Buffer.concat([MAGIC, length, json])
}

async function readHeader(file: string): Promise<{ bytes: Buffer; header: Header }> {
  const handle = await open(file, 'r')
  try {
    const start = Buffer.alloc(MAGIC.length + 4)
    const { bytesRead } = await handle.read(start, 0, start.length, 0)
    if (bytesRead < start.length || !start.subarray(0, MAGIC.length).equals(MAGIC))
      throw new Error('Die Datei ist keine verschlüsselte Bookingium-Sicherung.')
    const length = start.readUInt32BE(MAGIC.length)
    if (length > MAX_HEADER_JSON) throw new Error(WRONG_PASSWORD)
    const json = Buffer.alloc(length)
    const read = await handle.read(json, 0, length, start.length)
    if (read.bytesRead < length) throw new Error(WRONG_PASSWORD)
    let header: Header
    try {
      header = JSON.parse(json.toString('utf-8')) as Header
    } catch {
      throw new Error(WRONG_PASSWORD)
    }
    if (header.v !== 1 || header.kdf !== 'scrypt') throw new Error(WRONG_PASSWORD)
    if (typeof header.salt !== 'string' || typeof header.iv !== 'string')
      throw new Error(WRONG_PASSWORD)
    checkKdf(header)
    return { bytes: Buffer.concat([start, json]), header }
  } finally {
    await handle.close()
  }
}

/** One file or folder of the archive; `source` null for a folder */
export type ArchiveEntry = { path: string; source: string | null }

/** The database as `bookingum.db`, and every folder and file under `storageDir` as `storage/…` */
export async function backupEntries(
  dbFile: string,
  storageDir: string | null
): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [{ path: 'bookingum.db', source: dbFile }]
  const walk = async (dir: string, prefix: string) => {
    entries.push({ path: `${prefix}/`, source: null })
    const children = await readdir(dir, { withFileTypes: true })
    children.sort((a, b) => a.name.localeCompare(b.name))
    for (const child of children) {
      const path = join(dir, child.name)
      if (child.isDirectory()) await walk(path, `${prefix}/${child.name}`)
      else if (child.isFile()) entries.push({ path: `${prefix}/${child.name}`, source: path })
    }
  }
  if (storageDir) await walk(storageDir, 'storage')
  return entries
}

async function* archive(entries: ArchiveEntry[]): AsyncGenerator<Buffer> {
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf-8')
    const size = entry.source ? (await stat(entry.source)).size : 0
    const head = Buffer.alloc(2 + name.length + 8)
    head.writeUInt16BE(name.length, 0)
    name.copy(head, 2)
    head.writeBigUInt64BE(BigInt(size), 2 + name.length)
    yield head
    if (!entry.source || size === 0) continue
    let read = 0
    for await (const chunk of createReadStream(entry.source, {
      start: 0,
      end: size - 1,
      highWaterMark: CHUNK
    })) {
      read += (chunk as Buffer).length
      yield chunk as Buffer
    }
    // a document that shrank while it was read would shift every entry after it
    if (read !== size)
      throw new Error(`Die Datei hat sich während der Sicherung geändert: ${entry.path}`)
  }
  yield Buffer.alloc(2)
}

/** Writes `entries` as an encrypted archive to `file` */
export async function writeEncryptedArchive(
  file: string,
  entries: ArchiveEntry[],
  { key, kdf }: BackupKey
): Promise<void> {
  const iv = randomBytes(IV_BYTES)
  const header = headerBytes({
    v: 1,
    kdf: 'scrypt',
    N: kdf.N,
    r: kdf.r,
    p: kdf.p,
    salt: kdf.salt,
    iv: iv.toString('base64'),
    check: keyCheck(key).toString('base64')
  })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)
  await writeFile(file, header)
  await pipeline(archive(entries), cipher, createWriteStream(file, { flags: 'a' }))
  await appendFile(file, cipher.getAuthTag())
}

/** The key of an encrypted archive from its password; throws WRONG_PASSWORD when it is not */
export async function unlockEncryptedArchive(file: string, password: string): Promise<Buffer> {
  const { header } = await readHeader(file)
  const key = await scrypt(password, Buffer.from(header.salt, 'base64'), header)
  const expected = Buffer.from(header.check ?? '', 'base64')
  const actual = keyCheck(key)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    throw new Error(WRONG_PASSWORD)
  return key
}

/** "storage/documents/a.pdf" → its parts, or null for anything that could leave the folder */
function safeParts(path: string): string[] | null {
  if (path !== 'bookingum.db' && !path.startsWith('storage/')) return null
  if (path.includes('\\') || path.includes('\0')) return null
  const parts = path.replace(/\/$/, '').split('/')
  if (parts.some((part) => part === '' || part === '.' || part === '..' || /^[a-zA-Z]:/.test(part)))
    return null
  return parts
}

/**
 * Decrypts the archive in `file` with `key` into `outDir` (bookingum.db, storage/). The plain
 * archive goes to `workDir` first and is unpacked only once the tag proved it whole; on any error
 * nothing of it is left in `workDir`, and what reached `outDir` is the caller's to remove.
 */
export async function extractEncryptedArchive(
  file: string,
  key: Buffer,
  outDir: string,
  workDir: string
): Promise<void> {
  const { bytes, header } = await readHeader(file)
  const { size } = await stat(file)
  if (size < bytes.length + TAG_BYTES) throw new Error(WRONG_PASSWORD)
  const tag = Buffer.alloc(TAG_BYTES)
  const handle = await open(file, 'r')
  try {
    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES)
  } finally {
    await handle.close()
  }

  await mkdir(workDir, { recursive: true })
  const plain = join(workDir, `archive-${randomBytes(4).toString('hex')}.tmp`)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'))
    decipher.setAAD(bytes)
    decipher.setAuthTag(tag)
    const body = size - TAG_BYTES - bytes.length
    try {
      await pipeline(
        body > 0
          ? createReadStream(file, {
              start: bytes.length,
              end: size - TAG_BYTES - 1,
              highWaterMark: CHUNK
            })
          : [Buffer.alloc(0)],
        decipher,
        createWriteStream(plain)
      )
    } catch {
      throw new Error(WRONG_PASSWORD)
    }
    await unpack(plain, outDir)
  } finally {
    await rm(plain, { force: true }).catch(() => {})
  }
}

async function unpack(plain: string, outDir: string): Promise<void> {
  const damaged = () => new Error('Die Sicherung ist beschädigt.')
  const input = await open(plain, 'r')
  try {
    const { size: total } = await input.stat()
    let at = 0
    const take = async (length: number): Promise<Buffer> => {
      if (at + length > total) throw damaged()
      const buffer = Buffer.alloc(length)
      await input.read(buffer, 0, length, at)
      at += length
      return buffer
    }
    for (;;) {
      const nameLength = (await take(2)).readUInt16BE(0)
      if (nameLength === 0) break
      const path = (await take(nameLength)).toString('utf-8')
      const size = Number((await take(8)).readBigUInt64BE(0))
      const parts = safeParts(path)
      if (!parts || !Number.isSafeInteger(size) || at + size > total) throw damaged()
      const target = join(outDir, ...parts)
      if (path.endsWith('/')) {
        if (size !== 0) throw damaged()
        await mkdir(target, { recursive: true })
        continue
      }
      await mkdir(join(target, '..'), { recursive: true })
      const output = await open(target, 'wx')
      try {
        for (let left = size; left > 0; ) {
          const piece = await take(Math.min(CHUNK, left))
          await output.write(piece)
          left -= piece.length
        }
      } finally {
        await output.close()
      }
    }
    if (at !== total) throw damaged()
  } finally {
    await input.close()
  }
}
