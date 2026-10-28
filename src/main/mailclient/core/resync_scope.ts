/**
 * G2/L3b: which folders a move needs to resync.
 *
 * Every write used to fire a full syncAll() afterwards. That pass does detectCapabilities plus a
 * STATUS per folder with a 150 ms pause between each (requestDelayMs, tuned for IONOS), so a
 * ten-folder mailbox paid roughly 1.5 seconds of pure sleeping after every single click - on top
 * of the write itself.
 *
 * Only the folders a move actually touched can have changed, so only they are resynced. Kept pure
 * because the failure mode is silent: asking for one folder too many just brings the delay back,
 * and nothing else in the suite would notice.
 */
export interface OpFolders {
  folder_path?: string | null
  target_folder_path?: string | null
}

/** The distinct folders these ops touched: source and target, in the order first seen */
export function foldersToResync(ops: readonly OpFolders[]): string[] {
  const paths: string[] = []
  for (const op of ops) {
    for (const path of [op.folder_path, op.target_folder_path]) {
      if (path && !paths.includes(path)) paths.push(path)
    }
  }
  return paths
}
