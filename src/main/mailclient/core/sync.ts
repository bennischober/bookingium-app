// Two-way sync engine (Task 2 Step 1).
// READ path: works against any IMAP server (production = read-only EXAMINE, sandbox = read-write).
// WRITE path: lives exclusively in write_guard.ts (sandbox host allowlist) — never here.
//
// Sync algorithm per folder:
//  1. Connection enables CONDSTORE+QRESYNC via the `qresync: true` client option
//     (imapflow 2.x has no public enable(); autoEnable() does it after login).
//  2. Full sync (first sync, explicit, or UIDVALIDITY change): authoritative UID list,
//     delete vanished rows, download new messages, refresh flags.
//  3. Incremental: UID list diff (expunge/new) + flags fetch with `changedSince`
//     (CONDSTORE: server returns only messages with higher MODSEQ).
//  4. IMAP IDLE: a dedicated second connection holds INBOX open; changes wake it up
//     and trigger an incremental sync. Reconnect with exponential backoff.
//  5. Every path is idempotent: row updates keyed by (folder, uid) + message_key
//     sha1(account|uidValidity|uid).
import { ImapFlow } from 'imapflow';
import fs from 'fs';
import { STAGING_PREFIX, Store } from './store.js';
import type { ConnectionState, ImapSecurity } from './types.js';
import { allowsPlainLogin } from './imap_options.js';
import { diskFullMessage, freeBytesOf, isDiskFullError } from './disk_full.js';
import { isPathOrChild } from './folders.js';
import { ConnectionBudget } from './connection_budget.js';
import { FolderLocks, hasInFlightOps } from './folder_locks.js';
import { SyncConnection } from './sync_connection.js';
import { MessageIngest } from './message_ingest.js';
import { FolderSync, nextUid, uidRange } from './folder_sync.js';
import { IDLE_CAP_MS, IdleLoop, idleWait, Poller } from './idle_poll.js';

export { IDLE_CAP_MS, idleWait, nextUid, uidRange };

export interface AccountConfig {
  id: string;
  host: string;
  port: number;
  security: ImapSecurity;
  user: string;    // resolved lazily by the host's credentials provider (createMailCore)
  pass: string;
  readOnly: boolean;           // true for production
  dataDir: string;             // ABSOLUTE (createMailCore resolves it; core never guesses paths)
  // Task 3: throttle + pacing for live/production servers (gentle-by-default)
  maxConnections?: number;     // hard cap for sync, IDLE and writes together (I15a: a write takes IDLE's slot)
  batchBytes?: number;         // pause download when a batch exceeds this
  // S1: a message above this server size (RFC822.SIZE) is stored as its skeleton, without its
  // large parts, until it is opened. Unset: every message is downloaded whole.
  lazyAboveBytes?: number;
  interBatchDelayMs?: number;  // sleep between download batches
  requestDelayMs?: number;     // sleep between IMAP commands in sweeps
}

/** Task 5: account configs are built by the HOST from injected values — the core no
 * longer reads process.env or derives repo paths. These two builders keep the pacing
 * defaults that were tuned for IONOS (Task 3) so hosts get sane numbers for free. */
export function makeProductionAccount(input: {
  id: string; host: string; port: number; security: ImapSecurity; user: string; pass: string; dataDir: string;
}): AccountConfig {
  // never a password in the clear across a network
  if (input.security === 'none' && !allowsPlainLogin(input.host)) {
    throw new Error(`account ${input.id}: a production account needs TLS or STARTTLS`);
  }
  return {
    id: input.id,
    host: input.host, port: input.port,
    security: input.security,
    user: input.user, pass: input.pass,
    readOnly: true,
    dataDir: input.dataDir,
    maxConnections: 2,             // sync + IDLE, or sync + write (I15a) — hard cap, gentle to the live server
    batchBytes: 4 * 1024 * 1024,   // ~4 MB per batch, then interBatchDelay
    interBatchDelayMs: 750,        // ~5 MB/s sustained body throughput, well under any limit
    requestDelayMs: 150,           // pace STATUS/UID sweeps
  };
}

/**
 * A7 part 2: the canary mailbox. A real server, so it gets the production pacing
 * (2 connections, ~4 MB batches, paced STATUS sweeps) - but unlike a production account
 * it is writable, because the whole point is to prove the write path against a real
 * mailbox. The guard decides whether a write may actually go out; this only builds the
 * account, so a canary that is not admitted is still read-only in practice.
 */
export function makeCanaryAccount(input: {
  id: string; host: string; port: number; security: ImapSecurity; user: string; pass: string; dataDir: string;
}): AccountConfig {
  if (input.security === 'none' && !allowsPlainLogin(input.host)) {
    throw new Error(`account ${input.id}: a real mailbox needs TLS or STARTTLS`);
  }
  return {
    id: input.id,
    host: input.host, port: input.port,
    security: input.security,
    user: input.user, pass: input.pass,
    readOnly: false,              // writable, but only through write_guard's admission
    dataDir: input.dataDir,
    maxConnections: 2,             // sync + IDLE, or sync + write (I15a) - hard cap, gentle to the live server
    batchBytes: 4 * 1024 * 1024,   // ~4 MB per batch, then interBatchDelay
    interBatchDelayMs: 750,        // ~5 MB/s sustained body throughput, well under any limit
    requestDelayMs: 150,           // pace STATUS/UID sweeps
  };
}

export function makeSandboxAccount(input: {
  id: string; host: string; port: number; security: ImapSecurity; user: string; pass: string; dataDir: string;
}): AccountConfig {
  return {
    id: input.id,
    host: input.host, port: input.port,
    security: input.security,
    user: input.user, pass: input.pass,
    readOnly: false,            // sandbox: write path enabled (but only via write_guard)
    dataDir: input.dataDir,
  };
}

export type SyncEvent =
  | { type: 'folder-list'; folders: string[] }
  | { type: 'folder-start'; path: string; mode: 'full' | 'incremental' }
  // specialUse is added by the core when it forwards the event (MR-28); the engine leaves it out
  | { type: 'folder-done'; path: string; newCount: number; flagChanges: number; expunged: number; moved: number; specialUse?: string | null }
  | { type: 'error'; path: string | null; message: string };

export type SyncProgress = {
  running: boolean;
  lastSyncAt: string | null;
  idleConnected: boolean;
  foldersSynced: number;
  foldersTotal: number;
  newMessages: number;
  flagChanges: number;
  expunged: number;
  errors: string[];
  // Task 3 additions
  currentFolder: string | null;
  messagesDone: number;
  messagesTotal: number | null;
  bytesDone: number;
  phase: 'idle' | 'initial' | 'incremental' | 'paused' | 'error' | 'disk-full';
  paused: boolean;
  accountId: string;
  // whether the server can be reached; 'auth-failed' is final until the account is saved again
  connection: ConnectionState;
  retryAt: string | null;      // when offline: the next attempt
  connectionError: string | null;
  /** Set when a write failed because the disk is full; cleared by resume(). The reason, in German. */
  diskFull?: string | null;
};

export class SyncEngine {
  private syncing = false;
  // I17 (test gap): folder syncs and polls in flight outside a full pass (`syncing`)
  private inFlight = 0;
  private stopped = false;
  private progress: SyncProgress = {
    running: false, lastSyncAt: null, idleConnected: false,
    foldersSynced: 0, foldersTotal: 0, newMessages: 0, flagChanges: 0, expunged: 0, errors: [],
    currentFolder: null, messagesDone: 0, messagesTotal: null, bytesDone: 0,
    phase: 'idle', paused: false, accountId: 'unknown',
    connection: 'connecting', retryAt: null, connectionError: null, diskFull: null,
  };
  /** Set when a write failed because the disk is full; cleared by resume(). */
  private diskFull = false;
  /** Called once when the login is rejected (the factory drops its cached credentials). */
  onAuthFailed: (() => void) | null = null;
  // move correlation within one sync pass (QRESYNC reports a move as vanish+new)
  private passDeletedMsgIds = new Set<string>();
  private passInsertedMsgIds = new Set<string>();
  // R1: the per-folder mutex and the writes waiting for it (folder_locks.ts)
  private readonly locks = new FolderLocks();
  // Task 3: pause/resume + concurrency cap + error circuit breaker
  private paused = false;
  // what the running pass is: 'initial' while some folder was never downloaded
  private passPhase: 'initial' | 'incremental' = 'incremental';
  private pauseResolvers: (() => void)[] = [];
  // I15a (MR-19): sync, IDLE and the write engine draw from one budget per account
  private readonly budget: ConnectionBudget;
  // R1: the IMAP connections, backoff, circuit breaker and capabilities (sync_connection.ts)
  private readonly conn: SyncConnection;
  // R1: storing one downloaded message (message_ingest.ts)
  private readonly ingest: MessageIngest;
  // R1: one folder's sync pass (folder_sync.ts)
  private readonly folders: FolderSync;
  // R1: the IDLE loop on INBOX and the STATUS poll with the flag sweep (idle_poll.ts)
  private readonly idle: IdleLoop;
  private readonly poller: Poller;
  // I18: free bytes on the store's drive, checked before a UIDVALIDITY swap (a seam for tests)
  private readonly freeBytes: (dir: string) => number | null;
  // Task 5: injected structured logger (host decides where output goes; core never
  // writes to console directly). Optional — tests may omit it.
  readonly log: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };

  private get syncingFolders(): Map<string, symbol> { return this.locks.syncingFolders; }

  private withFolderMutex<T>(imapPath: string, fn: () => Promise<T>, owner?: symbol): Promise<T> {
    return this.locks.withFolderMutex(imapPath, fn, owner);
  }

  withFolderMutexPublic<T>(imapPath: string, fn: () => Promise<T>): Promise<T> {
    return this.locks.withFolderMutexPublic(imapPath, fn);
  }

  private yieldFolderToWrites(imapPath: string): Promise<void> {
    return this.locks.yieldFolderToWrites(imapPath);
  }

  hasInFlightOps(folderPath: string): boolean { return hasInFlightOps(this.store, folderPath); }

  constructor(private account: AccountConfig, private store: Store, options?: {
    forceNoCondstore?: boolean;
    /** QA seam: fail every local write with this code, to exercise the disk-full path for real. */
    faultWriteCode?: string;
    log?: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
    /** I15a: the account's connection budget, shared with the write engine */
    budget?: ConnectionBudget;
    /** I18: QA seam, free bytes on the drive of `dir` (null = unknown, the swap goes ahead) */
    freeBytes?: (dir: string) => number | null;
  }) {
    this.progress.accountId = account.id;
    this.budget = options?.budget ?? new ConnectionBudget(account.maxConnections ?? 4);
    this.freeBytes = options?.freeBytes ?? freeBytesOf;
    this.log = options?.log ?? {};
    // Task 3: kill-switch for testing the no-CONDSTORE path against Dovecot
    // (Task 5: comes in through the factory options, not process.env)
    this.conn = new SyncConnection({
      account: this.account,
      budget: this.budget,
      log: this.log,
      progress: () => this.progress,
      emit: e => this.emit(e),
      isStopped: () => this.stopped,
      stopAfterAuthFailure: () => { this.stopped = true; this.pollingStop = true; },
      authFailed: () => this.onAuthFailed?.(),
      waitWhilePaused: () => this.waitWhilePaused(),
    }, options?.forceNoCondstore === true);
    this.ingest = new MessageIngest({
      account: this.account,
      store: this.store,
      log: this.log,
      passInsertedMsgIds: () => this.passInsertedMsgIds,
    }, options?.faultWriteCode);
    this.folders = new FolderSync({
      account: this.account,
      store: this.store,
      log: this.log,
      progress: () => this.progress,
      emit: e => this.emit(e),
      isStopped: () => this.stopped,
      isPaused: () => this.paused,
      waitWhilePaused: () => this.waitWhilePaused(),
      connect: () => this.connect(),
      gate: () => this.gate(),
      noteError: context => this.noteError(context),
      hasCondstore: () => this.hasCondstore,
      yieldFolderToWrites: imapPath => this.yieldFolderToWrites(imapPath),
      freeBytes: dir => this.freeBytes(dir),
      noteDiskFull: (path, message) => this.noteDiskFull(path, message),
      diskFullError: () => this.diskFullError(),
      storeMessage: (folderId, uidValidity, msg, opts) => this.storeMessage(folderId, uidValidity, msg, opts),
      downloadMessages: (...a) => this.downloadMessages(...a),
      fullSyncFolder: (...a) => this.fullSyncFolder(...a),
      incrementalSyncFolder: (...a) => this.incrementalSyncFolder(...a),
      resyncAfterValidityChange: (...a) => this.resyncAfterValidityChange(...a),
    });
    this.idle = new IdleLoop({
      account: this.account,
      store: this.store,
      budget: this.budget,
      progress: () => this.progress,
      emit: e => this.emit(e),
      isStopped: () => this.stopped,
      setStopped: stopped => { this.stopped = stopped; },
      isDiskFull: () => this.diskFull,
      authFailed: () => this.authFailed,
      client: () => this.client,
      idleClient: () => this.idleClient,
      setIdleClient: client => { this.idleClient = client; },
      backoffMs: () => this.backoffMs,
      setBackoffMs: ms => { this.backoffMs = ms; },
      circuitOpenUntil: () => this.circuitOpenUntil,
      newClient: () => this.newClient(),
      noteConnectFailure: e => this.noteConnectFailure(e),
      noteDisconnect: () => this.noteDisconnect(),
      noteError: context => this.noteError(context),
      noteSuccess: () => this.noteSuccess(),
      noteDiskFull: path => this.noteDiskFull(path),
      withFolderMutex: (imapPath, fn) => this.withFolderMutex(imapPath, fn),
      fullSyncFolder: (...a) => this.fullSyncFolder(...a),
      incrementalSyncFolder: (...a) => this.incrementalSyncFolder(...a),
      resyncAfterValidityChange: (...a) => this.resyncAfterValidityChange(...a),
    });
    this.poller = new Poller({
      account: this.account,
      store: this.store,
      progress: () => this.progress,
      emit: e => this.emit(e),
      isSyncing: () => this.syncing,
      isDiskFull: () => this.diskFull,
      authFailed: () => this.authFailed,
      hasCondstore: () => this.hasCondstore,
      lastSyncAt: () => this.lastSyncAt,
      inFlight: () => this.inFlight,
      setInFlight: n => { this.inFlight = n; },
      syncingFolders: () => this.syncingFolders,
      connect: () => this.connect(),
      gate: () => this.gate(),
      noteError: context => this.noteError(context),
      noteSuccess: () => this.noteSuccess(),
      noteServerContact: () => this.noteServerContact(),
      noteDiskFull: path => this.noteDiskFull(path),
      syncFolder: imapPath => this.syncFolder(imapPath),
      syncAll: () => this.syncAll(),
      withSelected: (imapPath, expectedValidity, fn) => this.withSelected(imapPath, expectedValidity, fn),
    });
  }

  private get client(): ImapFlow | null { return this.conn.client; }
  private set client(client: ImapFlow | null) { this.conn.client = client; }
  private get idleClient(): ImapFlow | null { return this.conn.idleClient; }
  private set idleClient(client: ImapFlow | null) { this.conn.idleClient = client; }
  private get backoffMs(): number { return this.conn.backoffMs; }
  private set backoffMs(ms: number) { this.conn.backoffMs = ms; }
  private get lastSyncAt(): string | null { return this.conn.lastSyncAt; }
  private get authFailed(): boolean { return this.conn.authFailed; }
  private get circuitOpenUntil(): number { return this.conn.circuitOpenUntil; }
  private noteConnectFailure(e: unknown): void { this.conn.noteConnectFailure(e); }
  private noteError(context: string): boolean { return this.conn.noteError(context); }
  private noteSuccess(): void { this.conn.noteSuccess(); }
  private noteServerContact(): void { this.conn.noteServerContact(); }
  private noteDisconnect(): boolean { return this.conn.noteDisconnect(); }
  private gate(): Promise<void> { return this.conn.gate(); }
  private newClient(): ImapFlow { return this.conn.newClient(); }
  private detectCapabilities(): Promise<void> { return this.conn.detectCapabilities(); }
  get hasCondstore(): boolean { return this.conn.hasCondstore; }
  private connect(): Promise<ImapFlow> { return this.conn.connect(); }

  get isSandbox(): boolean { return !this.account.readOnly; }

  getStatus(): SyncProgress {
    const retryAt = this.progress.connection === 'offline' && this.nextPollAt !== null
      ? new Date(this.nextPollAt).toISOString() : null;
    return { ...this.progress, running: this.syncing, lastSyncAt: this.lastSyncAt, paused: this.paused, retryAt };
  }

  isSyncing(): boolean { return this.syncing; }

  /** A3: the sync engine's own connection, for read-only work (repair fetches).
   *  Shares the 2-connection limit; callers must not open a second client. */
  connection(): Promise<ImapFlow> { return this.connect(); }

  /**
   * I4 (MR-09): run read-only work against one folder on the sync connection. A bare
   * FETCH there goes to whatever folder the connection has selected right now, and two
   * folders can share UIDs, so a flag sweep or a repair that skips the selection writes
   * one folder's data into the other's rows. This takes the folder mutex (no sync or
   * write of the folder runs meanwhile), an imapflow lock (EXAMINE, queued behind every
   * other lock holder on this client) and checks UIDVALIDITY: when it differs from what
   * the store holds the UIDs mean other messages, so nothing runs (`null`) and the next
   * folder sync does the staged swap.
   */
  async withSelected<T>(imapPath: string, expectedValidity: string | null, fn: (client: ImapFlow) => Promise<T>): Promise<T | null> {
    return this.withFolderMutex(imapPath, async () => {
      const client = await this.connect();
      const lock = await client.getMailboxLock(imapPath, { readOnly: true });
      try {
        const mailbox = client.mailbox;
        if (!mailbox || mailbox.path !== imapPath) throw new Error(`mailbox ${imapPath} did not open`);
        if (expectedValidity && String(mailbox.uidValidity) !== expectedValidity) {
          this.log?.warn?.(`${imapPath}: UIDVALIDITY changed, skipping until the folder sync swaps it`);
          return null;
        }
        return await fn(client);
      } finally {
        lock.release();
      }
    });
  }

  get isDiskFull(): boolean { return this.diskFull; }

  /**
   * A local write failed for lack of space. Stops sync, poll, IDLE and repair until
   * `resume()` (the retry action): a full disk does not fix itself, and every retry
   * would only download the same message again and fail again (I4).
   */
  noteDiskFull(path: string | null, message = diskFullMessage()): void {
    const first = !this.diskFull;
    this.diskFull = true;
    this.progress.phase = 'disk-full';
    // I18: the first reason stays; the pass that stops on it reports the generic one after it
    if (first) {
      this.progress.diskFull = message;
      this.emit({ type: 'error', path, message });
    }
  }

  /** The error a stopped engine answers with, so callers take their disk-full branch. */
  private diskFullError(): Error {
    return Object.assign(new Error(diskFullMessage()), { code: 'ENOSPC' });
  }

  /** Task 3: pause the initial download (drains within ~one batch, then idles). */
  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.progress.paused = true;
      this.progress.phase = 'paused';
    }
  }

  /** Task 3: resume a paused download. Also clears a disk-full stop: the user freed space. */
  resume(): void {
    if (this.diskFull) {
      this.diskFull = false;
      this.progress.diskFull = null;
      if (this.progress.phase === 'disk-full') this.progress.phase = 'idle';
    }
    if (this.paused) {
      this.paused = false;
      this.progress.paused = false;
      this.progress.phase = this.syncing ? this.passPhase : 'idle';
      const resolvers = this.pauseResolvers;
      this.pauseResolvers = [];
      for (const r of resolvers) r();
    }
  }

  /** Await while paused (batch boundary). */
  private async waitWhilePaused(): Promise<void> {
    while (this.paused && !this.stopped) {
      await new Promise<void>(resolve => this.pauseResolvers.push(resolve));
    }
  }

  /**
   * I17 (test gap): is anything still using the store? A full pass, a folder sync (from a poll
   * or a write's resync), a poll, or any other holder of a folder mutex (IDLE, a repair).
   */
  hasWorkInFlight(): boolean {
    return this.syncing || this.inFlight > 0 || this.syncingFolders.size > 0;
  }

  /** I17 (test gap): resolve when hasWorkInFlight() turns false (or timeout). close() waits for
   *  this, not waitForSync: a poll-triggered folder sync is no pass, and the store used to close under it. */
  waitForWork(timeoutMs = 120_000): Promise<void> {
    if (!this.hasWorkInFlight()) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(done, timeoutMs);
      const check = setInterval(() => { if (!this.hasWorkInFlight()) done(); }, 100);
      function done() { clearTimeout(timer); clearInterval(check); resolve(); }
    });
  }

  /** Resolve when the current sync pass finishes (or timeout). */
  waitForSync(timeoutMs = 120_000): Promise<void> {
    if (!this.syncing) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimeout(resolve, timeoutMs);
      const check = setInterval(() => {
        if (!this.syncing) { clearTimeout(timer); clearInterval(check); resolve(); }
      }, 250);
    });
  }

  // Task 5: optional event sink — the factory forwards these to the host via
  // core.on('sync-event', cb). Core itself never writes to console.
  onSyncEvent: ((e: SyncEvent) => void) | null = null;

  emit(e: SyncEvent) {
    this.progress.errors = this.progress.errors.slice(-9);
    if (e.type === 'error') this.progress.errors.push(`${e.path ?? '?'}: ${e.message}`);
    if (e.type === 'folder-done') {
      this.progress.newMessages += e.newCount;
      this.progress.flagChanges += e.flagChanges;
      this.progress.expunged += e.expunged;
    }
    try { this.onSyncEvent?.(e); } catch { /* listener errors never break sync */ }
  }

  // ---------- folder discovery ----------
  async syncFolderList(): Promise<string[]> {
    const client = await this.connect();
    const list = await client.list();
    const paths: string[] = [];
    // I4 (MR-31): a LIST between the server RENAME and the store's re-key sees the new path
    // already. Creating its row here made the re-key fail on the primary key and downloaded
    // the folder twice, so paths inside a pending rename are left to the rename op.
    const renames = this.pendingRenames();
    const renaming = (path: string) => renames.some(r => isPathOrChild(path, r.from, r.delimiter) || isPathOrChild(path, r.to, r.delimiter));
    for (const f of list) {
      if (f.flags.has('\\Noselect')) continue;
      if (renaming(f.path)) { paths.push(f.path); continue; }
      this.store.upsertFolder({
        imapPath: f.path,
        delimiter: f.delimiter || '/',
        specialUse: f.specialUse || null,
      });
      paths.push(f.path);
    }
    // Task 4 (found by the orphan investigation): folders can VANISH on the server
    // (tests delete+recreate; users delete folders in other clients). Until now the
    // store kept their rows forever — search kept finding mail that no longer exists.
    // Prune — with THREE safety gates, because a partial/flaky LIST response must never
    // nuke the cache (found the hard way: a Dovecot hiccup right after startup made
    // LIST return only the special-use folders and the first version pruned 290 healthy
    // folders; the store recovered by re-downloading, but that's luck, not design):
    //   Gate 1 (debounce): a folder is pruned only if it was ALREADY absent in the
    //     previous list pass (list_absent_since set) and is still absent now.
    //   Gate 2 (blast radius): refuse to prune if that would remove >25% of known
    //     folders in one pass — that pattern means OUR VIEW is wrong, not the server.
    //   Gate 3 (staging): staging folders are never pruned here (transient by design).
    const serverPaths = new Set(paths);
    const localFolders = this.store.allFolders().filter(f => f.account_id === this.account.id
      && !f.imap_path.startsWith(STAGING_PREFIX) && !renaming(f.imap_path));
    // Gate 0 (card A2a): a TRUNCATED/EMPTY LIST response must prune NOTHING — ever.
    // The blast-radius cap (Gate 2) only limits each pass to 25%, so repeated empty
    // LISTs would still nuke the whole cache 25% per pass. An empty result, or one
    // without INBOX, while folders are known means OUR VIEW or the CONNECTION is
    // broken, not the server — observe only.
    if (localFolders.length > 0 && (serverPaths.size === 0 || !serverPaths.has('INBOX'))) {
      this.log?.warn?.(`folder-list sync: LIST returned ${serverPaths.size} folder(s)` +
        `${serverPaths.size ? ' without INBOX' : ''} while ${localFolders.length} are known — ` +
        `treating as a broken/truncated response, no pruning this pass`);
      this.emit({ type: 'error', path: null, message: 'folder-list sync: empty or INBOX-less LIST result ignored (safety gate 0)' });
      return paths;
    }
    // Gate 1a: mark currently-absent folders with a timestamp (first absence = observe)
    const now = new Date().toISOString();
    for (const f of localFolders) {
      if (!serverPaths.has(f.imap_path)) {
        if (!f.list_absent_since) {
          this.store.db.prepare('UPDATE folders SET list_absent_since = ? WHERE id = ?').run(now, f.id);
        }
      } else if (f.list_absent_since) {
        this.store.db.prepare('UPDATE folders SET list_absent_since = NULL WHERE id = ?').run(f.id);
      }
    }
    // Gate 1b: candidates = absent now AND absent since a PREVIOUS pass
    const candidates = localFolders.filter(f => !serverPaths.has(f.imap_path)
      && f.list_absent_since && f.list_absent_since !== now);
    // Gate 2: blast-radius cap
    const maxPrune = Math.floor(localFolders.length * 0.25);
    const toPrune = candidates.slice(0, Math.max(0, maxPrune));
    if (candidates.length > maxPrune) {
      this.log?.warn?.(`folder-list sync: ${candidates.length} folders appear vanished but that is ` +
        `${Math.round(100 * candidates.length / Math.max(1, localFolders.length))}% of the store — ` +
        `refusing to prune (suspicious LIST result). Will retry next pass.`);
    }
    for (const f of toPrune) {
      const rows = this.store.db.prepare('SELECT id, file_path FROM messages WHERE folder_id = ?')
        .all(f.id) as { id: number; file_path: string }[];
      this.store.deleteMessages(rows.map(r => r.id));
      for (const r of rows) {
        try { fs.unlinkSync(this.store.filePath(r.file_path)); } catch { /* vanished folder: the file may already be gone, and the row is deleted either way */ }
      }
      this.store.db.prepare('DELETE FROM folders WHERE id = ?').run(f.id);
    }
    if (toPrune.length) this.log?.info?.(`folder-list sync: pruned ${toPrune.length} vanished folder(s)`);
    // I12 (MR-41): staging is kept between passes so a swap can resume; once its real folder
    // is pruned (through the gates above) there is nothing left to swap into
    for (const f of this.store.allFolders()) {
      if (f.imap_path.startsWith(STAGING_PREFIX) && !this.store.getFolderByPath(f.imap_path.slice(STAGING_PREFIX.length))) {
        this.dropStaging(f.id);
      }
    }
    this.emit({ type: 'folder-list', folders: paths });
    return paths;
  }

  // ---------- per-folder sync ----------
  async syncFolder(imapPath: string, opts: { full?: boolean } = {}): Promise<void> {
    if (this.diskFull) throw this.diskFullError();
    // I4 (MR-31): a folder rename in flight moves this path's rows; syncing the old or the
    // new path meanwhile would download the folder a second time or prune what is moving
    if (this.renamePending(imapPath)) return;
    // I17 (test gap): counted from here, so a call still waiting for the mutex counts too
    this.inFlight++;
    try {
      await this.withFolderMutex(imapPath, () => this.syncFolderInner(imapPath, opts));
    } finally {
      this.inFlight--;
    }
  }

  /** I4 (MR-31): is this path inside the source or target subtree of a pending or running folder rename? */
  renamePending(imapPath: string): boolean {
    return this.pendingRenames().some(r => isPathOrChild(imapPath, r.from, r.delimiter) || isPathOrChild(imapPath, r.to, r.delimiter));
  }

  /** The source and target of every folder rename that has not finished yet. */
  private pendingRenames(): { from: string; to: string; delimiter: string }[] {
    const rows = this.store.db.prepare(`SELECT payload FROM op_journal
      WHERE kind = 'folder_rename' AND state IN ('pending','running')`).all() as { payload: string | null }[];
    const renames: { from: string; to: string; delimiter: string }[] = [];
    for (const r of rows) {
      try {
        const p = JSON.parse(r.payload ?? '{}') as { from?: string; to?: string; delimiter?: string };
        if (p.from && p.to) renames.push({ from: p.from, to: p.to, delimiter: p.delimiter || '/' });
      } catch { /* a payload that does not parse cannot be replayed either; nothing to guard */ }
    }
    return renames;
  }

  private syncFolderInner(...a: Parameters<FolderSync['syncFolderInner']>): Promise<void> { return this.folders.syncFolderInner(...a); }
  private resyncAfterValidityChange(...a: Parameters<FolderSync['resyncAfterValidityChange']>): Promise<void> { return this.folders.resyncAfterValidityChange(...a); }
  private fullSyncFolder(...a: Parameters<FolderSync['fullSyncFolder']>): Promise<void> { return this.folders.fullSyncFolder(...a); }
  private incrementalSyncFolder(...a: Parameters<FolderSync['incrementalSyncFolder']>): Promise<void> { return this.folders.incrementalSyncFolder(...a); }
  private downloadMessages(...a: Parameters<FolderSync['downloadMessages']>): Promise<number> { return this.folders.downloadMessages(...a); }
  private dropStaging(stagingId: string): void { this.folders.dropStaging(stagingId); }

  storeAppendedDraft(folderId: string, uidValidity: string, uid: number, source: Buffer, flags?: Set<string>): Promise<void> {
    return this.ingest.storeAppendedDraft(folderId, uidValidity, uid, source, flags);
  }

  private storeMessage(folderId: string, uidValidity: string, msg: Parameters<MessageIngest['storeMessage']>[2],
    opts?: Parameters<MessageIngest['storeMessage']>[3]): Promise<void> {
    return this.ingest.storeMessage(folderId, uidValidity, msg, opts);
  }

  // ---------- full account sync ----------
  // Task 3: prioritized, resumable, throttled initial download.
  //   priority 0: INBOX (search useful immediately)
  //   priority 1: recently active folders (newest message within 90 days) — done by
  //               STATUS sweep first so "recent across folders" lands early
  //   priority 2: everything else (deep history)
  // Resume: a restart continues where the store left off — folders already fully
  // synced (uid_validity set AND no missing UIDs) are skipped after a cheap check.
  async syncAll(opts: { full?: boolean } = {}): Promise<SyncProgress> {
    if (this.syncing) return this.getStatus();
    // I4: stopped until resume(); a pass would only fail on the first download again
    if (this.diskFull) return this.getStatus();
    this.syncing = true;
    // settled once the folder list is known; until then a first pass after start looks initial
    this.passPhase = this.progress.messagesTotal === null ? 'initial' : 'incremental';
    this.progress = {
      ...this.progress, running: true,
      foldersSynced: 0, newMessages: 0, flagChanges: 0, expunged: 0, errors: [],
      phase: this.paused ? 'paused' : this.passPhase,
    };
    this.passDeletedMsgIds = new Set();
    this.passInsertedMsgIds = new Set();
    try {
      await this.detectCapabilities();
      const folders = await this.syncFolderList();
      this.progress.foldersTotal = folders.length;

      // total messages (one STATUS round per folder, also used for prioritization)
      const client0 = await this.connect();
      const statusByPath = new Map<string, number>();
      for (const p of folders) {
        await this.gate();
        try {
          const st = await client0.status(p, { messages: true });
          if (st && st.messages !== undefined) statusByPath.set(p, st.messages);
          if (this.account.requestDelayMs) await new Promise(r => setTimeout(r, this.account.requestDelayMs));
        } catch { /* STATUS on a weird folder — ignore, sync pass will handle */ }
      }
      this.progress.messagesTotal = [...statusByPath.values()].reduce((a, b) => a + b, 0)
        || (this.store.db.prepare('SELECT COUNT(*) c FROM messages').get() as { c: number }).c;

      // prioritization: INBOX first, then folders by "recentness" unknown → by size desc
      const localCounts = new Map<string, number>(
        (this.store.db.prepare('SELECT f.imap_path p, COUNT(m.id) c FROM folders f LEFT JOIN messages m ON m.folder_id = f.id WHERE f.account_id = ? GROUP BY f.id').all(this.account.id) as { p: string; c: number }[])
          .map(r => [r.p, r.c])
      );
      // A pass is a download only while some folder was never synced; after a restart the
      // count starts at what is already stored, so it does not look like starting over
      this.passPhase = folders.some(p => !this.store.getFolderByPath(p)?.uid_validity) ? 'initial' : 'incremental';
      if (!this.paused) this.progress.phase = this.passPhase;
      this.progress.messagesDone = folders.reduce((n, p) => n + (localCounts.get(p) ?? 0), 0);
      const ordered = [...folders].sort((a, b) => {
        if (a === 'INBOX') return -1;
        if (b === 'INBOX') return 1;
        const la = localCounts.get(a) ?? 0, lb = localCounts.get(b) ?? 0;
        const sa = statusByPath.get(a) ?? 0, sb = statusByPath.get(b) ?? 0;
        // folders with local rows that fully match server count are DONE → last
        const doneA = la > 0 && la === sa ? 1 : 0;
        const doneB = lb > 0 && lb === sb ? 1 : 0;
        if (doneA !== doneB) return doneA - doneB;
        // partial progress (la < sa) → most progress first (resume deep folders first)
        if (doneA === 0 && doneB === 0 && (la > 0 || lb > 0)) return lb - la;
        // untouched → newest-by-unknown: biggest first (history complete earlier)
        return sb - sa;
      });

      for (const p of ordered) {
        await this.gate();
        this.progress.currentFolder = p;
        try {
          await this.syncFolder(p, opts);
          this.noteSuccess();
        } catch (e) {
          // A full disk is not a connection problem and will not fix itself: stop the whole
          // pass instead of walking the remaining folders, and do NOT report it as offline
          // (that sends the user to check their network when the real cause is the drive).
          // Cleared by resume(), which the host wires to the retry action.
          if (isDiskFullError(e)) {
            this.noteDiskFull(p);
            return this.getStatus();
          }
          // circuit breaker already noted the error; stop the pass if open. Without a
          // connection every further folder would only wait out its own connect timeout.
          if (Date.now() < this.circuitOpenUntil || this.progress.connection !== 'online') {
            this.progress.phase = 'error';
            return this.getStatus();
          }
        }
        this.progress.foldersSynced++;
      }
      this.noteServerContact();
      this.progress.phase = 'idle';
    } catch (e) {
      this.progress.phase = 'error';
      this.emit({ type: 'error', path: null, message: `syncAll: ${(e as Error).message}` });
    } finally {
      this.syncing = false;
      this.progress.running = false;
      this.progress.currentFolder = null;
    }
    return this.getStatus();
  }

  /** Moved-message correlation: deleted + inserted in the same pass with same Message-ID. */
  detectMoves(): number {
    let moved = 0;
    for (const id of this.passInsertedMsgIds) {
      if (this.passDeletedMsgIds.has(id)) moved++;
    }
    return moved;
  }

  // ---------- IMAP IDLE and STATUS polling (idle_poll.ts) ----------
  startIdle(mailboxPath = 'INBOX', onChange?: () => void): Promise<void> { return this.idle.startIdle(mailboxPath, onChange); }
  pollOnce(): Promise<boolean> { return this.poller.pollOnce(); }
  startPolling(intervalMs = 60_000): Promise<void> { return this.poller.startPolling(intervalMs); }
  private get pollingStop(): boolean { return this.poller.pollingStop; }
  private set pollingStop(stop: boolean) { this.poller.pollingStop = stop; }
  private get nextPollAt(): number | null { return this.poller.nextPollAt; }

  stopPolling(): void { this.poller.stopPolling(); }

  stopIdle(): void { this.idle.stopIdle(); }


  async close(): Promise<void> {
    this.stopIdle();
    if (this.client) { try { this.client.close(); } catch { /* shutdown: the connection may already be gone */ } this.client = null; }
    if (this.idleClient) { try { this.idleClient.close(); } catch { /* shutdown: the IDLE connection may already be gone */ } this.idleClient = null; }
    this.progress.idleConnected = false;
  }
}
