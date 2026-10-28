// S1: completing a message stored as its skeleton (`complete = 0`, core/skeleton.ts). Every door
// that needs the large parts (an attachment's bytes, the raw .eml, a forward's files, a draft read
// back) asks `ensureComplete` first; the whole message is downloaded once, and from then on the
// row is complete like any other (no eviction in v1). The repair sweep writes whole files through
// `adoptWholeSource` too, so a former skeleton row never keeps its estimated attachment sizes.
import fs from 'fs';
import { writeMessageFile } from './files.js';
import { parseMessage } from './parse.js';
import { attachmentColumns } from './message_ingest.js';
import { diskFullMessage, isDiskFullError } from './disk_full.js';
import type { MessageRow, Store } from './store.js';
import type { AccountEntry } from './index.js';

/** The UID is gone, or the folder's UIDVALIDITY changed: the message cannot be fetched again */
export const GONE_MESSAGE = 'Nachricht ist nicht mehr auf dem Server';
/** The server could not be reached */
export const OFFLINE_MESSAGE = 'Offline – der Anhang ist noch nicht geladen';

export class MessageCompletion {
  /** One download per row: a second caller waits for the first one's */
  private readonly running = new Map<string, Promise<MessageRow>>();

  constructor(private readonly log: { warn?: (msg: string) => void } = {}) {}

  /**
   * The row with a whole file: as it is when complete, otherwise after `BODY.PEEK[]` on the
   * account's sync connection (behind its gate, no extra connection). Errors carry no mail content.
   */
  ensureComplete(e: AccountEntry, row: MessageRow): Promise<MessageRow> {
    if (row.complete !== 0) return Promise.resolve(row);
    const key = `${e.config.id}:${row.id}`;
    let pending = this.running.get(key);
    if (!pending) {
      pending = this.complete(e, row).finally(() => this.running.delete(key));
      this.running.set(key, pending);
    }
    return pending;
  }

  private async complete(e: AccountEntry, row: MessageRow): Promise<MessageRow> {
    if (e.engine.isDiskFull) throw new Error(diskFullMessage());
    const folder = e.store.getFolder(row.folder_id);
    if (!folder) throw new Error(GONE_MESSAGE);
    let source: Buffer | null;
    try {
      // withSelected is null when UIDVALIDITY changed; imapflow's `source` is BODY.PEEK[], so no \Seen
      source = await e.engine.withSelected(folder.imap_path, folder.uid_validity, async client => {
        const msg = await client.fetchOne(String(row.uid), { uid: true, source: true }, { uid: true });
        return msg && msg.source ? msg.source : null;
      });
    } catch (err) {
      this.log.warn?.(`completing a message failed: ${(err as Error).message.slice(0, 80)}`);
      throw new Error(OFFLINE_MESSAGE);
    }
    if (!source) throw new Error(GONE_MESSAGE);
    try {
      if (!(await adoptWholeSource(e.store, row, source))) {
        // the row changed meanwhile (deleted, or completed another way): answer with what it is now
        const now = e.store.getMessage(row.id);
        if (!now) throw new Error(GONE_MESSAGE);
        return now;
      }
    } catch (err) {
      if (!isDiskFullError(err)) throw err;
      e.engine.noteDiskFull(folder.imap_path);
      throw new Error(diskFullMessage());
    }
    const done = e.store.getMessage(row.id);
    if (!done) throw new Error(GONE_MESSAGE);
    return done;
  }
}

/**
 * Points the row at a new file holding its whole message: `file_path`, `complete = 1` and the
 * attachment list of the full parse in one transaction, then the old file is unlinked (a leftover
 * is an orphan for the sweep). False when the row no longer has `row.file_path`: the new file is
 * removed again. A message mailparser cannot read keeps its attachment columns.
 */
export async function adoptWholeSource(store: Store, row: Pick<MessageRow, 'id' | 'file_path'>, source: Buffer): Promise<boolean> {
  let columns: ReturnType<typeof attachmentColumns> | null = null;
  try { columns = attachmentColumns(await parseMessage(source)); } catch { /* the bytes are still the message */ }
  const relPath = writeMessageFile(store.dataDirResolved, source);
  const changed = store.db.transaction(() => columns
    ? store.db.prepare('UPDATE messages SET file_path = ?, complete = 1, attachments_json = ?, has_attachments = ? WHERE id = ? AND file_path = ?')
      .run(relPath, columns.attachments_json, columns.has_attachments, row.id, row.file_path).changes
    : store.db.prepare('UPDATE messages SET file_path = ?, complete = 1 WHERE id = ? AND file_path = ?')
      .run(relPath, row.id, row.file_path).changes)();
  const stale = changed ? row.file_path : relPath;
  try { fs.unlinkSync(store.filePath(stale)); } catch { /* already gone (repair), or held open: the sweep takes it */ }
  return changed > 0;
}
