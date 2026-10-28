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
import fs from 'fs';
import path from 'path';
import { Store, JournalRow } from './store.js';
import { SyncEngine, AccountConfig, SyncEvent } from './sync.js';
import { WriteEngine, OpResult } from './write_engine.js';
import { WriteAccount } from './write_guard.js';
import { RemoteImageFetchOptions } from './remote_images.js';
import { DataDirLock, InstanceLockError } from './instance_lock.js';
import type { HeaderPage, Api, AccountInfo, AccountSummary, ImapSecurity, SyncStatus, FolderNode, MessageListItem, MessageDetail, SearchFilters, SearchResult, DraftInput, RemoteImageRef, ThreadSummary, OpSummary, SavedDraft } from './types.js';
import { composeMime, ComposeError, SEND_KEY, type ComposedMime } from './compose.js';
import { simpleParser } from 'mailparser';
import { isMessageFile, writeMessageFile } from './files.js';
import { isDiskFullError } from './disk_full.js';
import { sendPhase } from './op_retry.js';
import { AccountEntries } from './account_entries.js';
import { MessageViews } from './message_views.js';
import { OpApi } from './op_api.js';
import { FolderApi } from './folder_api.js';

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
    this.views = new MessageViews({ options, entry: id => this.entry(id), emitEvent: e => this.emitEvent(e) });
    this.ops = new OpApi({
      log: this.log, isClosed: () => this.closed, entry: id => this.entry(id), writableEntry: id => this.writableEntry(id),
      emitEvent: e => this.emitEvent(e), runOp: (e, op) => this.runOp(e, op), parseFlags: row => this.views.parseFlags(row),
      refuseFolderDelete: (e, path) => this.folders.refuseFolderDelete(e, path),
      throwIfServerRefusedDelete: (e, opId) => this.folders.throwIfServerRefusedDelete(e, opId),
    });
    this.folders = new FolderApi({ writableEntry: id => this.writableEntry(id), replayOps: (e, opIds) => this.ops.replayOps(e, opIds), opToSummary: op => this.ops.opToSummary(op) });
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

  getRawEml(id: number, accountId?: string): Promise<Uint8Array> { return this.views.getRawEml(id, accountId); }

  getAttachment(id: number, partId: string, accountId?: string): Promise<Uint8Array> { return this.views.getAttachment(id, partId, accountId); }

  loadRemoteImages(id: number, remoteImages: RemoteImageRef[], accountId?: string): Promise<MessageDetail> { return this.views.loadRemoteImages(id, remoteImages, accountId); }

  search(filters: SearchFilters, accountId?: string): Promise<SearchResult> { return this.views.search(filters, accountId); }

  // ----- write operations (sandbox only; guard refuses anything else) -----

  markRead(ids: number[], read: boolean, accountId?: string): Promise<void> { return this.ops.markRead(ids, read, accountId); }

  markFlagged(ids: number[], flagged: boolean, accountId?: string): Promise<void> { return this.ops.markFlagged(ids, flagged, accountId); }

  private planFlagOp(e: AccountEntry, ids: number[], delta: { add?: string[]; remove?: string[] }): string[] { return this.ops.planFlagOp(e, ids, delta); }

  moveToFolder(ids: number[], targetFolderId: string, accountId?: string): Promise<OpSummary[]> { return this.ops.moveToFolder(ids, targetFolderId, accountId); }

  private resyncMovedFolders(e: AccountEntry, opIds: string[]): void { return this.ops.resyncMovedFolders(e, opIds); }

  deleteToTrash(ids: number[], accountId?: string): Promise<OpSummary[]> { return this.ops.deleteToTrash(ids, accountId); }

  archive(ids: number[], accountId?: string): Promise<OpSummary[]> { return this.ops.archive(ids, accountId); }

  private replayOps(e: AccountEntry, opIds: string[]): Promise<void> { return this.ops.replayOps(e, opIds); }

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

  async saveDraft(draft: DraftInput, replaceUid?: number | null, accountId?: string): Promise<number> {
    const e = this.writableEntry(accountId);
    const draftsFolder = this.draftsFolder(e);
    const { raw, messageId } = await this.buildMimeMessage(e, draft, { draft: true });
    const oldUid = replaceUid ?? undefined;
    // I17 (write path L7): the editor's session key ties its saves together, so a replayed older
    // save does not come back over a newer one (see doDraftSave). It never becomes a Message-ID here.
    const composeKey = draft.sendKey && SEND_KEY.test(draft.sendKey) ? draft.sendKey : undefined;
    const opId = e.store.journalEnqueue({
      // I1 (MR-15): the Message-ID lets a replay find a copy the APPEND already left
      accountId: e.config.id, kind: 'draft_save', messageId, composeKey,
      folderPath: draftsFolder.imap_path, folderUidValidity: draftsFolder.uid_validity ?? undefined,
      uid: oldUid,
      payload: { mime: raw.toString('base64'), oldUid },
    });
    e.store.journalUpdate(opId, { state: 'running' });
    const op = e.store.journalGet(opId)!;
    const result = await this.runOp(e, op);
    const updated = e.store.journalGet(opId);
    const appendedUid = updated ? (JSON.parse(updated.payload || '{}') as { appendedUid?: number }).appendedUid : undefined;
    if (!appendedUid) {
      // the editor still holds the draft and saves it again; a queued copy would come back later
      e.store.journalUpdate(opId, { state: 'cancelled' });
      throw new Error(`draft not saved: ${'reason' in result ? result.reason : result.outcome}`);
    }
    e.writes.requestResync(draftsFolder.imap_path);
    return appendedUid;
  }

  async sendMail(mail: DraftInput, draftUid?: number | null, accountId?: string): Promise<{ messageId: string }> {
    const e = this.writableEntry(accountId);
    if (!mail.to.length && !mail.cc.length && !mail.bcc.length) throw new ComposeError('Kein Empfänger angegeben');
    const { raw, messageId } = await this.buildMimeMessage(e, mail, { draft: false });
    const head = raw.subarray(0, raw.indexOf('\r\n\r\n')).toString('latin1');
    if (/^Bcc:/im.test(head)) throw new Error('internal: Bcc header in a mail to send');
    const envelope = {
      from: e.options.email ?? e.config.user,
      to: mail.to.map(a => a.email),
      cc: mail.cc.map(a => a.email),
      bcc: mail.bcc.map(a => a.email),
    };
    const sentFolder = e.store.allFolders().find(f => f.special_use === '\\Sent')
      ?? e.store.getFolderByPath('Gesendete Objekte');
    const draftsFolder = draftUid != null ? this.draftsFolder(e) : null;
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'send', messageId,
      payload: {
        mime: raw.toString('base64'), messageId, envelope,
        sentFolderPath: sentFolder?.imap_path ?? null,
        draft: draftsFolder && { path: draftsFolder.imap_path, uid: draftUid, uidValidity: draftsFolder.uid_validity },
      },
    });
    e.store.journalUpdate(opId, { state: 'running' });
    const op = e.store.journalGet(opId)!;
    // the 'running' event is emitted by runOp, so a send and a move look the same to the UI
    const result = await this.runOp(e, op);
    const after = e.store.journalGet(opId);
    // I1 (MR-43): phase 'sent' means the server took the mail and only filing into Sent
    // failed. That op stays pending, the next replay files it; for the user it is sent.
    const delivered = !!after && sendPhase(after) === 'sent';
    if (result.outcome === 'failed' && after?.state !== 'done' && !delivered) {
      // refused before the server took it: nothing went out, the editor stays open with
      // the mail, and sending again is a new op (a queued one would go out unasked later)
      e.store.journalUpdate(opId, { state: 'cancelled' });
      throw new Error(`Senden fehlgeschlagen: ${result.reason}`);
    }
    if (result.outcome === 'conflict' || result.outcome === 'unknown') {
      throw new Error(`Versand unklar, bitte im Ordner Gesendet prüfen: ${result.reason}`);
    }
    if (sentFolder) e.writes.requestResync(sentFolder.imap_path);
    if (draftsFolder) e.writes.requestResync(draftsFolder.imap_path);
    if (mail.repliesTo != null) {
      // best effort: the reply is out either way
      await this.replayOps(e, this.planFlagOp(e, [mail.repliesTo], { add: ['\\Answered'] })).catch(() => { });
    }
    return { messageId };
  }

  private draftsFolder(e: AccountEntry) {
    const folder = e.store.allFolders().find(f => f.special_use === '\\Drafts')
      ?? e.store.getFolderByPath('Entwürfe');
    if (!folder) throw new Error('no Drafts folder found');
    return folder;
  }

  async deleteDraft(id: number, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`draft ${id} not found`);
    const folder = e.store.getFolder(row.folder_id);
    if (!folder) throw new Error('draft folder not found');
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'draft_delete',
      folderPath: folder.imap_path, folderUidValidity: folder.uid_validity ?? undefined,
      uid: row.uid, messageKey: row.message_key, messageId: row.message_id ?? undefined,
      targetFolderPath: e.store.allFolders().find(f => f.special_use === '\\Trash')?.imap_path ?? 'Trash',
    });
    await this.replayOps(e, [opId]);
  }

  async discardDraft(uid: number, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const folder = this.draftsFolder(e);
    // G4: the message key is what the read-side exclusion matches on (L2), so a discarded draft
    // leaves the Drafts list at once instead of after the server answered. Without it the op was
    // invisible to that filter and the draft lingered - the same lag as before, only in the list.
    const row = e.store.db
      .prepare('SELECT message_key, message_id FROM messages WHERE folder_id = ? AND uid = ?')
      .get(folder.id, uid) as { message_key: string; message_id: string | null } | undefined;
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'draft_delete',
      folderPath: folder.imap_path, folderUidValidity: folder.uid_validity ?? undefined, uid,
      messageKey: row?.message_key, messageId: row?.message_id ?? undefined,
      targetFolderPath: e.store.allFolders().find(f => f.special_use === '\\Trash')?.imap_path ?? 'Trash',
    });
    await this.replayOps(e, [opId]);
    // G4: the draft moved, so the two folders it touched need a resync - not the whole mailbox
    this.resyncMovedFolders(e, [opId]);
  }

  async getDraft(id: number, accountId?: string): Promise<SavedDraft> {
    const e = this.entry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`draft ${id} not found`);
    // from the stored source, not the row: the row has no Bcc and no attachment content
    const parsed = await simpleParser(fs.readFileSync(e.store.filePath(row.file_path)));
    const list = (field: typeof parsed.to) => (Array.isArray(field) ? field : field ? [field] : [])
      .flatMap(a => a.value)
      .filter(a => a.address)
      .map(a => ({ name: a.name || '', email: a.address! }));
    const refs = parsed.references;
    return {
      id,
      uid: row.uid,
      to: list(parsed.to),
      cc: list(parsed.cc),
      bcc: list(parsed.bcc),
      subject: parsed.subject ?? '',
      bodyText: parsed.text ?? '',
      bodyHtml: parsed.html || null,
      inReplyTo: parsed.inReplyTo ?? null,
      references: Array.isArray(refs) ? refs : refs ? refs.split(/\s+/).filter(Boolean) : [],
      attachments: (parsed.attachments || [])
        .filter(a => a.contentDisposition !== 'inline' || !a.contentId)
        .map(a => ({ filename: a.filename || 'Anhang', contentType: a.contentType, base64: a.content.toString('base64') })),
    };
  }

  // ----- shared helpers -----

  private entry(id?: string): AccountEntry { return this.accounts.entry(id); }

  private writableEntry(id?: string): AccountEntry { return this.accounts.writableEntry(id); }

  private async buildMimeMessage(e: AccountEntry, mail: DraftInput, opts: { draft: boolean }): Promise<ComposedMime> {
    const extraAttachments = mail.forwardsFrom != null ? await this.attachmentsOf(e, mail.forwardsFrom) : [];
    return composeMime(mail, {
      from: { name: '', email: e.options.email ?? e.config.user },
      date: new Date(this.clock()),
      draft: opts.draft,
      extraAttachments,
    });
  }

  /** The attachments of a stored message as files, inline images (part of its HTML) left out */
  private async attachmentsOf(e: AccountEntry, id: number): Promise<{ filename: string; contentType: string; content: Buffer }[]> {
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    const parsed = await simpleParser(fs.readFileSync(e.store.filePath(row.file_path)));
    return (parsed.attachments || [])
      .filter(a => a.contentDisposition !== 'inline' || !a.contentId)
      .map(a => ({ filename: a.filename || 'Anhang', contentType: a.contentType, content: a.content }));
  }

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
        for (const f of fs.readdirSync(dir)) {
          if (!isMessageFile(f) || known.has(f)) continue;
          try {
            const abs = path.join(dir, f);
            if (fs.statSync(abs).mtimeMs >= cutoff) continue;
            fs.mkdirSync(orphanDir, { recursive: true });
            fs.renameSync(abs, path.join(orphanDir, f));
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
      'SELECT id, folder_id, uid, file_path FROM messages ORDER BY id DESC')
      .all() as { id: number; folder_id: string; uid: number; file_path: string }[];
    const onDisk = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
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
            for await (const msg of client.fetch(String(row.uid), {
              uid: true, source: true, flags: true, internalDate: true, size: true,
            }, { uid: true })) {
              if (!msg.source) continue;
              const relPath = writeMessageFile(dir, msg.source);
              e.store.db.prepare('UPDATE messages SET file_path = ? WHERE id = ?').run(relPath, row.id);
              n++;
            }
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
    const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const files = new Set(onDisk.filter(isMessageFile));
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
