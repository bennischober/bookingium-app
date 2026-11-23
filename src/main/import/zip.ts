// ========================================
// Reading parts of a zip file
// ========================================
// Office and Apple documents are zips of XML parts (.xlsx, .docx, .pages). This reads single
// parts with Node's own zlib, so no zip library (and its supply chain) comes into the app.
import { inflateRawSync } from 'zlib'

export type ZipEntry = { name: string; method: number; compressedSize: number; offset: number }

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** A part bigger than this is not something a person typed */
const MAX_PART_BYTES = 64 * 1024 * 1024

export class ZipError extends Error {}

/** The parts of a zip by name; throws ZipError when the file is no zip */
export function zipEntries(zip: Buffer): Map<string, ZipEntry> {
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ZipError('not a zip')
  const count = zip.readUInt16LE(eocd + 10)
  let pointer = zip.readUInt32LE(eocd + 16)
  const entries = new Map<string, ZipEntry>()
  for (let i = 0; i < count; i++) {
    if (pointer + 46 > zip.length || zip.readUInt32LE(pointer) !== CENTRAL_SIGNATURE) break
    const method = zip.readUInt16LE(pointer + 10)
    const compressedSize = zip.readUInt32LE(pointer + 20)
    const nameLength = zip.readUInt16LE(pointer + 28)
    const extraLength = zip.readUInt16LE(pointer + 30)
    const commentLength = zip.readUInt16LE(pointer + 32)
    const offset = zip.readUInt32LE(pointer + 42)
    const name = zip.toString('utf-8', pointer + 46, pointer + 46 + nameLength)
    entries.set(name, { name, method, compressedSize, offset })
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** One part's bytes, null when the zip has no such part; throws ZipError when it is damaged */
export function zipPart(zip: Buffer, entries: Map<string, ZipEntry>, name: string): Buffer | null {
  const entry = entries.get(name)
  if (!entry) return null
  if (entry.offset + 30 > zip.length || zip.readUInt32LE(entry.offset) !== LOCAL_SIGNATURE)
    throw new ZipError('damaged')
  const nameLength = zip.readUInt16LE(entry.offset + 26)
  const extraLength = zip.readUInt16LE(entry.offset + 28)
  const start = entry.offset + 30 + nameLength + extraLength
  const data = zip.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(data)
  if (entry.method !== 8) throw new ZipError('unknown method')
  return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES })
}
