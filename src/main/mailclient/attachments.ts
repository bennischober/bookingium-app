// B6: attachment files never leave the main process as raw bytes for the renderer to write.
// The renderer asks for an action ("open" or "save as"), the main process fetches the bytes
// from the mail worker, writes them to a temp file or a user-chosen path and hands them to
// the OS. Only the sanitized name crosses back.
import { writeFile } from 'fs/promises'
import { isAbsolute, join, relative, resolve } from 'path'

/**
 * I11 (MR-23): the types "Öffnen" hands to the OS. An allowlist, because a list of dangerous
 * extensions is never complete (url, cpl, msc, wsf, chm, iso, vhdx, settingcontent-ms, html,
 * svg, ...). Everything else is only saved, after a confirmation main shows itself.
 */
const SAFE_TO_OPEN = new Set([
  'pdf',
  'txt',
  'csv',
  'rtf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'odp',
  'ics',
  'vcf',
  'mp3',
  'wav',
  'm4a',
  'mp4',
  'mov',
  'zip'
])

/**
 * Bidi controls and invisible marks. U+202E (RTLO) makes a name ending in "fdp.exe" read as one
 * ending in "exe.pdf"; none of them belongs in a file name.
 */
const INVISIBLE = /[\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

/** The Zone.Identifier stream Windows writes for a download: ZoneId=3 is "Internet" */
export const ZONE_IDENTIFIER = '[ZoneTransfer]\r\nZoneId=3\r\n'

/** Windows reserved device names, in any case and with or without an extension */
const RESERVED = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9'
])

const MAX_NAME = 120

/**
 * A file name that is safe to write on any platform: no path separators, no control
 * characters, no Windows reserved device name, no trailing dot or space, and capped.
 * An empty result falls back to `fallback`.
 */
export function safeAttachmentName(name: string, fallback = 'Anhang'): string {
  // Path separators and characters Windows refuses. Done first, so a name like
  // "../../etc/passwd" becomes a flat ".._.._etc_passwd".
  const cleaned = name
    .replace(INVISIBLE, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .trim()

  const dot = cleaned.lastIndexOf('.')
  const rawBase = dot > 0 ? cleaned.slice(0, dot) : cleaned
  const rawExtension = dot > 0 ? cleaned.slice(dot + 1) : ''
  // Only a plain alphanumeric tail is an extension; "x._etc_passwd" is not
  const hasExtension = /^[a-zA-Z0-9]{1,16}$/.test(rawExtension)

  // "CON" and "CON.txt" both address the console device on Windows
  const namePart = hasExtension ? rawBase : cleaned
  // Without a valid extension the whole name is the base, dots included
  const base = RESERVED.has(namePart.toLowerCase()) ? `_${namePart}` : namePart
  // A base that is only dots would address a directory
  const dottedBase = base.replace(/^\.+/, '_')

  // Leave room for "." + extension, so truncation never eats the extension
  const room = MAX_NAME - (hasExtension ? rawExtension.length + 1 : 0)
  const trimmedBase = dottedBase.replace(/[. ]+$/, '').slice(0, Math.max(room, 1))
  const joined = hasExtension ? `${trimmedBase}.${rawExtension}` : trimmedBase
  return joined.replace(/[. ]+$/, '') || fallback
}

/** I11 (MR-23): whether "Öffnen" may hand this (sanitized) name to the OS */
export function isSafeToOpen(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return SAFE_TO_OPEN.has(name.slice(dot + 1).toLowerCase())
}

/**
 * I11 (MR-34): `name`, made safe, inside `folder`. Throws when the result would still leave the
 * folder - `safeAttachmentName` already flattens the name, so this is the second wall.
 */
export function safePathIn(folder: string, name: string, fallback = 'Anhang'): string {
  const target = resolve(folder, safeAttachmentName(name, fallback))
  const rel = relative(resolve(folder), target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Ungültiger Dateiname')
  }
  return join(folder, rel)
}

/**
 * I11 (MR-23): Mark-of-the-Web. With the Zone.Identifier stream, SmartScreen checks what the
 * file starts and Office opens it in Protected View. NTFS only; elsewhere there is nothing to mark.
 */
export async function markFromInternet(file: string): Promise<void> {
  if (process.platform !== 'win32') return
  await writeFile(`${file}:Zone.Identifier`, ZONE_IDENTIFIER)
}

/** I11 (MR-23): the stored name of an attachment - never the one the renderer sends */
export function storedAttachmentName(
  attachments: { partId: string; filename: string | null }[],
  partId: string
): string {
  const found = attachments.find((a) => a.partId === partId)
  if (!found) throw new Error('Anhang nicht gefunden')
  return safeAttachmentName(found.filename ?? '', 'Anhang')
}
