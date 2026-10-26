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
import { createHash } from 'crypto';
import path from 'path';
import { Store, JournalRow, type FolderRow } from './store.js';
import { SyncEngine, AccountConfig, makeProductionAccount, makeSandboxAccount, makeCanaryAccount, SyncEvent } from './sync.js';
import { WriteEngine, OpResult, type BatchMember, type BatchMoved } from './write_engine.js';
import { WriteAccount, writeEndpointReachable, isCanary } from './write_guard.js';
import { sanitizeEmailHtml } from './sanitize.js';
import { fetchRemoteImagesAsDataUris, RemoteImageFetchOptions } from './remote_images.js';
import { DataDirLock, InstanceLockError } from './instance_lock.js';
import type { MessageHeader, Api, AccountInfo, AccountSummary, ImapSecurity, SyncStatus, FolderNode, MessageListItem, MessageDetail, SearchFilters, SearchResult, DraftInput, RemoteImageRef, AttachmentInfo, ThreadSummary, OpSummary, SavedDraft } from './types.js';
import { composeMime, ComposeError, type ComposedMime } from './compose.js';
import { simpleParser } from 'mailparser';
import { isMessageFile, writeMessageFile } from './files.js';
import { foldersToResync } from './resync_scope.js';
import { checkFolderName, folderPath, folderMoveRefusal, folderMoveTarget, isPathOrChild, isProtectedFolder, DEFAULT_DELIMITER, FolderNameError } from './folders.js';

/** A7 part 2: how an account reports itself - the canary is writable but not a sandbox */
function accountMode(config: { canary?: boolean; readOnly: boolean }): AccountInfo['mode'] {
  if (isCanary(config)) return 'canary';
  return config.readOnly ? 'production-readonly' : 'sandbox';
}

/** A7: a single UID MOVE covers at most this many mails; above that the group is split */
export const MOVE_BATCH_LIMIT = 500;

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
  | { type: 'op-event'; accountId: string; opId: string; kind: string; outcome: string; reason?: string };

export class MailCore implements Api {
  private listeners = new Set<(e: MailCoreEvent) => void>();

  /** Subscribe to sync progress + write-op events. Returns an unsubscribe function. */
  on(_name: 'sync-event' | 'op-event', cb: (e: MailCoreEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emitEvent(e: MailCoreEvent): void {
    for (const l of this.listeners) {
      try { l(e); } catch { /* listener errors never break the core */ }
    }
  }

  private entries = new Map<string, AccountEntry>();
  private activeId: string;
  private lock: DataDirLock;
  private log: Logger;
  private clock: () => number;
  private credentialCache = new Map<string, { user: string; pass: string }>();

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

    for (const a of options.accounts) {
      const dir = path.join(options.dataDir, a.id);
      // A7: the account's own endpoints; SMTP defaults to the IMAP host on 1025
      const writeAccount: WriteAccount = {
        id: a.id,
        kind: a.kind,
        imapHost: a.host,
        imapPort: a.port,
        security: a.security,
        smtpHost: a.smtpHost?.trim() ? a.smtpHost.trim() : a.host,
        smtpPort: a.smtpPort ?? 1025,
        smtpSecurity: a.smtpSecurity,
        email: a.email,
        canary: a.canary,
      };
      const input = { id: a.id, host: a.host, port: a.port, security: a.security, user: '', pass: '', dataDir: dir };
      // A7 part 2: the canary is a real mailbox that is writable, so it takes the
      // production pacing with the write path enabled. Every other account keeps the
      // kind it was saved as.
      const config: AccountConfig = isCanary(a)
        ? makeCanaryAccount(input)
        : a.kind === 'production-readonly'
          ? makeProductionAccount(input)
          : makeSandboxAccount(input);
      // user/pass are resolved lazily via ensureCredentials() before any engine
      // contact — never stored at construction, never logged
      const store = new Store(dir, a.id, this.clock);
      const engine = new SyncEngine(config, store, {
        forceNoCondstore: options.forceNoCondstore,
        log: this.log,
      });
      const writes = new WriteEngine(store, a.id, {
        writeAccount,
        /** A7: credentials come from the host, lazily, and never from the guard */
        credentials: () => this.ensureCredentials(a.id),
        sinkProbe: options.sinkProbe,
        clock: () => new Date(this.clock()),
        log: this.log,
      });
      writes.attachEngine({
        withFolderMutex: (p, fn) => engine.withFolderMutexPublic(p, fn),
        triggerResync: p => void engine.syncFolder(p).catch(() => { }),
      });
      // A6: a watchdog that could not stop an op stops the whole queue and asks for a
      // restart. The journal makes that restart safe; nothing is force-released.
      writes.onQueueStopped = message => this.emitEvent({
        type: 'op-event', accountId: a.id, opId: '', kind: 'queue', outcome: 'stopped', reason: message,
      });
      this.entries.set(a.id, { options: a, config, writeAccount, store, engine, writes });
      // forward sync events to subscribers (Task 5: events are the core's only
      // progress channel — no console writes inside the core)
      engine.onSyncEvent = ev => this.emitEvent({ type: 'sync-event', accountId: a.id, event: ev });
      // the rejected password must not stay around; the engine has stopped for good anyway
      engine.onAuthFailed = () => this.credentialCache.delete(a.id);
    }
    this.activeId = options.accounts[0].id;
  }

  /** Resolve credentials for an account through the host's provider (lazily). */
  private async ensureCredentials(id: string): Promise<{ user: string; pass: string }> {
    const cached = this.credentialCache.get(id);
    if (cached) return cached;
    const entry = this.entries.get(id)!;
    const creds = await entry.options.credentials();
    this.credentialCache.set(id, creds);
    // write into the config the engine/writes actually read
    entry.config.user = creds.user;
    entry.config.pass = creds.pass;
    return creds;
  }

  // ----- account/system -----

  async getAccount(): Promise<AccountInfo> {
    const e = this.entry();
    const reachable = e.config.readOnly ? true : await writeEndpointReachable(e.writeAccount);
    return {
      id: e.config.id,
      email: e.options.email ?? e.config.user,
      mode: accountMode(e.config),
      canWrite: !e.config.readOnly && reachable,
    };
  }

  async listAccounts(): Promise<AccountSummary[]> {
    const out: AccountSummary[] = [];
    for (const [id, e] of this.entries) {
      out.push({
        id,
        email: e.options.email ?? e.config.user,
        mode: accountMode(e.config),
        canWrite: !e.config.readOnly,
        active: id === this.activeId,
      });
    }
    return out;
  }

  async selectAccount(accountId: string): Promise<AccountInfo> {
    if (!this.entries.has(accountId)) throw new Error(`unknown account "${accountId}"`);
    this.activeId = accountId;
    return this.getAccount();
  }

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

  async listThreads(folderId: string | null, opts: { offset: number; limit: number }, accountId?: string): Promise<ThreadSummary[]> {
    const e = this.entry(accountId);
    return e.store.listThreads(folderId, opts.offset, opts.limit).map(t => ({
      threadId: t.threadId, count: t.count, subject: t.subject, fromName: t.fromName,
      date: t.date, unread: t.unread, hasAttachments: t.hasAttachments,
      snippet: t.snippet, messageIds: t.messageIds,
    }));
  }

  // ----- folders / messages -----

  async getFolders(accountId?: string): Promise<FolderNode[]> {
    const e = this.entry(accountId);
    const store = e.store;
    const flat = store.allFolders().map(f => {
      const counts = store.countByFolder(f.id);
      return {
        id: f.id,
        path: f.imap_path,
        name: f.imap_path.split(f.delimiter).pop() || f.imap_path,
        delimiter: f.delimiter,
        specialUse: f.special_use,
        unreadCount: counts.unread,
        totalCount: counts.total,
        children: [] as FolderNode[],
      };
    });
    const byPath = new Map(flat.map(f => [f.path, f]));
    const roots: FolderNode[] = [];
    for (const f of flat) {
      const sep = f.path.lastIndexOf(f.delimiter);
      if (sep > 0) {
        const parentPath = f.path.slice(0, sep);
        const parent = byPath.get(parentPath);
        if (parent) { parent.children.push(f); continue; }
      }
      roots.push(f);
    }
    const order = (n: FolderNode) => {
      if (n.specialUse?.includes('Inbox')) return 0;
      if (n.specialUse?.includes('Drafts')) return 1;
      if (n.specialUse?.includes('Sent')) return 2;
      if (n.specialUse?.includes('Archive')) return 3;
      if (n.specialUse?.includes('Junk')) return 4;
      if (n.specialUse?.includes('Trash')) return 5;
      return 10;
    };
    const sortRec = (nodes: FolderNode[]) => {
      nodes.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
      for (const n of nodes) sortRec(n.children);
    };
    sortRec(roots);
    return roots;
  }

  async listMessages(folderId: string, opts: { offset: number; limit: number }, accountId?: string): Promise<MessageListItem[]> {
    return this.entry(accountId).store.listByFolder(folderId, opts.offset, opts.limit).map(r => this.toListItem(r));
  }

  async getMessage(id: number, accountId?: string): Promise<MessageDetail> {
    const e = this.entry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    return this.toDetail(e, row, null);
  }

  async getRawEml(id: number, accountId?: string): Promise<Uint8Array> {
    const e = this.entry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    return new Uint8Array(fs.readFileSync(e.store.filePath(row.file_path)));
  }

  async getAttachment(id: number, partId: string, accountId?: string): Promise<Uint8Array> {
    const e = this.entry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    const source = fs.readFileSync(e.store.filePath(row.file_path));
    const parsed = await simpleParser(source);
    const att = (parsed.attachments || []).find(a => a.partId === partId);
    if (!att) throw new Error(`attachment ${partId} not found in message ${id}`);
    return new Uint8Array(att.content);
  }

  async loadRemoteImages(id: number, remoteImages: RemoteImageRef[], accountId?: string): Promise<MessageDetail> {
    const e = this.entry(accountId);
    if (!this.options.remoteImages?.enabled) return this.getMessage(id, accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    const { enabled: _enabled, ...fetchOpts } = this.options.remoteImages;
    void _enabled;   // destructured only to drop it from fetchOpts
    const fetched = await fetchRemoteImagesAsDataUris(remoteImages.map(r => r.url), fetchOpts);
    const loaded: RemoteImageRef[] = remoteImages
      .filter(r => fetched.has(r.url))
      .map(r => ({ url: r.url, placeholder: fetched.get(r.url)! }));
    return this.toDetail(e, row, loaded.length ? loaded : null);
  }

  async search(filters: SearchFilters, accountId?: string): Promise<SearchResult> {
    const e = this.entry(accountId);
    const store = e.store;
    const t0 = performance.now();
    const matchExpr = filters.query
      ? store.capPathologicalPrefixes(store.ftsEscapeUserQuery(filters.query))
      : null;
    const limit = filters.limit ?? 50;
    const { rows, total, elapsedMs } = store.search({
      matchExpr, folderId: filters.folderId, from: filters.from, to: filters.to,
      subject: filters.subject, hasAttachment: filters.hasAttachment,
      after: filters.after, before: filters.before, limit,
      offset: filters.offset ?? 0,
      sortBy: filters.sortBy ?? 'date',
    });
    const result: SearchResult = { items: rows.map(r => this.toListItem(r)), total, elapsedMs, snippetMap: {} };
    if (filters.wantFacets) {
      result.facets = store.searchFacets({
        matchExpr, from: filters.from, to: filters.to, subject: filters.subject,
        hasAttachment: filters.hasAttachment, after: filters.after, before: filters.before,
      });
    }
    if (filters.wantSnippets && matchExpr) {
      result.snippetMap = store.searchSnippets(matchExpr, result.items.map(i => i.id));
    }
    result.elapsedMs = Math.round(performance.now() - t0);
    return result;
  }

  // ----- write operations (sandbox only; guard refuses anything else) -----

  async markRead(ids: number[], read: boolean, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const ids2 = this.planFlagOp(e, ids, read ? { add: ['\\Seen'] } : { remove: ['\\Seen'] });
    await this.replayOps(e, ids2);
  }

  async markFlagged(ids: number[], flagged: boolean, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const ids2 = this.planFlagOp(e, ids, flagged ? { add: ['\\Flagged'] } : { remove: ['\\Flagged'] });
    await this.replayOps(e, ids2);
  }

  private planFlagOp(e: AccountEntry, ids: number[], delta: { add?: string[]; remove?: string[] }): string[] {
    const opIds: string[] = [];
    for (const id of ids) {
      const row = e.store.getMessage(id);
      if (!row) continue;
      const folder = e.store.getFolder(row.folder_id);
      if (!folder) continue;
      const flags = this.parseFlags(row);
      const flip: Record<string, boolean | undefined> = {};
      for (const f of delta.add || []) flip[f.replace('\\', '').toLowerCase()] = true;
      for (const f of delta.remove || []) flip[f.replace('\\', '').toLowerCase()] = false;
      const next = {
        seen: flip.seen !== undefined ? flip.seen : flags.seen,
        flagged: flip.flagged !== undefined ? flip.flagged : flags.flagged,
        draft: flip.draft !== undefined ? flip.draft : flags.draft,
        deleted: flip.deleted !== undefined ? flip.deleted : flags.deleted,
        answered: flip.answered !== undefined ? flip.answered : flags.answered,
      };
      e.store.updateMessageFlags(row.id, JSON.stringify(next));
      const opId = e.store.journalEnqueue({
        accountId: e.config.id, kind: 'flag',
        folderPath: folder.imap_path, folderUidValidity: folder.uid_validity ?? undefined,
        uid: row.uid, messageKey: row.message_key, messageId: row.message_id ?? undefined,
        payload: { add: delta.add || [], remove: delta.remove || [] },
      });
      opIds.push(opId);
    }
    return opIds;
  }

  async moveToFolder(ids: number[], targetFolderId: string, accountId?: string): Promise<OpSummary[]> {
    const e = this.writableEntry(accountId);
    const target = e.store.getFolder(targetFolderId);
    if (!target) throw new Error(`target folder ${targetFolderId} not found`);

    // B4: group by source folder - one op (and one UID MOVE) per (source, target)
    const groups = new Map<string, BatchMember[]>();
    for (const id of ids) {
      const row = e.store.getMessage(id);
      if (!row) continue;
      const folder = e.store.getFolder(row.folder_id);
      // A2c: a mail already in the target is skipped before any journal insert,
      // so a self-move never reaches the write engine (which refuses it too)
      if (!folder || folder.imap_path === target.imap_path) continue;
      const list = groups.get(folder.imap_path) ?? [];
      list.push({ uid: row.uid, messageKey: row.message_key, messageId: row.message_id ?? null });
      groups.set(folder.imap_path, list);
    }

    const opIds: string[] = [];
    for (const [sourcePath, members] of groups) {
      const source = e.store.getFolderByPath(sourcePath);
      // B4: cap a batch at 500 UIDs and split above that
      for (let i = 0; i < members.length; i += MOVE_BATCH_LIMIT) {
        const chunk = members.slice(i, i + MOVE_BATCH_LIMIT);
        // One mail keeps the plain move op: its crash and resume semantics are the
        // well-tested single-message path, and a "batch" of one buys nothing.
        if (chunk.length === 1) {
          const only = chunk[0];
          opIds.push(e.store.journalEnqueue({
            accountId: e.config.id, kind: 'move',
            folderPath: sourcePath, folderUidValidity: source?.uid_validity ?? undefined,
            uid: only.uid, messageKey: only.messageKey, messageId: only.messageId ?? undefined,
            targetFolderPath: target.imap_path,
          }));
          continue;
        }
        opIds.push(e.store.journalEnqueue({
          accountId: e.config.id, kind: 'move_batch',
          folderPath: sourcePath, folderUidValidity: source?.uid_validity ?? undefined,
          targetFolderPath: target.imap_path,
          payload: { members: chunk },
        }));
      }
    }
    await this.replayOps(e, opIds);
    // G2/L3b: only the folders this move touched need a resync. A full syncAll() does
    // detectCapabilities + a STATUS per folder with a 150 ms pause between each, so a ten-folder
    // mailbox paid ~1.5 s of sleeping after every single click.
    this.resyncMovedFolders(e, opIds);
    return opIds.map(id => e.store.journalGet(id)).filter((op): op is JournalRow => Boolean(op)).map(op => this.opToSummary(op));
  }

  /** G2/L3b: resync just the source and target folders of the ops that were run */
  private resyncMovedFolders(e: AccountEntry, opIds: string[]): void {
    const ops = opIds
      .map(opId => e.store.journalGet(opId))
      .filter((op): op is JournalRow => Boolean(op));
    for (const path of foldersToResync(ops)) e.writes.requestResync(path);
  }

  async deleteToTrash(ids: number[], accountId?: string): Promise<OpSummary[]> {
    const e = this.writableEntry(accountId);
    const trash = e.store.allFolders().find(f => f.special_use === '\\Trash');
    if (!trash) throw new Error('no Trash folder found');
    return this.moveToFolder(ids, trash.id, accountId);
  }

  async archive(ids: number[], accountId?: string): Promise<OpSummary[]> {
    const e = this.writableEntry(accountId);
    const archive = e.store.allFolders().find(f => f.special_use === '\\Archive');
    if (!archive) throw new Error('no Archive folder found');
    return this.moveToFolder(ids, archive.id, accountId);
  }

  private async replayOps(e: AccountEntry, opIds: string[]): Promise<void> {
    for (const opId of opIds) {
      const op = e.store.journalGet(opId);
      if (!op) continue;
      await this.runOp(e, op);
    }
  }

  /**
   * G2: the one place a journaled op is executed, so every op announces itself.
   *
   * Before this, only sendMail emitted the 'running' event, so a move or a delete was
   * silent until it finished - the UI had nothing to show while the server was working.
   * Every caller now goes through here, which is also why the announcement cannot be
   * forgotten by the next op kind.
   */
  private async runOp(e: AccountEntry, op: JournalRow): Promise<OpResult> {
    this.emitEvent({
      type: 'op-event', accountId: e.config.id, opId: op.id,
      kind: op.kind, outcome: 'running',
    });
    const result = await e.writes.execute(op);
    await this.applyOpResult(e, op.id, result);
    return result;
  }

  private async applyOpResult(e: AccountEntry, opId: string, result: OpResult): Promise<void> {
    const op = e.store.journalGet(opId);
    if (!op) return;
    this.emitEvent({
      type: 'op-event', accountId: e.config.id, opId,
      kind: op.kind, outcome: result.outcome,
      reason: ('reason' in result ? result.reason : undefined),
    });
    switch (result.outcome) {
      case 'done':
      case 'noop':
        e.store.journalUpdate(opId, {
          state: 'done',
          error: (result.outcome === 'done' ? result.detail : result.reason) ?? undefined,
        });
        break;
      case 'conflict':
        e.store.journalUpdate(opId, { state: 'conflict', error: result.reason });
        if (op.folder_path) e.writes.requestResync(op.folder_path);
        break;
      case 'unknown':
        e.store.journalUpdate(opId, { state: 'unknown', error: result.reason });
        break;
      case 'failed':
        // a send the server took but that could not be filed in Sent is marked done by
        // the engine: back to pending, a replay would send it a second time
        if (op.state === 'done') break;
        e.store.journalUpdate(opId, { state: 'pending', error: result.reason });
        break;
    }
  }

  async replayPendingOps(accountId?: string): Promise<{ replayed: number; results: Record<string, string> }> {
    const e = this.writableEntry(accountId);
    const ops = e.store.journalPending(100);
    const results: Record<string, string> = {};
    for (const listed of ops) {
      // re-read: an earlier op of this loop may have taken long enough for this one to
      // be settled by now (execute() itself shares an op that is still queued)
      const op = e.store.journalGet(listed.id);
      if (!op || (op.state !== 'pending' && op.state !== 'running')) continue;
      const result = await this.runOp(e, op);
      results[op.id] = result.outcome;
    }
    return { replayed: ops.length, results };
  }

  async listOps(accountId?: string): Promise<OpSummary[]> {
    const e = this.entry(accountId);
    return e.store.journalListRecent(100).map(op => this.opToSummary(op));
  }

  async getOpCounts(accountId?: string): Promise<Record<string, number>> {
    return this.entry(accountId).store.journalCountByState();
  }

  async retryOp(opId: string, accountId?: string): Promise<OpResult> {
    const e = this.writableEntry(accountId);
    const op = e.store.journalGet(opId);
    if (!op) throw new Error(`op ${opId} not found`);
    if (op.state !== 'failed' && op.state !== 'conflict' && op.state !== 'pending' && op.state !== 'unknown') {
      throw new Error(`op ${opId} is ${op.state}; only failed/conflict/pending/unknown ops can be retried`);
    }
    e.store.journalUpdate(opId, { state: 'pending', error: undefined });
    return this.runOp(e, e.store.journalGet(opId)!);
  }

  async resolveOp(opId: string, accountId?: string): Promise<OpResult> {
    const e = this.writableEntry(accountId);
    const op = e.store.journalGet(opId);
    if (!op) throw new Error(`op ${opId} not found`);
    if (op.kind !== 'send' || op.state !== 'unknown') throw new Error(`op ${opId} is not an unresolved send`);
    return this.runOp(e, op);
  }

  async cancelOp(opId: string, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const op = e.store.journalGet(opId);
    if (!op) throw new Error(`op ${opId} not found`);
    if (op.state !== 'pending') throw new Error(`op ${opId} is ${op.state}; only pending ops can be cancelled`);
    e.store.journalUpdate(opId, { state: 'cancelled' });
  }

  async undoOp(opId: string, accountId?: string): Promise<string> {
    const e = this.writableEntry(accountId);
    const op = e.store.journalGet(opId);
    if (!op) throw new Error(`op ${opId} not found`);
    if (op.state !== 'done') throw new Error(`op ${opId} is ${op.state}; only done ops can be undone`);
    let inverse: Parameters<Store['journalEnqueue']>[0];
    if (op.kind === 'flag') {
      const payload = JSON.parse(op.payload || '{}') as { add: string[]; remove: string[] };
      inverse = {
        accountId: e.config.id, kind: 'flag',
        folderPath: op.folder_path ?? undefined, folderUidValidity: op.folder_uidvalidity ?? undefined,
        uid: op.uid ?? undefined, messageKey: op.message_key ?? undefined, messageId: op.message_id ?? undefined,
        payload: { add: payload.remove, remove: payload.add },
      };
    } else if (op.kind === 'move' || op.kind === 'delete') {
      // a move re-keys the row for its destination and records the new key
      // (ops from before that only have the old one)
      const moved = (JSON.parse(op.payload || '{}') as { movedTo?: { messageKey?: string } }).movedTo;
      const key = moved?.messageKey ?? op.message_key;
      const current = key ? e.store.db.prepare(
        'SELECT uid, folder_id FROM messages WHERE message_key = ?').get(key) as
        { uid: number; folder_id: string } | undefined : undefined;
      if (!current) throw new Error('undo: message no longer in local store (resync needed)');
      const currentFolder = e.store.getFolder(current.folder_id);
      if (!currentFolder) throw new Error('undo: current folder not found');
      inverse = {
        accountId: e.config.id, kind: 'move',
        folderPath: currentFolder.imap_path, folderUidValidity: currentFolder.uid_validity ?? undefined,
        uid: current.uid, messageKey: key ?? undefined, messageId: op.message_id ?? undefined,
        targetFolderPath: op.folder_path ?? undefined,
      };
    } else if (op.kind === 'move_batch') {
      // B4: the whole group goes back in one op, the same way it came.
      // The rows are keyed by the uid the MOVE gave them, which is `destUid`.
      const payload = JSON.parse(op.payload || '{}') as { movedTo?: BatchMoved[] };
      const members: BatchMember[] = (payload.movedTo ?? [])
        .map(m => {
          // the row is keyed by the uid the MOVE gave it, not the source key
          const key = m.newKey ?? m.messageKey;
          const row = e.store.db.prepare(
            'SELECT uid FROM messages WHERE message_key = ?').get(key) as
            { uid: number } | undefined;
          return row ? { uid: row.uid, messageKey: key, messageId: null as string | null } : null;
        })
        .filter((m): m is BatchMember => m !== null);
      if (members.length === 0) throw new Error('undo: none of the moved mails is in the local store (resync needed)');
      const backFolder = e.store.getFolderByPath(op.target_folder_path ?? '');
      inverse = {
        accountId: e.config.id, kind: 'move_batch',
        folderPath: op.target_folder_path ?? undefined,
        folderUidValidity: backFolder?.uid_validity ?? undefined,
        targetFolderPath: op.folder_path ?? undefined,
        payload: { members },
      };
    } else if (op.kind === 'folder_create') {
      // B1: undo a create by deleting the folder again (only while it is empty)
      const payload = JSON.parse(op.payload || '{}') as { path?: string; delimiter?: string };
      if (!payload.path) throw new Error('undo: folder_create without path');
      inverse = {
        accountId: e.config.id, kind: 'folder_delete',
        folderPath: payload.path,
        payload: { path: payload.path },
      };
    } else if (op.kind === 'folder_rename') {
      // B1: undo a rename by renaming it back
      const payload = JSON.parse(op.payload || '{}') as { from?: string; to?: string; delimiter?: string };
      if (!payload.from || !payload.to) throw new Error('undo: folder_rename without from/to');
      inverse = {
        accountId: e.config.id, kind: 'folder_rename',
        folderPath: payload.to,
        payload: { from: payload.to, to: payload.from, delimiter: payload.delimiter },
      };
    } else if (op.kind === 'folder_delete') {
      // B1: undo a delete by creating the folder again (empty)
      const payload = JSON.parse(op.payload || '{}') as { path?: string };
      if (!payload.path) throw new Error('undo: folder_delete without path');
      inverse = {
        accountId: e.config.id, kind: 'folder_create',
        folderPath: payload.path,
        payload: { path: payload.path },
      };
    } else {
      throw new Error(`undo not supported for ${op.kind}`);
    }
    const newId = e.store.journalEnqueue(inverse);
    await this.replayOps(e, [newId]);
    return newId;
  }

  async expungeFromTrash(ids: number[], accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const trash = e.store.allFolders().find(f => f.special_use === '\\Trash');
    if (!trash) throw new Error('no Trash folder found');
    const opIds: string[] = [];
    for (const id of ids) {
      const row = e.store.getMessage(id);
      if (!row) continue;
      if (row.folder_id !== trash.id) throw new Error('expunge refused: message not in Trash');
      opIds.push(e.store.journalEnqueue({
        accountId: e.config.id, kind: 'expunge',
        folderPath: trash.imap_path, folderUidValidity: trash.uid_validity ?? undefined,
        uid: row.uid, messageKey: row.message_key, messageId: row.message_id ?? undefined,
      }));
    }
    await this.replayOps(e, opIds);
  }

  // ----- C2: mail -> record linking -----

  /**
   * Headers of the mails with a row id above `cursor`, oldest first. Addresses and
   * ids only: the subject never leaves the worker in clear text for this purpose, it
   * only enters the fallback hash.
   */
  async listHeadersSince(cursor: number, limit: number, accountId?: string): Promise<MessageHeader[]> {
    const store = this.entry(accountId).store;
    const rows = store.db.prepare(
      `SELECT id, message_id, in_reply_to, references_json, from_email, to_json, cc_json,
              date, internal_date, subject, size_bytes
       FROM messages WHERE id > ? ORDER BY id LIMIT ?`)
      .all(cursor, Math.max(1, Math.min(limit, 500))) as Array<{
        id: number; message_id: string | null; in_reply_to: string | null;
        references_json: string | null; from_email: string; to_json: string | null;
        cc_json: string | null; date: string | null; internal_date: string | null;
        subject: string | null; size_bytes: number | null;
      }>;
    return rows.map(r => ({
      id: r.id,
      messageId: r.message_id,
      fallbackKey: messageFallbackKey({
        date: r.date ?? r.internal_date,
        fromEmail: r.from_email,
        sizeBytes: r.size_bytes,
        subject: r.subject,
      }),
      inReplyTo: r.in_reply_to,
      references: parseJsonArray(r.references_json),
      fromEmail: r.from_email,
      toEmails: parseAddressList(r.to_json),
      ccEmails: parseAddressList(r.cc_json),
      date: r.date,
    }));
  }

  async findByMessageIds(ids: string[], accountId?: string): Promise<MessageListItem[]> {
    // Callers may pass a Message-ID with or without its angle brackets (the app DB
    // stores it without, the store keeps what the server sent), so both forms match.
    const wanted = new Set<string>();
    for (const raw of ids) {
      const bare = normalizeMessageId(raw);
      if (!bare) continue;
      wanted.add(bare);
      wanted.add(`<${bare}>`);
    }
    if (wanted.size === 0) return [];
    const store = this.entry(accountId).store;
    const all = [...wanted];
    // chunked: SQLite's variable limit is well above this, but a caller may pass many
    const out: MessageListItem[] = [];
    for (let i = 0; i < all.length; i += 200) {
      const chunk = all.slice(i, i + 200);
      const rows = store.db.prepare(
        `SELECT * FROM messages WHERE message_id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk) as import('./store.js').MessageRow[];
      out.push(...rows.map(r => this.toListItem(r)));
    }
    return out;
  }

  /**
   * C4: the mails that answer one of `parentIds` - their `In-Reply-To` names it, or it
   * appears in their `References`. A Message-ID matches with or without angle brackets.
   * Newest first, because a thread's last mail is what the invoice page cares about.
   */
  async findReplies(parentIds: string[], accountId?: string): Promise<MessageListItem[]> {
    const wanted = parentIds.map((raw) => normalizeMessageId(raw)).filter(Boolean)
    if (wanted.length === 0) return []
    // The parent is stored as the server sent it; the reply may quote it either way
    const forms = wanted.flatMap((id) => [id, `<${id}>`])
    const store = this.entry(accountId).store
    const found = new Map<number, import('./store.js').MessageRow>()
    for (let i = 0; i < forms.length; i += 200) {
      const chunk = forms.slice(i, i + 200)
      const rows = store.db
        .prepare(
          `SELECT * FROM messages
           WHERE in_reply_to IN (${chunk.map(() => '?').join(',')})
              OR references_json LIKE '%' || ? || '%'`
        )
        .all(...chunk, chunk[0]) as import('./store.js').MessageRow[]
      for (const row of rows) {
        if (row.in_reply_to && chunk.includes(row.in_reply_to)) {
          found.set(row.id, row)
          continue
        }
        // the LIKE is only a prefilter; References is a JSON array of Message-IDs
        const refs = parseJsonArray(row.references_json)
        if (refs.some((ref) => chunk.includes(ref))) found.set(row.id, row)
      }
    }
    return [...found.values()]
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id - a.id)
      .map((row) => this.toListItem(row))
  }

  // ----- folders (B1) -------------------------------------------------------

  /** B1: a new folder under `parentPath`, or at the top level */
  async createFolder(parentPath: string | null, name: string, accountId?: string): Promise<OpSummary> {
    const e = this.writableEntry(accountId);
    const parent = parentPath ? e.store.getFolderByPath(parentPath) : null;
    if (parentPath && !parent) throw new FolderNameError(`Ordner nicht gefunden: ${parentPath}`);
    const delimiter = parent?.delimiter ?? DEFAULT_DELIMITER;
    checkFolderName(name, delimiter);
    const path = folderPath(parentPath, name, delimiter);
    if (e.store.getFolderByPath(path)) throw new FolderNameError(`Ordner existiert bereits: ${path}`);
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'folder_create',
      folderPath: path,
      payload: { path, delimiter },
    });
    await this.replayOps(e, [opId]);
    return this.opToSummary(e.store.journalGet(opId)!);
  }

  /** B1: rename a folder's own name; subfolders move with it */
  async renameFolder(path: string, newName: string, accountId?: string): Promise<OpSummary> {
    const e = this.writableEntry(accountId);
    const folder = e.store.getFolderByPath(path);
    if (!folder) throw new FolderNameError(`Ordner nicht gefunden: ${path}`);
    this.refuseProtectedFolder(folder);
    const delimiter = folder.delimiter || DEFAULT_DELIMITER;
    checkFolderName(newName, delimiter);
    const parentPath = path.includes(delimiter) ? path.slice(0, path.lastIndexOf(delimiter)) : null;
    const to = folderPath(parentPath, newName, delimiter);
    if (to === path) return this.opToSummary(e.store.journalListRecent(1)[0]);
    if (e.store.getFolderByPath(to)) throw new FolderNameError(`Ordner existiert bereits: ${to}`);
    // The whole subtree is renamed, so no op may be pending anywhere in it
    this.refusePendingOpsIn(e, path, delimiter);
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'folder_rename',
      folderPath: path,
      payload: { from: path, to, delimiter },
    });
    await this.replayOps(e, [opId]);
    return this.opToSummary(e.store.journalGet(opId)!);
  }

  /**
   * B2: move a folder under a new parent (drag and drop). It is the same rename op -
   * the folder keeps its name and only its parent path changes. Refused before any
   * server contact when the target is the folder itself, one of its own subfolders, or
   * when a folder of that name already exists there.
   */
  async moveFolder(path: string, newParentPath: string | null, accountId?: string): Promise<OpSummary> {
    const e = this.writableEntry(accountId)
    const folder = e.store.getFolderByPath(path)
    if (!folder) throw new FolderNameError(`Ordner nicht gefunden: ${path}`)
    const delimiter = folder.delimiter || DEFAULT_DELIMITER
    const knownPaths = e.store.allFolders().map((f) => f.imap_path)
    const refusal = folderMoveRefusal(path, newParentPath, {
      delimiter,
      specialUse: folder.special_use,
      knownPaths
    })
    if (refusal) throw new FolderNameError(refusal)
    const to = folderMoveTarget(path, newParentPath, delimiter)
    if (to === path) return this.opToSummary(e.store.journalListRecent(1)[0])
    // The whole subtree moves, so no op may be pending anywhere in it
    this.refusePendingOpsIn(e, path, delimiter)
    const opId = e.store.journalEnqueue({
      accountId: e.config.id,
      kind: 'folder_rename',
      folderPath: path,
      payload: { from: path, to, delimiter }
    })
    await this.replayOps(e, [opId])
    return this.opToSummary(e.store.journalGet(opId)!)
  }

  /**
   * B1: delete an empty folder.
   *
   * Deleting a folder with mail on IMAP deletes that mail permanently, so this
   * refuses a folder that still holds mail or has subfolders.
   */
  async deleteFolder(path: string, accountId?: string): Promise<OpSummary> {
    const e = this.writableEntry(accountId);
    const folder = e.store.getFolderByPath(path);
    if (!folder) throw new FolderNameError(`Ordner nicht gefunden: ${path}`);
    this.refuseProtectedFolder(folder);
    const delimiter = folder.delimiter || DEFAULT_DELIMITER;
    const count = e.store.countByFolder(folder.id).total;
    if (count > 0) {
      throw new FolderNameError(
        `Der Ordner enthält noch ${count} E-Mails. Verschieben oder löschen Sie sie zuerst.`
      );
    }
    if (e.store.allFolders().some((f) => isPathOrChild(f.imap_path, path, delimiter) && f.imap_path !== path)) {
      throw new FolderNameError('Der Ordner enthält noch Unterordner. Löschen Sie sie zuerst.');
    }
    this.refusePendingOpsIn(e, path, delimiter);
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'folder_delete',
      folderPath: path,
      payload: { path },
    });
    await this.replayOps(e, [opId]);
    return this.opToSummary(e.store.journalGet(opId)!);
  }

  /** B1: INBOX and the special-use folders may never be renamed or deleted */
  private refuseProtectedFolder(folder: FolderRow): void {
    if (isProtectedFolder({ path: folder.imap_path, specialUse: folder.special_use })) {
      throw new FolderNameError('Dieser Ordner kann nicht umbenannt oder gelöscht werden.')
    }
  }

  /** B1: no folder op may race a pending one for the folder or its subfolders */
  private refusePendingOpsIn(e: AccountEntry, path: string, delimiter: string): void {
    const busy = e.store.journalPending(500).some((op) => {
      if (op.state !== 'pending' && op.state !== 'running') return false
      const paths = [op.folder_path, op.target_folder_path].filter(Boolean) as string[]
      return paths.some((p) => isPathOrChild(p, path, delimiter))
    })
    if (busy) {
      throw new FolderNameError(
        'Für diesen Ordner läuft noch eine Änderung. Bitte versuchen Sie es gleich noch einmal.'
      )
    }
  }

  // ----- compose (sandbox only) -----

  async getContacts(partial: string, accountId?: string): Promise<{ name: string; email: string }[]> {
    return this.entry(accountId).store.searchContacts(partial);
  }

  async saveDraft(draft: DraftInput, replaceUid?: number | null, accountId?: string): Promise<number> {
    const e = this.writableEntry(accountId);
    const draftsFolder = this.draftsFolder(e);
    const { raw } = await this.buildMimeMessage(e, draft, { draft: true });
    const oldUid = replaceUid ?? undefined;
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'draft_save',
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
    if (result.outcome === 'failed' && e.store.journalGet(opId)?.state !== 'done') {
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

  private entry(id?: string): AccountEntry {
    const key = id ?? this.activeId;
    const e = this.entries.get(key);
    if (!e) throw new Error(`unknown account "${key}"`);
    return e;
  }

  /** Account for WRITE operations: defaults to the PRIMARY WRITABLE account, never
   * the currently selected one (Task 2 compose regression lesson). */
  private writableEntry(id?: string): AccountEntry {
    const key = id ?? [...this.entries.keys()].find(k => !this.entries.get(k)!.config.readOnly);
    const e = this.entry(key);
    if (e.config.readOnly) throw new Error('WRITE GUARD: account is read-only');
    return e;
  }

  private parseFlags(row: { flags_json: string }): { seen: boolean; flagged: boolean; draft: boolean; deleted: boolean; answered: boolean } {
    return JSON.parse(row.flags_json);
  }

  private toListItem(row: import('./store.js').MessageRow): MessageListItem {
    const flags = this.parseFlags(row);
    const attachments = this.parseAttachments(row);
    return {
      id: row.id,
      messageId: row.message_id,
      folderId: row.folder_id,
      uid: row.uid,
      subject: row.subject || '(no subject)',
      fromName: row.from_name,
      fromEmail: row.from_email,
      date: row.date,
      internalDate: row.internal_date,
      hasAttachments: row.has_attachments === 1,
      attachmentNames: attachments.filter(a => !a.isInline).map(a => a.filename),
      isRead: flags.seen,
      isFlagged: flags.flagged,
      isDraft: flags.draft,
      snippet: row.snippet,
      threadId: row.thread_id,
      threadCount: 1,
    };
  }

  private parseAttachments(row: { attachments_json: string }): AttachmentMeta[] {
    try { return JSON.parse(row.attachments_json); } catch { return []; }
  }

  private toDetail(_e: AccountEntry, row: import('./store.js').MessageRow, loadedImages: RemoteImageRef[] | null): MessageDetail {
    const base = this.toListItem(row);
    const attachments: AttachmentInfo[] = this.parseAttachments(row).map(a => ({
      partId: a.partId, filename: a.filename, contentType: a.contentType,
      sizeBytes: a.size, isInline: a.isInline, contentId: a.contentId,
    }));
    let html: string | null = null;
    let links: MessageDetail['links'] = [];
    let remoteImages: RemoteImageRef[] = [];
    if (row.body_html) {
      let raw = row.body_html;
      if (loadedImages && loadedImages.length) {
        const map = new Map(loadedImages.map(r => [r.url, r.placeholder]));
        raw = raw.replace(/(src\s*=\s*")(https?:\/\/[^"]+)(")/gi, (m, pre, url: string, post) =>
          map.has(url) ? `${pre}${map.get(url)}${post}` : m);
        raw = raw.replace(/(url\(\s*['"]?)(https?:\/\/[^)'"]+)(['"]?\s*\))/gi, (m, pre, url: string, post) =>
          map.has(url) ? `${pre}${map.get(url)}${post}` : m);
      }
      const s = sanitizeEmailHtml(raw);
      html = s.html;
      links = s.links;
      remoteImages = s.remoteImages;
    }
    return {
      ...base,
      to: this.safeJson(row.to_json, []),
      cc: this.safeJson(row.cc_json, []),
      messageId: row.message_id,
      inReplyTo: row.in_reply_to,
      references: this.safeJson(row.references_json, []),
      sizeBytes: row.size_bytes,
      bodyKind: row.body_html ? 'html' : 'text',
      html,
      text: row.body_text,
      attachments,
      emlPath: row.file_path,
      links,
      remoteImages,
      remoteImageCount: remoteImages.length,
    };
  }

  private safeJson<T>(s: string, fallback: T): T {
    try { return JSON.parse(s) as T; } catch { return fallback; }
  }

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

  private opToSummary(op: JournalRow): OpSummary {
    return {
      id: op.id, kind: op.kind, state: op.state,
      folderPath: op.folder_path, targetFolderPath: op.target_folder_path,
      uid: op.uid, messageId: op.message_id, attempts: op.attempts,
      createdAt: op.created_at, updatedAt: op.updated_at, error: op.error,
    };
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
   */
  async whenIdleForMaintenance(timeoutMs = 120_000): Promise<void> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const busy = [...this.entries.values()].some(e =>
        e.engine.isSyncing() && e.engine.getStatus().phase === 'initial');
      if (!busy) return;
      if (Date.now() > until) return;
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
        const known = new Set(
          (e.store.db.prepare('SELECT file_path FROM messages').all() as { file_path: string }[])
            .map(r => r.file_path));
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
   * At most `limit` rows per pass, so a big repair never blocks the sync loop.
   * Rows whose UID is gone from the server are left alone: the normal sync removes them.
   */
  async repairMissingFiles(limit = 50, accountId?: string): Promise<{ repaired: number; left: number }> {
    const e = this.entry(accountId);
    const dir = e.store.dataDirResolved;
    const rows = e.store.db.prepare(
      'SELECT id, folder_id, uid, file_path FROM messages ORDER BY id DESC')
      .all() as { id: number; folder_id: string; uid: number; file_path: string }[];
    const onDisk = new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);
    const missing = rows.filter(r => !onDisk.has(r.file_path)).slice(0, limit);
    if (!missing.length) return { repaired: 0, left: 0 };

    const client = await e.engine.connection();
    let repaired = 0;
    for (const row of missing) {
      const folder = e.store.getFolder(row.folder_id);
      if (!folder) continue;
      try {
        await client.mailboxOpen(folder.imap_path);
        for await (const msg of client.fetch(String(row.uid), {
          uid: true, source: true, flags: true, internalDate: true, size: true,
        }, { uid: true })) {
          if (!msg.source) continue;
          const relPath = writeMessageFile(dir, msg.source);
          e.store.db.prepare('UPDATE messages SET file_path = ? WHERE id = ?').run(relPath, row.id);
          repaired++;
        }
      } catch (err) {
        this.log.warn?.(`repair (${row.id}) skipped: ${(err as Error).message.slice(0, 80)}`);
      }
    }
    const left = rows.filter(r => !onDisk.has(r.file_path)).length - repaired;
    return { repaired, left: Math.max(0, left) };
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
   *  - waits for in-flight write ops to reach a journal state (they are crash-safe;
   *    a kill mid-op is recovered by the next start())
   *  - closes SQLite handles (WAL checkpoint on close)
   *  - releases the data-dir instance lock
   *  Does NOT replay failed ops or retry sends — replay happens on next start(). */
  async close(opts?: { syncWaitMs?: number }): Promise<void> {
    for (const [, e] of this.entries) {
      e.engine.stopPolling();
      if (e.engine.isSyncing()) {
        await e.engine.waitForSync(opts?.syncWaitMs ?? 10_000).catch(() => { });
      }
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

interface AttachmentMeta { partId: string; filename: string; contentType: string; size: number; isInline: boolean; contentId: string | null }

/** Factory: validate options, acquire the data-dir lock, wire accounts. */
export function createMailCore(options: MailCoreOptions): MailCore {
  return new MailCore(options);
}

/**
 * C2: a stable key for a mail without a Message-ID. The subject goes into the
 * hash and never leaves the worker in clear text for this purpose, so two mails
 * that differ only in subject stay distinct.
 */
export function messageFallbackKey(input: {
  date: string | null;
  fromEmail: string | null;
  sizeBytes: number | null;
  subject: string | null;
}): string {
  const normalized = [
    (input.date ?? '').trim(),
    (input.fromEmail ?? '').trim().toLowerCase(),
    String(input.sizeBytes ?? ''),
    (input.subject ?? '').trim(),
  ].join('|');
  return createHash('sha1').update(normalized, 'utf8').digest('hex');
}

/** A JSON address array from the store, tolerating NULL and junk */
function parseAddressList(raw: string | null): string[] {
  return parseJsonArray(raw)
    .map(a => (typeof a === 'string' ? a : (a as { email?: string })?.email ?? ''))
    .map(a => a.trim().toLowerCase())
    .filter(Boolean);
}

/** A JSON array column, tolerating NULL and junk */
function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** A Message-ID without its angle brackets, so both forms compare equal */
export function normalizeMessageId(raw: string | null | undefined): string {
  return (raw ?? '').replace(/^</, '').replace(/>$/, '').trim();
}
