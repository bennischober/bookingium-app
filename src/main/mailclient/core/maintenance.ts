// R2: the housekeeping of MailCore, out of core/index.ts: waiting for the initial downloads,
// the orphan-file sweep, re-fetching missing message files, and the row/file consistency
// count. MailCore keeps one-line delegations.
import fs from 'fs';
import path from 'path';
import { listMessageFiles, writeMessageFile } from './files.js';
import { isDiskFullError } from './disk_full.js';
import { fetchSkeleton, storedAsSkeleton } from './skeleton_fetch.js';
import { adoptWholeSource } from './message_complete.js';
import type { AccountEntry, Logger } from './index.js';

/** What the housekeeping needs from the core. */
export interface MaintenanceContext {
  /** The core's account entries: the same Map for the core's whole life. */
  readonly entries: Map<string, AccountEntry>;
  readonly log: Logger;
  readonly clock: () => number;
  entry(id?: string): AccountEntry;
}

export class Maintenance {
  constructor(private readonly ctx: MaintenanceContext) {}

  private get entries(): Map<string, AccountEntry> { return this.ctx.entries; }
  private get log(): Logger { return this.ctx.log; }
  private get clock(): () => number { return this.ctx.clock; }
  private entry(id?: string): AccountEntry { return this.ctx.entry(id); }

  /**
   * A3 step 6: resolve once no account is in its initial download (or timeout).
   * Housekeeping waits for this so a sweep never competes with a first sync.
   *
   * I4 (MR-10): `true` when every account is idle, `false` on timeout. A timeout used to
   * resolve like idle, so after two minutes the repair ran in the middle of the download it
   * was meant to wait for; the caller now skips this round and the next one tries again.
   */
  async whenIdleForMaintenance(timeoutMs = 120_000): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const busy = [...this.entries.values()].some(e =>
        e.engine.isSyncing() && e.engine.getStatus().phase === 'initial');
      if (!busy) return true;
      if (Date.now() > until) return false;
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  /**
   * Periodic orphan-file sweep (card A3 step 6). Files that belong to no row are MOVED to
   * `<accountDir>/orphans/` after the grace period, never deleted straight away; files that
   * have sat there for 7 days are deleted. A `.tmp` file older than the grace period is
   * treated like an orphan (its write never completed). Files a row references are never
   * touched. Returns the number of files moved to `orphans/`.
   */
  sweepOrphans(graceMs = 10 * 60 * 1000, orphanTtlMs = 7 * 24 * 60 * 60 * 1000): number {
    let moved = 0;
    const now = this.clock();
    for (const [id, e] of this.entries) {
      try {
        const dir = e.store.dataDirResolved;
        if (!fs.existsSync(dir)) continue;
        // I12: files kept for re-linking after a rebuild belong to no row yet; they are
        // protected until the orphan TTL, then the entry expires and the file is swept
        const known = e.store.relinkFiles(new Date(now - orphanTtlMs).toISOString());
        for (const r of e.store.db.prepare('SELECT file_path FROM messages').all() as { file_path: string }[]) known.add(r.file_path);
        const orphanDir = path.join(dir, 'orphans');
        const cutoff = now - graceMs;
        for (const f of listMessageFiles(dir)) {
          if (known.has(f)) continue;
          try {
            const abs = path.join(dir, f);
            if (fs.statSync(abs).mtimeMs >= cutoff) continue;
            fs.mkdirSync(orphanDir, { recursive: true });
            // the name is a UUID, so orphans/ stays one flat folder
            fs.renameSync(abs, path.join(orphanDir, path.basename(f)));
            moved++;
          } catch { /* racing with the row insert — next sweep retries */ }
        }
        // Files parked in orphans/ expire after a week
        if (fs.existsSync(orphanDir)) {
          const expiry = now - orphanTtlMs;
          for (const f of fs.readdirSync(orphanDir)) {
            try {
              const abs = path.join(orphanDir, f);
              if (fs.statSync(abs).mtimeMs < expiry) fs.unlinkSync(abs);
            } catch { /* another sweep or a lock — next one retries */ }
          }
        }
      } catch (err) {
        this.log.error?.(`orphan sweep (${id}) failed: ${(err as Error).message}`);
      }
    }
    return moved;
  }

  /**
   * A3 step 5: re-fetch the source of rows whose file is missing and rewrite it.
   * A FETCH is a read, so this is allowed for read-only accounts too, but it must use
   * the sync engine's own connection (the 2-connection limit) - never a new client.
   * At most `limit` rows per account and pass, so a big repair never blocks the sync loop.
   * Rows whose UID is gone from the server are left alone: the normal sync removes them.
   *
   * I4 (MR-10): every folder is read through `engine.withSelected` - folder mutex, EXAMINE
   * under an imapflow lock, UIDVALIDITY checked. The bare `mailboxOpen` before it SELECTed
   * (read-write, on a read-only account), raced the sync's own lock on the same connection
   * and could write another folder's message into a row when the UIDs had been reassigned.
   * Without an `accountId` every account is repaired, not only the default one; an account
   * whose disk is full is skipped, and a full disk found here stops that account's sync.
   */
  async repairMissingFiles(limit = 50, accountId?: string): Promise<{ repaired: number; left: number }> {
    const entries = accountId ? [this.entry(accountId)] : [...this.entries.values()];
    let repaired = 0, left = 0;
    for (const e of entries) {
      const r = await this.repairAccountFiles(e, limit);
      repaired += r.repaired;
      left += r.left;
    }
    return { repaired, left };
  }

  private async repairAccountFiles(e: AccountEntry, limit: number): Promise<{ repaired: number; left: number }> {
    const dir = e.store.dataDirResolved;
    const rows = e.store.db.prepare(
      'SELECT id, folder_id, uid, file_path, size_bytes FROM messages ORDER BY id DESC')
      .all() as { id: number; folder_id: string; uid: number; file_path: string; size_bytes: number }[];
    const onDisk = new Set(listMessageFiles(dir));
    const allMissing = rows.filter(r => !onDisk.has(r.file_path));
    if (!allMissing.length) return { repaired: 0, left: 0 };
    if (e.engine.isDiskFull) return { repaired: 0, left: allMissing.length };

    const byFolder = new Map<string, typeof allMissing>();
    for (const row of allMissing.slice(0, limit)) {
      const list = byFolder.get(row.folder_id) ?? [];
      list.push(row);
      byFolder.set(row.folder_id, list);
    }
    let repaired = 0;
    for (const [folderId, missing] of byFolder) {
      const folder = e.store.getFolder(folderId);
      if (!folder) continue;
      try {
        const done = await e.engine.withSelected(folder.imap_path, folder.uid_validity, async client => {
          let n = 0;
          for (const row of missing) {
            // S1: the download pass's threshold; size_bytes is the server size. `complete` says
            // what the new file holds, whatever the row held before.
            const skeleton = storedAsSkeleton(e.config.lazyAboveBytes, row.size_bytes) ? await fetchSkeleton(client, row.uid) : null;
            if (skeleton) {
              const relPath = writeMessageFile(dir, skeleton.source);
              e.store.db.prepare('UPDATE messages SET file_path = ?, complete = 0 WHERE id = ?').run(relPath, row.id);
              n++;
              continue;
            }
            const msg = await client.fetchOne(String(row.uid), { uid: true, source: true }, { uid: true });
            // a whole file also replaces a former skeleton row's estimated attachment sizes
            if (msg && msg.source && await adoptWholeSource(e.store, row, msg.source)) n++;
          }
          return n;
        });
        repaired += done ?? 0;
      } catch (err) {
        if (isDiskFullError(err)) {
          e.engine.noteDiskFull(folder.imap_path);
          break;
        }
        this.log.warn?.(`repair (${missing.length} row(s) of one folder) skipped: ${(err as Error).message.slice(0, 80)}`);
      }
    }
    return { repaired, left: Math.max(0, allMissing.length - repaired) };
  }

  /**
   * Consistency of rows and files (card A3 step 4). Read-only, counts only.
   */
  checkFileConsistency(accountId?: string): { rowsWithoutFile: number; filesWithoutRow: number; tmpFiles: number } {
    const e = this.entry(accountId);
    const dir = e.store.dataDirResolved;
    const rows = e.store.db.prepare('SELECT file_path FROM messages').all() as { file_path: string }[];
    const files = new Set(listMessageFiles(dir));
    const referenced = new Set(rows.map(r => r.file_path));
    let rowsWithoutFile = 0;
    for (const r of referenced) if (!files.has(r)) rowsWithoutFile++;
    let filesWithoutRow = 0;
    let tmpFiles = 0;
    for (const f of files) {
      if (f.endsWith('.tmp')) tmpFiles++;
      if (!referenced.has(f)) filesWithoutRow++;
    }
    return { rowsWithoutFile, filesWithoutRow, tmpFiles };
  }
}
