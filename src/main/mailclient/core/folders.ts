// B1: folder create / rename / delete. The name rules are pure, so they are
// tested directly; the ops themselves are journaled like every other write.

/** The folder names a mail server refuses, independent of the account */
export class FolderNameError extends Error {}

/** The hierarchy delimiter of an account; '/' unless the server says otherwise */
export const DEFAULT_DELIMITER = '/'

/**
 * B1: validate a new or renamed folder's own name (not its path).
 *
 * Refused: empty, only spaces, leading or trailing spaces, the hierarchy
 * delimiter inside, control characters, and INBOX in any case (INBOX is the one
 * name IMAP fixes).
 */
export function checkFolderName(name: string, delimiter = DEFAULT_DELIMITER): string {
  const trimmed = name.trim()
  if (!trimmed) throw new FolderNameError('Der Ordnername darf nicht leer sein.')
  if (trimmed !== name) {
    throw new FolderNameError('Der Ordnername darf nicht mit Leerzeichen beginnen oder enden.')
  }
  if (delimiter && name.includes(delimiter)) {
    throw new FolderNameError(`Der Ordnername darf kein „${delimiter}“ enthalten.`)
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f]/.test(name)) {
    throw new FolderNameError('Der Ordnername enthält ein ungültiges Zeichen.')
  }
  if (name.toUpperCase() === 'INBOX') {
    throw new FolderNameError('Der Posteingang kann nicht umbenannt werden.')
  }
  return name
}

/** The full path of a folder under a parent, or at the top level */
export function folderPath(parentPath: string | null, name: string, delimiter = DEFAULT_DELIMITER): string {
  return parentPath ? `${parentPath}${delimiter}${name}` : name
}

/** Every path that is this folder or one of its subfolders */
export function isPathOrChild(path: string, parent: string, delimiter = DEFAULT_DELIMITER): boolean {
  return path === parent || path.startsWith(`${parent}${delimiter}`)
}

/** The new path of a folder after its own name or an ancestor's changed */
export function renamedPath(path: string, from: string, to: string, delimiter = DEFAULT_DELIMITER): string {
  if (!isPathOrChild(path, from, delimiter)) return path
  return to + path.slice(from.length)
}

/** The special-use folders that may never be renamed, deleted or moved */
const PROTECTED_SPECIAL_USE = ['Sent', 'Drafts', 'Trash', 'Archive', 'Junk']

/**
 * B1: a folder that the UI must not offer to rename or delete: INBOX and every
 * special-use folder. The core refuses them as well, so this is not the only guard.
 */
export function isProtectedFolder(folder: {
  path: string
  specialUse?: string | null
}): boolean {
  if (folder.path.toUpperCase() === 'INBOX') return true
  const use = folder.specialUse ?? ''
  return PROTECTED_SPECIAL_USE.some((name) => use.includes(name))
}
