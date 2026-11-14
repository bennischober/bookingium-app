import { isProtectedFolder } from '../../../../main/mailclient/core/folders'
import type { FolderNode } from '../../../../main/mailclient/core/types'

export type SyncModeRow = {
  folder: FolderNode
  /** INBOX and the special-use folders always sync; their box cannot be cleared */
  fixed: boolean
  /** the path with " / " between its levels, as the list shows it */
  path: string
}

/**
 * #158: the rows of the folder selection: the fixed folders first, then the others by path,
 * narrowed to those whose path contains `filter` (any case).
 */
export function syncModeRows(folders: readonly FolderNode[], filter: string): SyncModeRow[] {
  const needle = filter.trim().toLocaleLowerCase('de-DE')
  return folders
    .map((folder) => ({
      folder,
      fixed: isProtectedFolder({ path: folder.path, specialUse: folder.specialUse }),
      path: folder.delimiter ? folder.path.split(folder.delimiter).join(' / ') : folder.path
    }))
    .filter((row) => !needle || row.path.toLocaleLowerCase('de-DE').includes(needle))
    .sort((a, b) =>
      a.fixed !== b.fixed ? (a.fixed ? -1 : 1) : a.path.localeCompare(b.path, 'de-DE')
    )
}
