// Task 5 Step 1: the mail core — a self-contained folder with NO imports from the
// HTTP server, the browser client, Express/http, or anything UI-related.
//
// Boundary rules (enforced by review + suites):
//  - no process.env reads, no hard-coded paths/ports inside app/core/
//  - no `window`/DOM globals (jsdom is isolated inside core/sanitize.ts)
//  - everything (data dirs, account configs, credentials, sandbox endpoints, logger,
//    clock, image fetching) comes in through createMailCore(options)
//  - the HTTP server and client import the core — never the reverse
//
// The factory owns: instance locking (Task 4 double-server incident prevention),
// account wiring (store + sync engine + write engine with shared folder mutexes),
// and the shutdown contract (close() = stop loops, replay-safe, flush, release lock).
import path from 'path';
import { Store, JournalRow } from './store.js';
import { SyncEngine, AccountConfig, SyncEvent } from './sync.js';
import { WriteEngine, OpResult } from './write_engine.js';
import { WriteAccount } from './write_guard.js';
import { RemoteImageFetchOptions } from './remote_images.js';
import { DataDirLock, InstanceLockError } from './instance_lock.js';
import type { HeaderPage, Api, AccountInfo, AccountSummary, ImapSecurity, SyncStatus, FolderNode, MessageListItem, MessageDetail, SearchFilters, SearchResult, DraftInput, RemoteImageRef, ThreadSummary, OpSummary, SavedDraft } from './types.js';
import { AccountEntries } from './account_entries.js';
import { MessageViews } from './message_views.js';
import { OpApi } from './op_api.js';
import { FolderApi } from './folder_api.js';
import { DraftApi } from './draft_api.js';
import { Maintenance } from './maintenance.js';
import { MessageCompletion } from './message_complete.js';

export type Logger = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

export interface MailCoreOptions {
  /** ABSOLUTE directory for all per-account data (each account gets a subdir).
   * Required to be absolute so the core never guesses paths. */
  dataDir: string;
  /** Account configurations. Credentials are NEVER stored here — see credentials. */
  accounts: Array<{
    id: string;
    kind: 'sandbox' | 'production-readonly';
    host: string;
    port: number;
    /** encryption; 'none' is refused for production accounts */
    security: ImapSecurity;
    /** A7: this account's own SMTP endpoint; defaults to host:1025 for older settings */
    smtpHost?: string;
    smtpPort?: number;
    /** A7: the SMTP encryption, which is not the IMAP one; defaults to `security` */
    smtpSecurity?: ImapSecurity;
    /** A7 part 2: admit this account as the one real mailbox writes may reach */
    canary?: boolean;
    /** credentials provider — the HOST supplies them (e.g. Electron safeStorage);
     * called lazily per connection so the host controls lifetime/decryption */
    credentials: () => Promise<{ user: string; pass: string }>;
    /** static display identity (shown in the UI); for sandbox accounts typically
     * the same address the credentials return */
    email?: string;
  }>;
  /** Sandbox write target (IMAP+SMTP). REQUIRED if any account is writable;
   * the write guard validates both hosts against the loopback/docker allowlist. */
  /** probe a message sink for a Message-ID (sandbox tests use the Mailpit API).
   * Optional; improves unknown-send resolution, never enables auto-resend. */
  sinkProbe?: (messageId: string) => Promise<boolean>;
  /** structured logger; core never writes to console directly */
  log?: Logger;
  /** injectable clock (deterministic tests); default Date.now */
  clock?: () => number;
  /** remote-image fetching policy (opt-in "load images"); omit to leave images blocked */
  remoteImages?: RemoteImageFetchOptions & { enabled: boolean };
  /** testing: force the no-CONDSTORE sync strategy even on CONDSTORE servers */
  forceNoCondstore?: boolean;
  /** testing: fail every local write with this error code, so the disk-full path can be exercised
   *  on the real surface (the worker reads BOOKINGIUM_FAULT_WRITE to set it). Never set in production. */
  faultWriteCode?: string;
}

export interface AccountEntry {
  options: MailCoreOptions['accounts'][number];
  config: AccountConfig;
  /** A7: this account's own write endpoints, for the guard and the engines */
  writeAccount: WriteAccount;
  store: Store;
  engine: SyncEngine;
  writes: WriteEngine;
}

export type MailCoreEvent =
  | { type: 'sync-event'; accountId: string; event: SyncEvent }
  | { type: 'op-event'; accountId: string; opId: string; kind: string; outcome: string; reason?: string }
  /** G10: remote-image progress, so the button can say "3 von 12" instead of one long spinner */
  | { type: 'image-progress'; accountId: string; messageId: number; done: number; total: number };

export class MailCore implements Api {
  // I15a (MR-40): listeners by event name. `on()` used to ignore the name, so a host that
  // subscribed to two names got every event twice.
  private listeners = new Map<MailCoreEvent['type'], Set<(e: MailCoreEvent) => void>>();

  /** Subscribe to one kind of event: sync progress, write ops or image progress. Returns an unsubscribe function. */
  on(name: MailCoreEvent['type'], cb: (e: MailCoreEvent) => void): () => void {
    let set = this.listeners.get(name);
    if (!set) { set = new Set(); this.listeners.set(name, set); }
    set.add(cb);
    return () => { set.delete(cb); };
  }

  private emitEvent(e: MailCoreEvent): void {
    for (const l of this.listeners.get(e.type) ?? []) {
      try { l(e); } catch { /* listener errors never break the core */ }
    }
  }

  private accounts: AccountEntries;
  private get entries(): Map<string, AccountEntry> { return this.accounts.entries; }
  private views: MessageViews;
  private ops: OpApi;
  private folders: FolderApi;
  private drafts: DraftApi;
  private maintenance: Maintenance;
  private completion: MessageCompletion;
  private lock: DataDirLock;
  private log: Logger;
  private clock: () => number;
  private get retryTimers(): Map<string, ReturnType<typeof setTimeout>> { return this.ops.retryTimers; }
  private closed = false;

  constructor(readonly options: MailCoreOptions) {
    if (!path.isAbsolute(options.dataDir)) {
      throw new Error(`createMailCore: dataDir must be absolute (got "${options.dataDir}")`);
    }
    if (!options.accounts?.length) throw new Error('createMailCore: at least one account required');
    this.log = options.log ?? {};
    this.clock = options.clock ?? Date.now;

    // single-instance protection FIRST (Task 4 double-server incident)
    this.lock = new DataDirLock(options.dataDir);
    this.lock.acquire();

    this.accounts = new AccountEntries({ log: this.log, clock: this.clock, emitEvent: e => this.emitEvent(e) });
    this.completion = new MessageCompletion(this.log);
    this.views = new MessageViews({
      options, entry: id => this.entry(id), emitEvent: e => this.emitEvent(e),
      ensureComplete: (e, row) => this.completion.ensureComplete(e, row),
    });
    this.ops = new OpApi({
      log: this.log, isClosed: () => this.closed, entry: id => this.entry(id), writableEntry: id => this.writableEntry(id),
      emitEvent: e => this.emitEvent(e), runOp: (e, op) => this.runOp(e, op), parseFlags: row => this.views.parseFlags(row),
      refuseFolderDelete: (e, path) => this.folders.refuseFolderDelete(e, path),
      throwIfServerRefusedDelete: (e, opId) => this.folders.throwIfServerRefusedDelete(e, opId),
    });
    this.folders = new FolderApi({ writableEntry: id => this.writableEntry(id), replayOps: (e, opIds) => this.ops.replayOps(e, opIds), opToSummary: op => this.ops.opToSummary(op) });
    this.drafts = new DraftApi({
      clock: this.clock, entry: id => this.entry(id), writableEntry: id => this.writableEntry(id), runOp: (e, op) => this.runOp(e, op),
      replayOps: (e, opIds) => this.ops.replayOps(e, opIds), planFlagOp: (e, ids, delta) => this.ops.planFlagOp(e, ids, delta),
      resyncMovedFolders: (e, opIds) => this.ops.resyncMovedFolders(e, opIds),
      ensureComplete: (e, row) => this.completion.ensureComplete(e, row),
    });
    this.maintenance = new Maintenance({ entries: this.entries, log: this.log, clock: this.clock, entry: id => this.entry(id) });
    this.accounts.buildEntries(options);
    const first = this.entries.keys().next();
    if (first.done) {
      this.lock.release();
      throw new Error('createMailCore: no mail account could be opened');
    }
    this.accounts.activeId = first.value;
  }

  private ensureCredentials(id: string): Promise<{ user: string; pass: string }> { return this.accounts.ensureCredentials(id); }

  // ----- account/system -----

  getAccount(): Promise<AccountInfo> { return this.accounts.getAccount(); }

  listAccounts(): Promise<AccountSummary[]> { return this.accounts.listAccounts(); }

  selectAccount(accountId: string): Promise<AccountInfo> { return this.accounts.selectAccount(accountId); }

  async getSyncStatus(accountId?: string): Promise<SyncStatus> {
    const e = this.entry(accountId);
    return {
      ...e.engine.getStatus(),
      serverRssMB: Math.round(process.memoryUsage().rss / 1e6),
      fileConsistency: this.checkFileConsistency(accountId),
    };
  }

  async triggerSync(full?: boolean, accountId?: string): Promise<void> {
    const e = this.entry(accountId);
    await this.ensureCredentials(e.config.id);
    if (e.engine.isSyncing()) {
      await e.engine.waitForSync(120_000);
      return;
    }
    await e.engine.syncAll({ full }).catch(err => this.log.error?.(`sync error: ${(err as Error).message}`));
  }

  async pauseSync(accountId?: string): Promise<void> {
    this.entry(accountId).engine.pause();
  }

  async resumeSync(accountId?: string): Promise<void> {
    this.entry(accountId).engine.resume();
  }

  listThreads(folderId: string | null, opts: { offset: number; limit: number }, accountId?: string): Promise<ThreadSummary[]> { return this.views.listThreads(folderId, opts, accountId); }

  // ----- folders / messages -----

  getFolders(accountId?: string): Promise<FolderNode[]> { return this.views.getFolders(accountId); }

  listMessages(folderId: string, opts: { offset: number; limit: number }, accountId?: string): Promise<MessageListItem[]> { return this.views.listMessages(folderId, opts, accountId); }

  getMessage(id: number, accountId?: string): Promise<MessageDetail> { return this.views.getMessage(id, accountId); }

  completeMessage(id: number, accountId?: string): Promise<MessageDetail> { return this.views.completeMessage(id, accountId); }

  getRawEml(id: number, accountId?: string): Promise<Uint8Array> { return this.views.getRawEml(id, accountId); }

  getAttachment(id: number, partId: string, accountId?: string): Promise<Uint8Array> { return this.views.getAttachment(id, partId, accountId); }

  loadRemoteImages(id: number, remoteImages: RemoteImageRef[], accountId?: string): Promise<MessageDetail> { return this.views.loadRemoteImages(id, remoteImages, accountId); }

  search(filters: SearchFilters, accountId?: string): Promise<SearchResult> { return this.views.search(filters, accountId); }

  // ----- write operations (sandbox only; guard refuses anything else) -----

  markRead(ids: number[], read: boolean, accountId?: string): Promise<void> { return this.ops.markRead(ids, read, accountId); }

  markFlagged(ids: number[], flagged: boolean, accountId?: string): Promise<void> { return this.ops.markFlagged(ids, flagged, accountId); }

  moveToFolder(ids: number[], targetFolderId: string, accountId?: string): Promise<OpSummary[]> { return this.ops.moveToFolder(ids, targetFolderId, accountId); }

  deleteToTrash(ids: number[], accountId?: string): Promise<OpSummary[]> { return this.ops.deleteToTrash(ids, accountId); }

  archive(ids: number[], accountId?: string): Promise<OpSummary[]> { return this.ops.archive(ids, accountId); }

  private runOp(e: AccountEntry, op: JournalRow): Promise<OpResult> { return this.ops.runOp(e, op); }

  replayPendingOps(accountId?: string): Promise<{ replayed: number; results: Record<string, string> }> { return this.ops.replayPendingOps(accountId); }

  listOps(accountId?: string): Promise<OpSummary[]> { return this.ops.listOps(accountId); }

  listOpenOps(accountId?: string): Promise<OpSummary[]> { return this.ops.listOpenOps(accountId); }

  retryFailedOps(accountId?: string): Promise<number> { return this.ops.retryFailedOps(accountId); }

  getOpCounts(accountId?: string): Promise<Record<string, number>> { return this.ops.getOpCounts(accountId); }

  retryOp(opId: string, accountId?: string): Promise<OpResult> { return this.ops.retryOp(opId, accountId); }

  resolveOp(opId: string, accountId?: string): Promise<OpResult> { return this.ops.resolveOp(opId, accountId); }

  cancelOp(opId: string, accountId?: string): Promise<void> { return this.ops.cancelOp(opId, accountId); }

  undoOp(opId: string, accountId?: string): Promise<string> { return this.ops.undoOp(opId, accountId); }

  expungeFromTrash(ids: number[], accountId?: string): Promise<void> { return this.ops.expungeFromTrash(ids, accountId); }

  // ----- C2: mail -> record linking -----

  listHeadersSince(cursor: number, limit: number, accountId?: string): Promise<HeaderPage> { return this.views.listHeadersSince(cursor, limit, accountId); }

  findByMessageIds(ids: string[], accountId?: string): Promise<MessageListItem[]> { return this.views.findByMessageIds(ids, accountId); }

  findReplies(parentIds: string[], accountId?: string): Promise<MessageListItem[]> { return this.views.findReplies(parentIds, accountId); }

  // ----- folders (B1) -------------------------------------------------------

  createFolder(parentPath: string | null, name: string, accountId?: string): Promise<OpSummary> { return this.folders.createFolder(parentPath, name, accountId); }

  renameFolder(path: string, newName: string, accountId?: string): Promise<OpSummary> { return this.folders.renameFolder(path, newName, accountId); }

  moveFolder(path: string, newParentPath: string | null, accountId?: string): Promise<OpSummary> { return this.folders.moveFolder(path, newParentPath, accountId); }

  deleteFolder(path: string, accountId?: string): Promise<OpSummary> { return this.folders.deleteFolder(path, accountId); }

  // ----- compose (sandbox only) -----

  getContacts(partial: string, accountId?: string): Promise<{ name: string; email: string }[]> { return this.views.getContacts(partial, accountId); }

  saveDraft(draft: DraftInput, replaceUid?: number | null, accountId?: string): Promise<number> { return this.drafts.saveDraft(draft, replaceUid, accountId); }

  sendMail(mail: DraftInput, draftUid?: number | null, accountId?: string): Promise<{ messageId: string }> { return this.drafts.sendMail(mail, draftUid, accountId); }

  deleteDraft(id: number, accountId?: string): Promise<void> { return this.drafts.deleteDraft(id, accountId); }

  discardDraft(uid: number, accountId?: string): Promise<void> { return this.drafts.discardDraft(uid, accountId); }

  getDraft(id: number, accountId?: string): Promise<SavedDraft> { return this.drafts.getDraft(id, accountId); }

  // ----- shared helpers -----

  private entry(id?: string): AccountEntry { return this.accounts.entry(id); }

  private writableEntry(id?: string): AccountEntry { return this.accounts.writableEntry(id); }

  // ----- lifecycle (the shutdown contract; see README.md) -----

  /** Start background activity for all accounts: initial sync, IDLE (INBOX), polling.
   * Writable accounts also replay pending journal ops (crash recovery). */
  start(): void {
    for (const [id, e] of this.entries) {
      void this.ensureCredentials(id)
        .then(() => e.engine.syncAll())
        .catch(err => this.log.error?.(`initial sync (${id}) failed: ${(err as Error).message}`));
      if (e.config.readOnly) {
        void e.engine.startIdle('INBOX');
        void e.engine.startPolling(120_000);
      } else {
        void e.engine.startIdle('INBOX');
        void e.engine.startPolling(30_000);
        setTimeout(() => {
          void this.replayPendingOps(id).then(r => {
            if (r.replayed) this.log.info?.(`write-path replay: ${r.replayed} op(s) replayed`);
          }).catch(err => this.log.error?.(`write-path replay error: ${(err as Error).message}`));
        }, 5_000).unref();
      }
    }
  }

  whenIdleForMaintenance(timeoutMs?: number): Promise<boolean> { return this.maintenance.whenIdleForMaintenance(timeoutMs); }

  sweepOrphans(graceMs?: number, orphanTtlMs?: number): number { return this.maintenance.sweepOrphans(graceMs, orphanTtlMs); }

  repairMissingFiles(limit?: number, accountId?: string): Promise<{ repaired: number; left: number }> { return this.maintenance.repairMissingFiles(limit, accountId); }

  checkFileConsistency(accountId?: string): { rowsWithoutFile: number; filesWithoutRow: number; tmpFiles: number } { return this.maintenance.checkFileConsistency(accountId); }

  /** Shutdown contract (see README.md):
   *  - stops polling + IDLE (no new server contact after this returns)
   *  - waits for an in-flight sync to finish (bounded)
   *  - waits for in-flight write ops to reach a journal state (bounded, 8 s; they are
   *    crash-safe, a kill mid-op is recovered by the next start(): a send interrupted
   *    after SMTP started is probed by Message-ID, never sent again)
   *  - closes SQLite handles (WAL checkpoint on close)
   *  - releases the data-dir instance lock
   *  Does NOT replay failed ops or retry sends — replay happens on next start(). */
  async close(opts?: { syncWaitMs?: number; writeWaitMs?: number }): Promise<void> {
    this.closed = true;
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    // I1 (MR-01): the op in flight finishes first, so its journal row says how far it got.
    // Bounded: the host kills the worker 15 s after asking it to close.
    await Promise.all([...this.entries.values()].map(e => e.writes.drain(opts?.writeWaitMs ?? 8_000)));
    for (const [, e] of this.entries) {
      e.engine.stopPolling();
      // I17 (test gap): no new IDLE round starts and a download stops between batches; then the
      // work in flight (a pass, a poll, a folder sync it or a write's resync started, an IDLE
      // round) finishes before the store closes. Only a full pass used to be waited for.
      e.engine.stopIdle();
      await e.engine.waitForWork(opts?.syncWaitMs ?? 10_000).catch(() => { });
      await e.engine.close();
      // G2/L3c: the write connection is shared across ops now, so close() must end it
      await e.writes.close().catch(() => { });
      e.store.close();
    }
    this.lock.release();
  }

  /** Expose the instance lock error class so hosts can catch it specifically. */
  static get InstanceLockError() { return InstanceLockError; }
}

/** Factory: validate options, acquire the data-dir lock, wire accounts. */
export function createMailCore(options: MailCoreOptions): MailCore {
  return new MailCore(options);
}

export { messageFallbackKey, normalizeMessageId } from './message_keys.js';
export { MOVE_BATCH_LIMIT } from './op_api.js';
