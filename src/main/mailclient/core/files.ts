// Crash-safe message files (card A3).
//
// File names are OPAQUE and PERMANENT: a random name chosen once when the file is first
// written, stored in `messages.file_path`, and never renamed again. Moves and re-keys only
// update the row. That is what makes a folder rename (which changes the folder id, and with
// it every message key) a row-only operation.
//
// The write order is: tmp file -> fsync -> rename to the final name. A crash therefore
// leaves either no file, a `.tmp` file, or a complete final file - never a truncated one that
// a row already points at.
//
// Files sit in 256 subfolders named after the first two characters of the name (`3f/3f…eml`),
// so no folder holds a whole mailbox: Explorer, virus scanners and backups slow down on one
// folder of tens of thousands of files. Files written before that stay at the top level; their
// rows name them there, and listMessageFiles() reads both places.
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

/** Windows: Defender or the indexer can hold a freshly written file for a moment. */
const RENAME_RETRIES = 5
const RENAME_RETRY_MS = 50
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

const sleepSync = (ms: number): void => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    /* spin: this is a synchronous core */
  }
}

/** A subfolder writeMessageFile() puts files in */
const SHARD = /^[0-9a-f]{2}$/

/**
 * Writes `source` as a new message file under `dir` and returns its path relative to
 * `dir`, with `/` as separator (`3f/3f….eml`). The name is a random UUID, never derived
 * from the message key.
 *
 * When the final rename keeps failing (Windows AV), the file stays under its `.tmp` name
 * and THAT name is returned: the file exists under the returned name in every case, so the
 * row always points at a readable file.
 */
export function writeMessageFile(dir: string, source: Buffer | Uint8Array): string {
  const id = randomUUID()
  const shard = id.slice(0, 2)
  fs.mkdirSync(path.join(dir, shard), { recursive: true })
  const name = `${shard}/${id}.eml`
  const tmp = `${name}.tmp`
  const tmpPath = path.join(dir, tmp)
  const finalPath = path.join(dir, name)

  const fd = fs.openSync(tmpPath, 'wx')
  try {
    fs.writeFileSync(fd, source)
    fs.fsyncSync(fd)
  } catch (error) {
    try {
      fs.closeSync(fd)
    } catch {
      /* already closed by the throw */
    }
    try {
      fs.unlinkSync(tmpPath)
    } catch {
      /* nothing to clean up */
    }
    throw error
  }
  fs.closeSync(fd)

  for (let attempt = 0; attempt <= RENAME_RETRIES; attempt++) {
    try {
      fs.renameSync(tmpPath, finalPath)
      return name
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (!TRANSIENT.has(code) || attempt === RENAME_RETRIES) return tmp
      sleepSync(RENAME_RETRY_MS)
    }
  }
  return tmp
}

/** True for a name this module hands out (a message file or its in-flight tmp name). */
export function isMessageFile(name: string): boolean {
  return name.endsWith('.eml') || name.endsWith('.eml.tmp')
}

/**
 * Whether `rel` is a path writeMessageFile() hands out for a finished file: a name at the top
 * level or in one subfolder, never anywhere else (no `..`, no other folder).
 */
export function isStoredMessagePath(rel: string): boolean {
  return /^(?:[0-9a-f]{2}\/)?[^/\\]+\.eml$/.test(rel) && !rel.includes('..')
}

/**
 * Every message file under `dir`, as the relative path a row stores: the subfolders and the
 * top level, where files written before the subfolders stay. Other folders (`orphans/`) are
 * not read.
 */
export function listMessageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && isMessageFile(entry.name)) files.push(entry.name)
    else if (entry.isDirectory() && SHARD.test(entry.name)) {
      for (const f of fs.readdirSync(path.join(dir, entry.name))) {
        if (isMessageFile(f)) files.push(`${entry.name}/${f}`)
      }
    }
  }
  return files
}
