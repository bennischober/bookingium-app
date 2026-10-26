/**
 * MR-36: the archive decision, in a pure module so vitest can hold it.
 *
 * Archiving a mail that is ALREADY in Archive was offered because `hasArchive` is global - it only asks
 * whether an Archive folder exists. The core skips a self-move ("a mail already in the target is skipped",
 * core/index.ts) and returns no op for it, while the release effect only shows a hidden mail again once it
 * has left the list. So the rows disappeared and stayed gone until an account switch or a restart, and a
 * mixed selection did the same for the mails it skipped.
 *
 * Coverage is decided by source folder and UID, not by row id: an `OpSummary` carries one `uid` for a
 * plain move and no id list at all. A move of two or more mails out of one folder is ONE `move_batch` op
 * with `uid: null` (core/index.ts moveToFolder), and a done batch covers every mail of its source folder -
 * the caller shows ALL rows again as soon as any op is not done, so a half-done split batch never gets here.
 */
import type { FolderNode, OpSummary } from '../../../../main/mailclient/core/types'

/** A list row as the mail page has it: the row id, its folder, and the UID the server op carries */
export type ArchiveItem = { id: number; folderId: string; uid: number }

/** The part of an OpSummary this decision reads */
export type MoveOp = Pick<OpSummary, 'kind' | 'uid' | 'state' | 'folderPath'>

const isArchive = (folder: FolderNode | undefined): boolean =>
  Boolean(folder?.specialUse?.includes('Archive'))

const isTrash = (folder: FolderNode | undefined): boolean =>
  Boolean(folder?.specialUse?.includes('Trash'))

/**
 * The row ids an archive may act on: not the mails already in Archive (a self-move the core refuses) and
 * not the ones in Trash (archiving out of Trash is a move nobody asked for).
 *
 * A mail whose folder is not in the list yet is KEPT: the list can lag, and dropping it silently would be
 * the same class of bug this module exists for.
 */
export function archiveableIds(items: ArchiveItem[], folders: FolderNode[]): number[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  return items
    .filter((item) => {
      const folder = byId.get(item.folderId)
      if (!folder) return true
      return !isArchive(folder) && !isTrash(folder)
    })
    .map((item) => item.id)
}

/** Does this done op account for the mail? UIDs are only unique within a folder, so the path counts too. */
function covers(op: MoveOp, item: ArchiveItem, path: string | undefined): boolean {
  if (op.state !== 'done') return false
  if (op.kind === 'move_batch') return path !== undefined && op.folderPath === path
  // a folder the list does not know yet falls back to the UID alone rather than showing the mail again
  return op.uid === item.uid && (path === undefined || op.folderPath === path)
}

function coveredBy(ops: MoveOp[], folders: FolderNode[]): (item: ArchiveItem) => boolean {
  const pathOf = new Map(folders.map((f) => [f.id, f.path]))
  return (item) => ops.some((op) => covers(op, item, pathOf.get(item.folderId)))
}

/** The mails to show again: every hidden one that no DONE op covers. */
export function uncoveredIds(
  items: ArchiveItem[],
  ops: MoveOp[],
  folders: FolderNode[]
): ArchiveItem[] {
  const isCovered = coveredBy(ops, folders)
  return items.filter((item) => !isCovered(item))
}

/** How many mails the core actually archived - what the toast must say, not the selection size. */
export function archivedCount(items: ArchiveItem[], ops: MoveOp[], folders: FolderNode[]): number {
  const isCovered = coveredBy(ops, folders)
  return new Set(items.filter(isCovered).map((item) => item.id)).size
}
