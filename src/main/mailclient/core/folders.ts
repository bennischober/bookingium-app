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

/**
 * B2: where a folder lands when it is dropped on `targetParent` (null = top level).
 * The folder keeps its own name; only its parent changes. Pure, so the drag rules
 * are testable without a mailbox.
 */
export function folderMoveTarget(
  path: string,
  targetParent: string | null,
  delimiter = DEFAULT_DELIMITER
): string {
  const name = path.includes(delimiter) ? path.slice(path.lastIndexOf(delimiter) + 1) : path
  return folderPath(targetParent, name, delimiter)
}

/**
 * B2: the reason a folder may not be moved there, or null when it may.
 * Everything is refused before any server contact: protected folders, a move into
 * itself or its own subtree, and a name clash in the target.
 */
export function folderMoveRefusal(
  path: string,
  targetParent: string | null,
  options: {
    delimiter?: string
    specialUse?: string | null
    /** every known folder path, so target and clash are checked locally */
    knownPaths?: string[]
  } = {}
): string | null {
  const delimiter = options.delimiter ?? DEFAULT_DELIMITER
  if (isProtectedFolder({ path, specialUse: options.specialUse })) {
    return 'Dieser Ordner kann nicht verschoben werden.'
  }
  if (targetParent !== null && isPathOrChild(targetParent, path, delimiter)) {
    return 'Ein Ordner kann nicht in sich selbst verschoben werden.'
  }
  const known = options.knownPaths
  if (known) {
    if (targetParent !== null && !known.includes(targetParent)) {
      return `Zielordner nicht gefunden: ${targetParent}`
    }
    const to = folderMoveTarget(path, targetParent, delimiter)
    if (to !== path && known.includes(to)) {
      return 'Ein Ordner mit diesem Namen existiert dort schon.'
    }
  }
  return null
}
