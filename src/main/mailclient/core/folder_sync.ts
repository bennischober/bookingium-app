// R1: one folder's sync pass, out of SyncEngine: the full and the incremental pass, the
// UIDVALIDITY swap with its staging folder, downloading and adopting relinked files, and the
// mass-expunge check. The engine keeps one-line delegations. Tests override some of them on the
// engine (downloadMessages, fullSyncFolder), so the passes call each other through the context.
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import fs from 'fs';
import { STAGING_PREFIX, Store, Flags } from './store.js';
import { isDiskFullError, swapSpaceMessage, swapSpaceNeeded } from './disk_full.js';
import { flagsFromSet, MessageIngest, toIso } from './message_ingest.js';
import { fetchSkeleton, storedAsSkeleton } from './skeleton_fetch.js';
import type { AccountConfig, SyncEvent, SyncProgress } from './sync.js';

/** I12 (MR-41): an expunge this large in one pass needs EXAMINE's EXISTS to confirm the UID list. */
const MASS_EXPUNGE_MIN = 20;
const MASS_EXPUNGE_SHARE = 0.2;

type DownloadOptions = { newestFirst?: boolean; keyFolderId?: string; yieldToWrites?: boolean };

/** What one folder's pass needs from its engine. */
export interface FolderSyncContext {
  readonly account: AccountConfig;
  readonly store: Store;
  readonly log: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
  /** The engine's progress; a new pass replaces the object, so it is read on every use. */
  progress(): SyncProgress;
  emit(e: SyncEvent): void;
  isStopped(): boolean;
  isPaused(): boolean;
  waitWhilePaused(): Promise<void>;
  connect(): Promise<ImapFlow>;
  gate(): Promise<void>;
  noteError(context: string): boolean;
  hasCondstore(): boolean;
  yieldFolderToWrites(imapPath: string): Promise<void>;
  freeBytes(dir: string): number | null;
  noteDiskFull(path: string | null, message?: string): void;
  diskFullError(): Error;
  storeMessage(folderId: string, uidValidity: string, msg: Parameters<MessageIngest['storeMessage']>[2],
    opts?: Parameters<MessageIngest['storeMessage']>[3]): Promise<void>;
  // the engine's own methods, so an override on the engine takes effect inside a pass
  downloadMessages(client: ImapFlow, uids: number[], imapPath: string, folderId: string, uidValidity: string, opts?: DownloadOptions): Promise<number>;
  fullSyncFolder(client: ImapFlow, imapPath: string, uidValidity: string, highestModseq: string | null, uidNext?: number): Promise<void>;
  incrementalSyncFolder(client: ImapFlow, imapPath: string, uidValidity: string, changedSince: bigint, highestModseq: string | null, uidNext?: number): Promise<void>;
  resyncAfterValidityChange(client: ImapFlow, imapPath: string, folderId: string, uidValidity: string, highestModseq: string | null, uidNext?: number): Promise<void>;
}

export class FolderSync {
  constructor(private readonly ctx: FolderSyncContext) {}

  private get account(): AccountConfig { return this.ctx.account; }
  private get store(): Store { return this.ctx.store; }
  private get log(): FolderSyncContext['log'] { return this.ctx.log; }
  private get progress(): SyncProgress { return this.ctx.progress(); }
  private get stopped(): boolean { return this.ctx.isStopped(); }
  private get paused(): boolean { return this.ctx.isPaused(); }
  private get hasCondstore(): boolean { return this.ctx.hasCondstore(); }
  private emit(e: SyncEvent): void { this.ctx.emit(e); }
  private waitWhilePaused(): Promise<void> { return this.ctx.waitWhilePaused(); }
  private connect(): Promise<ImapFlow> { return this.ctx.connect(); }
  private gate(): Promise<void> { return this.ctx.gate(); }
  private noteError(context: string): boolean { return this.ctx.noteError(context); }
  private yieldFolderToWrites(imapPath: string): Promise<void> { return this.ctx.yieldFolderToWrites(imapPath); }
  private freeBytes(dir: string): number | null { return this.ctx.freeBytes(dir); }
  private noteDiskFull(path: string | null, message?: string): void { this.ctx.noteDiskFull(path, message); }
  private diskFullError(): Error { return this.ctx.diskFullError(); }
  private storeMessage(folderId: string, uidValidity: string, msg: Parameters<MessageIngest['storeMessage']>[2],
    opts?: Parameters<MessageIngest['storeMessage']>[3]): Promise<void> {
    return this.ctx.storeMessage(folderId, uidValidity, msg, opts);
  }

  async syncFolderInner(imapPath: string, opts: { full?: boolean } = {}): Promise<void> {
    const client = await this.connect();
    const folder = this.store.getFolderByPath(imapPath);
    if (!folder) throw new Error(`folder ${imapPath} not found in store`);
    const prevValidity = folder?.uid_validity ?? null;
    const prevModseq = folder?.highest_modseq ? BigInt(folder.highest_modseq) : null;

    const lock = await client.getMailboxLock(imapPath, this.account.readOnly ? { readOnly: true } : {});
    try {
      // Task 3 (found by diag-expunge-clean.ts): getMailboxLock does NOT re-select an
      // already-selected mailbox, and a selected session's view can lag the server by a
      // full command (queued EXPUNGE/EXISTS pushes are applied lazily). Every folder sync
      // therefore forces a fresh SELECT (EXAMINE when read-only) so the UID list fetch
      // sees the CURRENT server state.
      await client.mailboxOpen(imapPath, this.account.readOnly ? { readOnly: true } : {});
      const mailbox = client.mailbox;
      if (!mailbox) throw new Error(`mailbox ${imapPath} did not open`);
      const uidValidity = String(mailbox.uidValidity);
      const highestModseq = mailbox.highestModseq ? String(mailbox.highestModseq) : null;

      // UIDVALIDITY reset = folder was rebuilt on server. Task 3 safety: NEVER wipe local
      // data first — stage the fresh download alongside the old rows, swap atomically, and
      // only delete the old rows' FILES after the new rows are durably stored. The DB
      // transaction guarantees the visible state flips in one step.
      if (prevValidity && prevValidity !== uidValidity) {
        this.emit({ type: 'folder-start', path: imapPath, mode: 'full' });
        await this.ctx.resyncAfterValidityChange(client, imapPath, folder.id, uidValidity, highestModseq, mailbox.uidNext);
        return;
      }

      // mode decision: full vs incremental. Without CONDSTORE, a "full" pass is still
      // cheap-ish: UID list diff + flags refresh + new downloads; old bodies are kept.
      const mode: 'full' | 'incremental' = (opts.full || !folder || !prevModseq) ? 'full' : 'incremental';
      this.emit({ type: 'folder-start', path: imapPath, mode });

      if (mode === 'full') {
        await this.ctx.fullSyncFolder(client, imapPath, uidValidity, highestModseq, mailbox.uidNext);
      } else {
        await this.ctx.incrementalSyncFolder(client, imapPath, uidValidity, prevModseq!, highestModseq, mailbox.uidNext);
      }
    } catch (e) {
      this.emit({ type: 'error', path: imapPath, message: (e as Error).message });
      // A full disk is not a connection fault: it must reach syncAll's disk-full branch so the
      // pass stops and the user is told the truth, instead of being swallowed here as a generic
      // folder error (which leaves the UI saying "offline" or nothing at all).
      if (isDiskFullError(e)) throw e;
      const open = this.noteError(imapPath);
      if (open) throw e;      // circuit breaker: abort the pass
    } finally {
      lock.release();
    }
  }

  /**
   * Task 3: UIDVALIDITY changed on the server. Old rows keep their row ids until the
   * replacement data is fully stored; then one transaction swaps the folder mapping
   * (message_key contains uidValidity, so old and new keys cannot collide), and old
   * .eml files are unlinked only afterwards. Local data is never lost on a failed
   * resync — the worst case is a stale copy that the next pass replaces.
   *
   * I12 (MR-41): the staged rows really live under the staging folder now (they were inserted
   * into the real folder, next to the old rows), and they survive a failed pass: the next one
   * downloads only what is not staged yet, so a large INBOX on a flaky connection converges
   * instead of starting over. Staging of an older UIDVALIDITY is dropped first. The swap deletes
   * every old row, so it waits until EXAMINE's EXISTS confirms the new UID list.
   */
  async resyncAfterValidityChange(client: ImapFlow, imapPath: string, folderId: string, uidValidity: string, highestModseq: string | null, uidNext?: number): Promise<void> {
    const oldRows = this.store.db.prepare('SELECT id, file_path, message_key, size_bytes FROM messages WHERE folder_id = ?')
      .all(folderId) as { id: number; file_path: string; message_key: string; size_bytes: number }[];

    // stage the fresh download under a temp folder mapping (message_key includes the NEW
    // uidValidity → old and new rows cannot collide, both can coexist during download)
    const stagingPath = `${STAGING_PREFIX}${imapPath}`;
    const prior = this.store.getFolderByPath(stagingPath);
    if (prior && prior.uid_validity !== uidValidity) this.dropStaging(prior.id);
    const tempFolder = this.store.upsertFolder({ imapPath: stagingPath, delimiter: '/', specialUse: null, uidValidity });
    const serverUids = new Set<number>();
    for await (const m of client.fetch('1:*', { uid: true }, { uid: true })) serverUids.add(Number(m.uid));
    const stagedRows = this.store.db.prepare('SELECT id, uid, file_path, size_bytes FROM messages WHERE folder_id = ?')
      .all(tempFolder.id) as { id: number; uid: number; file_path: string; size_bytes: number }[];
    const staged = new Set(stagedRows.map(r => r.uid));
    // I18: the old copy stays until the swap, so the new one needs room next to it. Without that
    // room the download fails halfway; stop before it starts and say how much is missing. What
    // is staged stays for the next pass, as after any other stop.
    const sum = (rows: { size_bytes: number }[]) => rows.reduce((n, r) => n + (r.size_bytes || 0), 0);
    const needed = swapSpaceNeeded(sum(oldRows), sum(stagedRows));
    const free = this.freeBytes(this.store.filePath(''));
    if (free !== null && free < needed) {
      this.noteDiskFull(imapPath, swapSpaceMessage(imapPath, needed - free));
      throw this.diskFullError();
    }
    // BUG FIX (found 2026-10-23, consistency suite after a live staged swap): the
    // staged download previously computed message_key with tempFolder.id — the swap
    // then moved rows to the real folder id but the key kept the staging id baked
    // in, producing unrecomputable keys (sha1(account|stagingId|validity|uid)).
    // The key must ALWAYS be derived from the REAL folder id; the staging folder
    // only exists so old and new rows can coexist in the DB during download.
    await this.ctx.downloadMessages(client, [...serverUids].filter(u => !staged.has(u)), imapPath, tempFolder.id, uidValidity, { newestFirst: true, keyFolderId: folderId });
    // stopped mid-download: what is staged waits for the next pass
    if (this.stopped) return;
    if (!this.expungeConfirmed(client, imapPath, serverUids.size, oldRows.length, oldRows.length)) {
      this.emit({ type: 'folder-done', path: imapPath, newCount: 0, flagChanges: 0, expunged: 0, moved: 0 });
      return;
    }

    // staged on an earlier pass, expunged since
    const vanished = stagedRows.filter(r => !serverUids.has(r.uid));
    this.store.deleteMessages(vanished.map(r => r.id));
    for (const r of vanished) {
      try { fs.unlinkSync(this.store.filePath(r.file_path)); } catch { /* the row is gone; a leftover file is an orphan for the sweep */ }
    }

    // atomic swap: new rows move to the real folder id, old rows' DB rows disappear
    const swap = this.store.db.transaction(() => {
      this.store.db.prepare('UPDATE messages SET folder_id = ? WHERE folder_id = ?').run(folderId, tempFolder.id);
      for (const r of oldRows) this.store.db.prepare('DELETE FROM messages WHERE id = ?').run(r.id);
      this.store.db.prepare(`UPDATE folders SET uid_validity=@v, uid_next=@n, highest_modseq=@m,
        last_sync_at=datetime('now'), last_flag_sweep=datetime('now') WHERE id=@id`)
        .run({ v: uidValidity, n: nextUid(uidNext, serverUids), m: highestModseq, id: folderId });
      this.store.db.prepare('DELETE FROM folders WHERE id = ?').run(tempFolder.id);
    });
    swap();

    // files: unlink ONLY the old rows' files, and only after the swap committed.
    // Guard: never unlink a file whose name belongs to a surviving row (by design the
    // key includes uidValidity, so old and new keys differ — guard costs nothing).
    const survivingKeys = new Set(
      (this.store.db.prepare('SELECT message_key FROM messages WHERE folder_id = ?').all(folderId) as { message_key: string }[])
        .map(r => r.message_key)
    );
    for (const r of oldRows) {
      if (survivingKeys.has(r.message_key)) continue;
      try { fs.unlinkSync(this.store.filePath(r.file_path)); } catch { /* UIDVALIDITY swap: an unreadable leftover is an orphan for the sweep, never a row without a file */ }
    }
    this.emit({ type: 'folder-done', path: imapPath, newCount: serverUids.size, flagChanges: 0, expunged: oldRows.length, moved: 0 });
  }

  /** I12: drop a staging folder with its rows and files (all re-downloadable). Rows first, for the FK. */
  dropStaging(stagingId: string): void {
    const staged = this.store.db.prepare('SELECT id, file_path FROM messages WHERE folder_id = ?')
      .all(stagingId) as { id: number; file_path: string }[];
    this.store.deleteMessages(staged.map(r => r.id));
    for (const r of staged) {
      try { fs.unlinkSync(this.store.filePath(r.file_path)); } catch { /* re-downloadable: a failed unlink only leaves an orphan */ }
    }
    this.store.db.prepare('DELETE FROM folders WHERE id = ?').run(stagingId);
  }

  /**
   * I12 (MR-41): an empty or truncated `UID FETCH 1:*` looks exactly like a mass expunge. Up to
   * MASS_EXPUNGE_MIN rows, or a share of at most MASS_EXPUNGE_SHARE of the folder, go through
   * as before; anything larger needs the UID list to be at least as long as the EXISTS of the
   * EXAMINE this sync just ran (imapflow keeps it current with EXISTS and EXPUNGE responses).
   * Refused, nothing is deleted this pass and the next pass asks again.
   */
  private expungeConfirmed(client: ImapFlow, imapPath: string, serverCount: number, expungeCount: number, localCount: number): boolean {
    if (expungeCount < MASS_EXPUNGE_MIN || expungeCount <= localCount * MASS_EXPUNGE_SHARE) return true;
    const exists = client.mailbox ? client.mailbox.exists : undefined;
    if (typeof exists === 'number' && serverCount >= exists) return true;
    this.log.warn?.(`${imapPath}: the server listed ${serverCount} of ${exists ?? 'an unknown number of'} message(s); ` +
      `not removing ${expungeCount} of ${localCount} local message(s) this pass`);
    return false;
  }

  // @ts-ignore unused, kept in sync with the prototype
  private wipeFolderRows(folderId: string): void {
    const rows = this.store.db.prepare('SELECT id, file_path FROM messages WHERE folder_id = ?')
      .all(folderId) as { id: number; file_path: string }[];
    this.store.deleteMessages(rows.map(r => r.id));
    for (const r of rows) {
      try { fs.unlinkSync(this.store.filePath(r.file_path)); } catch { /* already gone */ }
    }
  }

  async fullSyncFolder(client: ImapFlow, imapPath: string, uidValidity: string, highestModseq: string | null, uidNext?: number): Promise<void> {
    // folder row may not exist yet when the IDLE connection races syncFolderList at startup
    const folder = this.store.getFolderByPath(imapPath)
      ?? this.store.upsertFolder({ imapPath, delimiter: '/', specialUse: null, uidValidity });
    let newCount = 0, flagChanges = 0, expunged = 0;

    // 1. authoritative UID list
    const serverUids = new Set<number>();
    for await (const m of client.fetch('1:*', { uid: true }, { uid: true })) serverUids.add(Number(m.uid));

    // 2. local rows for this folder
    const localRows = this.store.db
      .prepare('SELECT id, uid, message_key, file_path, modseq, flags_json, internal_date FROM messages WHERE folder_id = ?')
      .all(folder.id) as { id: number; uid: number; message_key: string; file_path: string; modseq: string | null; flags_json: string; internal_date: string | null }[];
    const localByUid = new Map(localRows.map(r => [r.uid, r]));

    // 3. expunged = local uids not on server
    // Task 4 coexistence: UIDs with pending/running write ops are excluded — our own
    // move/delete removes them server-side mid-playback; the op's completion updates
    // the local row (re-keyed to the destination) and cleanup must not race it.
    const expungedLocal = localRows.filter(r => !serverUids.has(r.uid) && !this.store.opInFlightForMessageKey(r.message_key));
    if (expungedLocal.length && this.expungeConfirmed(client, imapPath, serverUids.size, expungedLocal.length, localRows.length)) {
      this.store.deleteMessages(expungedLocal.map(r => r.id));
      for (const r of expungedLocal) {
        try { fs.unlinkSync(this.store.filePath(r.file_path)); } catch { /* local uid vanished server-side: the row is gone already, a leftover file is an orphan for the sweep */ }
      }
      expunged = expungedLocal.length;
    }

    // 4. flags + modseq refresh for all server uids (cheap, no bodies)
    const flagUpdates = new Map<number, { flags: Flags; modseq: string | null; internalDate: string | null }>();
    for await (const m of client.fetch('1:*', { uid: true, flags: true, internalDate: true }, { uid: true })) {
      flagUpdates.set(Number(m.uid), {
        flags: flagsFromSet(m.flags),
        modseq: m.modseq !== undefined ? String(m.modseq) : null,   // present when CONDSTORE enabled
        internalDate: toIso(m.internalDate),
      });
    }
    for (const [uid, info] of flagUpdates) {
      const local = localByUid.get(uid);
      if (!local) continue;
      // Task 4 coexistence: a pending/running journal op owns this message's flags —
      // don't clobber the optimistic local state with the (older) server view
      if (this.store.opInFlightForMessageKey(local.message_key)) continue;
      const localFlags = JSON.parse(local.flags_json) as Flags;
      if (JSON.stringify(localFlags) !== JSON.stringify(info.flags) ||
          (info.modseq && local.modseq !== info.modseq)) {
        this.store.updateMessageFlags(local.id, JSON.stringify(info.flags), info.modseq,
          info.internalDate ?? local.internal_date ?? null);
        flagChanges++;
      }
    }

    // 5. download new messages
    // (writes may run between batches: the steps below only use the UID snapshot,
    // and a stale uid_next/highest_modseq just makes the next sync look further back)
    newCount = await this.ctx.downloadMessages(client, [...serverUids].filter(u => !localByUid.has(u)), imapPath, folder.id, uidValidity,
      { yieldToWrites: true });

    this.store.db.prepare(`UPDATE folders SET uid_validity=@uidValidity, uid_next=@uidNext,
      highest_modseq=@highestModseq, last_sync_at=datetime('now'),
      last_flag_sweep=datetime('now') WHERE id=@id`)
      .run({ uidValidity, uidNext: nextUid(uidNext, serverUids), highestModseq, id: folder.id });

    this.emit({ type: 'folder-done', path: imapPath, newCount, flagChanges, expunged, moved: 0 });
  }

  async incrementalSyncFolder(client: ImapFlow, imapPath: string, uidValidity: string, changedSince: bigint, highestModseq: string | null, uidNext?: number): Promise<void> {
    const folder = this.store.getFolderByPath(imapPath)
      ?? this.store.upsertFolder({ imapPath, delimiter: '/', specialUse: null, uidValidity });
    let newCount = 0, flagChanges = 0, expunged = 0;

    // 1. authoritative UID list (detects expunges + new messages even without events)
    const serverUids = new Set<number>();
    for await (const m of client.fetch('1:*', { uid: true }, { uid: true })) serverUids.add(Number(m.uid));

    const localRows = this.store.db
      .prepare('SELECT id, uid, message_key, file_path, modseq, flags_json FROM messages WHERE folder_id = ?')
      .all(folder.id) as { id: number; uid: number; message_key: string; file_path: string; modseq: string | null; flags_json: string }[];
    const localByUid = new Map(localRows.map(r => [r.uid, r]));

    // 2. expunged (Task 4: skip UIDs with pending/running write ops — see fullSyncFolder)
    const expungedLocal = localRows.filter(r => !serverUids.has(r.uid) && !this.store.opInFlightForMessageKey(r.message_key));
    if (expungedLocal.length && this.expungeConfirmed(client, imapPath, serverUids.size, expungedLocal.length, localRows.length)) {
      this.store.deleteMessages(expungedLocal.map(r => r.id));
      for (const r of expungedLocal) {
        try { fs.unlinkSync(this.store.filePath(r.file_path)); } catch { /* server-side expunge: the row is gone already, a leftover file is an orphan for the sweep */ }
      }
      expunged = expungedLocal.length;
    }

    // 3. new messages
    const newUids = [...serverUids].filter(u => !localByUid.has(u));
    newCount = await this.ctx.downloadMessages(client, newUids, imapPath, folder.id, uidValidity, { yieldToWrites: true });

    // 4. flag changes: CONDSTORE changedSince fetch — server returns only changed messages.
    //    Task 4 fix (found on profile B): WITHOUT CONDSTORE this fetch must still happen
    //    (plain FLAGS fetch), otherwise a flag-only change (bumps HIGHESTMODSEQ → poll
    //    calls syncFolder → here) is never applied locally and the tiered sweep is
    //    postponed to the next poll. Previously flags were only refreshed by sweeps,
    //    making no-CONDSTORE flag detection ~1 poll late.
    if (this.hasCondstore) {
      const knownUids = [...serverUids].filter(u => localByUid.has(u));
      for (let i = 0; i < knownUids.length; i += 500) {
        const chunk = knownUids.slice(i, i + 500).sort((a, b) => a - b);
        const range = uidRange(chunk);
        if (!range) continue;
        for await (const m of client.fetch(range, { uid: true, flags: true }, { uid: true, changedSince })) {
          const uid = Number(m.uid);
          const local = localByUid.get(uid);
          if (!local) continue;                      // safety; new ones were downloaded above
          // Task 4 coexistence: skip messages with pending/running write ops
          if (this.store.opInFlightForMessageKey(local.message_key)) continue;
          const flags = flagsFromSet(m.flags);
          const modseq = m.modseq !== undefined ? String(m.modseq) : null;
          if (JSON.stringify(JSON.parse(local.flags_json)) !== JSON.stringify(flags) ||
              (modseq && local.modseq !== modseq)) {
            this.store.updateMessageFlags(local.id, JSON.stringify(flags), modseq, null);
            flagChanges++;
          }
        }
      }
    } else {
      // no-CONDSTORE: full FLAGS fetch for known UIDs (same collect-then-apply pattern
      // as flagSweep; server-side this is one FETCH per 500-UID chunk)
      for (let i = 0; i < localRows.length; i += 500) {
        const chunk = localRows.slice(i, i + 500).map(r => r.uid).sort((a, b) => a - b);
        const range = uidRange(chunk);
        if (!range) continue;
        for await (const m of client.fetch(range, { uid: true, flags: true }, { uid: true })) {
          const uid = Number(m.uid);
          const local = localByUid.get(uid);
          if (!local) continue;
          if (this.store.opInFlightForMessageKey(local.message_key)) continue;   // Task 4 coexistence
          const flags = flagsFromSet(m.flags);
          if (JSON.stringify(JSON.parse(local.flags_json)) !== JSON.stringify(flags)) {
            this.store.updateMessageFlags(local.id, JSON.stringify(flags), null, null);
            flagChanges++;
          }
        }
      }
    }

    // I4: uid_next is what the poll compares STATUS against; an incremental pass that left it
    // behind made every later poll see a change and sync the folder again
    this.store.db.prepare(`UPDATE folders SET uid_validity=@uidValidity, uid_next=@uidNext, highest_modseq=@highestModseq,
      last_sync_at=datetime('now') WHERE id=@id`)
      .run({ uidValidity, uidNext: nextUid(uidNext, serverUids), highestModseq, id: folder.id });

    this.emit({ type: 'folder-done', path: imapPath, newCount, flagChanges, expunged, moved: 0 });
  }

  /**
   * Download a list of UIDs (full bodies) into the store. Returns count stored.
   * Task 3: throttled for live servers — batches sized by bytes, inter-batch delay,
   * pause-aware, progress-accounted (messagesDone/bytesDone). newestFirst for the
   * prioritized initial download (recent mail first → search useful early).
   * S1: with `lazyAboveBytes` set, a message above it is stored as its skeleton.
   */
  async downloadMessages(client: ImapFlow, uids: number[], imapPath: string, folderId: string, uidValidity: string, opts: { newestFirst?: boolean; keyFolderId?: string; yieldToWrites?: boolean } = {}): Promise<number> {
    if (!uids.length) return 0;
    let stored = 0;
    // message_key identity uses keyFolderId (the REAL folder id) even when rows are
    // staged under a temp folder mapping — see resyncAfterValidityChange
    const keyFolderId = opts.keyFolderId ?? folderId;
    const adopted = await this.adoptRelinked(client, uids, imapPath, folderId, keyFolderId, uidValidity);
    stored += adopted.size;
    const sorted = uids.filter(u => !adopted.has(u)).sort((a, b) => opts.newestFirst ? b - a : a - b);
    const batchBytes = this.account.batchBytes ?? Infinity;
    const interDelay = this.account.interBatchDelayMs ?? 0;
    const BATCH_COUNT = 100;
    for (let i = 0; i < sorted.length;) {
      // the caller holds the folder's mutex; writes waiting for it go first
      if (opts.yieldToWrites) await this.yieldFolderToWrites(imapPath);
      await this.gate();
      // assemble a batch respecting both count and byte budget (uid list only → cheap)
      const batch: number[] = [];
      let bytes = 0;
      while (i < sorted.length && batch.length < BATCH_COUNT && bytes < batchBytes) {
        batch.push(sorted[i++]);
        bytes += 40_000;   // avg message estimate until real sizes known
      }
      const range = uidRange(batch);
      if (!range) continue;
      let batchStored = 0;
      const keep = async (msg: Parameters<MessageIngest['storeMessage']>[2]) => {
        await this.storeMessage(folderId, uidValidity, msg, { keyFolderId });
        batchStored++;
        this.progress.messagesDone++;
        // the bytes that came over the wire: the skeleton's, for a large message
        this.progress.bytesDone += msg.source.length;
        // pause responsive even within a batch: fetch iterator is lazy, so waiting here
        // defers only the next fetch continuation (server command already in flight —
        // acceptable: one batch is ~4 MB)
        if (this.paused) await this.waitWhilePaused();
      };
      // S1: sizes and structures first, so the large messages stay out of the whole download
      const large = this.account.lazyAboveBytes === undefined ? [] : await this.largeIn(client, range);
      const wholeRange = large.length ? uidRange(batch.filter(u => !large.some(m => m.uid === u))) : range;
      if (wholeRange) {
        for await (const msg of client.fetch(wholeRange, {
          uid: true, source: true, flags: true, internalDate: true, size: true,
        }, { uid: true })) {
          if (!msg.source) continue;
          await keep({ ...msg, source: msg.source });
        }
      }
      for (const meta of large) {
        await this.gate();
        const skeleton = await fetchSkeleton(client, meta.uid, meta.bodyStructure);
        if (skeleton) {
          await keep({ uid: meta.uid, flags: meta.flags, internalDate: meta.internalDate, modseq: meta.modseq, size: meta.size, ...skeleton });
          continue;
        }
        // a structure the skeleton does not cover: downloaded whole, as below the threshold
        const whole = await client.fetchOne(String(meta.uid), { uid: true, source: true, flags: true, internalDate: true, size: true }, { uid: true });
        if (whole && whole.source) await keep({ ...whole, source: whole.source });
      }
      stored += batchStored;
      this.progress.currentFolder = imapPath;
      if (i < sorted.length && interDelay > 0) {
        await new Promise(r => setTimeout(r, interDelay));
      }
      if (this.stopped) break;
    }
    return stored;
  }

  /** S1: the batch's messages above `lazyAboveBytes`, with their structure, flags and dates (no bodies) */
  private async largeIn(client: ImapFlow, range: string): Promise<FetchMessageObject[]> {
    const large: FetchMessageObject[] = [];
    for await (const m of client.fetch(range, { uid: true, size: true, flags: true, internalDate: true, bodyStructure: true }, { uid: true })) {
      if (storedAsSkeleton(this.account.lazyAboveBytes, m.size)) large.push(m);
    }
    return large;
  }

  /**
   * I12 (MR-26): after a rebuild, a UID whose `.eml` survived the quarantined store is stored
   * from that file: only flags and dates are fetched, 500 UIDs per command, instead of the whole
   * source. Folder path, UIDVALIDITY and UID name one message for good; the file must still have
   * the recorded size, and the server's RFC822.SIZE must agree when it sends one. Everything that
   * does not qualify is downloaded as usual. Returns the UIDs that were stored.
   */
  private async adoptRelinked(client: ImapFlow, uids: number[], imapPath: string, folderId: string, keyFolderId: string, uidValidity: string): Promise<Set<number>> {
    const adopted = new Set<number>();
    const links = this.store.relinksFor(imapPath, uidValidity);
    if (!links.size) return adopted;
    const candidates = uids.filter(u => links.has(u)).sort((a, b) => a - b);
    for (let i = 0; i < candidates.length; i += 500) {
      const range = uidRange(candidates.slice(i, i + 500));
      if (!range) continue;
      await this.gate();
      for await (const m of client.fetch(range, { uid: true, flags: true, internalDate: true, size: true }, { uid: true })) {
        const uid = Number(m.uid);
        const link = links.get(uid);
        if (!link || (m.size !== undefined && m.size !== link.sizeBytes)) continue;
        let source: Buffer;
        try {
          source = fs.readFileSync(this.store.filePath(link.filePath));
        } catch {
          continue;
        }
        if (source.length !== link.sizeBytes) continue;
        await this.storeMessage(folderId, uidValidity, { uid, source, flags: m.flags, internalDate: m.internalDate, modseq: m.modseq },
          { keyFolderId, existingPath: link.filePath });
        this.store.dropRelink(imapPath, uidValidity, uid);
        adopted.add(uid);
        this.progress.messagesDone++;
      }
      if (this.stopped) break;
    }
    return adopted;
  }
}

/**
 * I4: the folder's next UID as the server reported it on SELECT. Max+1 of the UIDs present
 * is lower whenever the newest messages were expunged, and the poll compares this value with
 * STATUS UIDNEXT, so the derived value made such a folder look changed on every poll.
 * The derived value stays as the floor for a server that sends no UIDNEXT.
 */
export function nextUid(selected: number | bigint | undefined, uids: Set<number>): number {
  let max = 0;
  for (const u of uids) if (u > max) max = u;
  return Math.max(Number(selected ?? 0), max + 1);
}

/** Compact IMAP sequence-set from a list of uids: "1:5,7,9:12" */
export function uidRange(uids: number[]): string | null {
  if (!uids.length) return null;
  const s = [...uids].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = s[0], prev = s[0];
  for (let i = 1; i < s.length; i++) {
    if (s[i] === prev + 1) { prev = s[i]; continue; }
    parts.push(start === prev ? String(start) : `${start}:${prev}`);
    start = prev = s[i];
  }
  parts.push(start === prev ? String(start) : `${start}:${prev}`);
  return parts.join(',');
}
