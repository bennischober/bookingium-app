// R1: the per-folder mutex, out of SyncEngine. The sync connection, the IDLE connection and
// the write engine (through the engine's withFolderMutexPublic hook) all take a folder here
// before they touch it.
import type { Store } from './store.js';

export class FolderLocks {
  // per-folder mutex: main connection and IDLE connection must never sync the same
  // folder concurrently (two downloads of the same UIDs, duplicated work, wasted I/O)
  readonly syncingFolders = new Map<string, symbol>();
  // write ops waiting for a folder's mutex, by path (see yieldFolderToWrites)
  private writesWaiting = new Map<string, number>();

  /**
   * A6: the folder mutex carries an OWNER token. `finally` releases only if the
   * entry still holds this call's token, so a watchdog that gives up on a stuck op
   * can never release a lock some other holder owns (F2).
   */
  async withFolderMutex<T>(imapPath: string, fn: () => Promise<T>, owner: symbol = Symbol('folder-mutex')): Promise<T> {
    while (this.syncingFolders.has(imapPath)) await new Promise(r => setTimeout(r, 250));
    this.syncingFolders.set(imapPath, owner);
    try { return await fn(); } finally {
      if (this.syncingFolders.get(imapPath) === owner) this.syncingFolders.delete(imapPath);
    }
  }

  /** Task 4: write engine hook — same mutex, public access (single-writer rule per folder).
   *  A write waiting here is counted, so a long download lets it in between batches. */
  async withFolderMutexPublic<T>(imapPath: string, fn: () => Promise<T>): Promise<T> {
    this.writesWaiting.set(imapPath, (this.writesWaiting.get(imapPath) ?? 0) + 1);
    let waiting = true;
    const stopWaiting = () => {
      if (!waiting) return;
      waiting = false;
      const n = (this.writesWaiting.get(imapPath) ?? 1) - 1;
      if (n > 0) this.writesWaiting.set(imapPath, n); else this.writesWaiting.delete(imapPath);
    };
    try {
      return await this.withFolderMutex(imapPath, () => { stopWaiting(); return fn(); });
    } finally {
      stopWaiting();
    }
  }

  /** Called between download batches by the holder of the folder's mutex: a write op
   *  waiting for this folder goes first. The first download of a big folder holds the
   *  mutex for minutes; without this a move into it hung until the download was done. */
  async yieldFolderToWrites(imapPath: string): Promise<void> {
    if (!this.writesWaiting.has(imapPath)) return;
    const owner = this.syncingFolders.get(imapPath);
    this.syncingFolders.delete(imapPath);
    // wait until the writer has taken the folder and given it back (or anyone else has)
    while (this.writesWaiting.has(imapPath) || this.syncingFolders.has(imapPath)) {
      await new Promise(r => setTimeout(r, 100));
    }
    // A6: take it back under OUR token only if nobody else took it meanwhile
    if (!this.syncingFolders.has(imapPath) && owner !== undefined) this.syncingFolders.set(imapPath, owner);
  }
}

/** Task 4: does any pending/running write op touch this folder? (sync coexistence) */
export function hasInFlightOps(store: Store, folderPath: string): boolean {
  return store.db.prepare(`SELECT 1 FROM op_journal WHERE folder_path = ? OR target_folder_path = ?
    LIMIT 1`).get(folderPath, folderPath) !== undefined;
}
