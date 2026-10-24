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

/**
 * Writes `source` as a new message file under `dir` and returns its name relative to
 * `dir`. The name is a random UUID, never derived from the message key.
 *
 * When the final rename keeps failing (Windows AV), the file stays under its `.tmp` name
 * and THAT name is returned: the file exists under the returned name in every case, so the
 * row always points at a readable file.
 */
export function writeMessageFile(dir: string, source: Buffer | Uint8Array): string {
  fs.mkdirSync(dir, { recursive: true })
  const name = `${randomUUID()}.eml`
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
