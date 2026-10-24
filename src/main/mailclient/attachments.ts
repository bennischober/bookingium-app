// B6: attachment files never leave the main process as raw bytes for the renderer to write.
// The renderer asks for an action ("open" or "save as"), the main process fetches the bytes
// from the mail worker, writes them to a temp file or a user-chosen path and hands them to
// the OS. Only the sanitized name crosses back.

/** Executable extensions: "Öffnen" warns before it starts one of these */
const EXECUTABLE = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'js',
  'jse',
  'vbs',
  'vbe',
  'ps1',
  'psm1',
  'scr',
  'lnk',
  'msi',
  'jar',
  'hta',
  'reg',
  'sh'
])

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

/** Whether "Öffnen" should warn first */
export function isExecutableName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return EXECUTABLE.has(name.slice(dot + 1).toLowerCase())
}
