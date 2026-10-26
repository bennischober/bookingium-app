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
import { simpleParser } from 'mailparser';
import crypto from 'crypto';
import fs from 'fs';
import { Store, Flags } from './store.js';
import type { ConnectionState, ImapSecurity } from './types.js';
import { allowsPlainLogin, IMAP_TIMEOUTS, imapSecurityOptions, isAuthFailure } from './imap_options.js';
import { writeMessageFile } from './files.js';

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
  maxConnections?: number;     // hard cap: 1 sync + 1 IDLE (never more)
  batchBytes?: number;         // pause download when a batch exceeds this
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
    maxConnections: 2,             // 1 sync + 1 IDLE — hard cap, gentle to the live server
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
    maxConnections: 2,             // 1 sync + 1 IDLE - hard cap, gentle to the live server
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
  | { type: 'folder-done'; path: string; newCount: number; flagChanges: number; expunged: number; moved: number }
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
  phase: 'idle' | 'initial' | 'incremental' | 'paused' | 'error';
  paused: boolean;
  accountId: string;
  // whether the server can be reached; 'auth-failed' is final until the account is saved again
  connection: ConnectionState;
  retryAt: string | null;      // when offline: the next attempt
  connectionError: string | null;
};

export class SyncEngine {
  private client: ImapFlow | null = null;          // main connection (sync + writes)
  private idleClient: ImapFlow | null = null;      // dedicated IDLE connection (INBOX)
  private syncing = false;
  private stopped = false;
  private backoffMs = 1000;
  private lastSyncAt: string | null = null;
  private progress: SyncProgress = {
    running: false, lastSyncAt: null, idleConnected: false,
    foldersSynced: 0, foldersTotal: 0, newMessages: 0, flagChanges: 0, expunged: 0, errors: [],
    currentFolder: null, messagesDone: 0, messagesTotal: null, bytesDone: 0,
    phase: 'idle', paused: false, accountId: 'unknown',
    connection: 'connecting', retryAt: null, connectionError: null,
  };
  // A rejected login stops all server contact for good: retrying a wrong password gets the
  // account locked. Only a new engine (the host restarts the core after a save) logs in again.
  private authFailed = false;
  /** Called once when the login is rejected (the factory drops its cached credentials). */
  onAuthFailed: (() => void) | null = null;
  private nextPollAt: number | null = null;
  // move correlation within one sync pass (QRESYNC reports a move as vanish+new)
  private passDeletedMsgIds = new Set<string>();
  private passInsertedMsgIds = new Set<string>();
  // per-folder mutex: main connection and IDLE connection must never sync the same
  // folder concurrently (two downloads of the same UIDs, duplicated work, wasted I/O)
  private syncingFolders = new Map<string, symbol>();
  // write ops waiting for a folder's mutex, by path (see yieldFolderToWrites)
  private writesWaiting = new Map<string, number>();
  // Task 3: pause/resume + concurrency cap + error circuit breaker
  private paused = false;
  // what the running pass is: 'initial' while some folder was never downloaded
  private passPhase: 'initial' | 'incremental' = 'incremental';
  private pauseResolvers: (() => void)[] = [];
  private connectionCount = 0;
  private consecutiveErrors = 0;
  private circuitOpenUntil = 0;
  private static readonly ERROR_THRESHOLD = 5;
  private static readonly CIRCUIT_COOLDOWN_MS = 60_000;
  private static readonly REPEATED_DISCONNECT_WINDOW_MS = 10 * 60_000;
  private static readonly REPEATED_DISCONNECT_LIMIT = 8;
  private disconnectTimestamps: number[] = [];
  // Task 3: server capability cache (set on first connect)
  private condstore = false;
  private idleCapable = false;
  // Task 3: testing hook — force the no-CONDSTORE code path even on servers that have it
  // (Task 5: injected via the factory's options.forceNoCondstore, no env reads)
  private readonly simulateNoCondstore: boolean;
  // Task 5: injected structured logger (host decides where output goes; core never
  // writes to console directly). Optional — tests may omit it.
  readonly log: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };

  /**
   * A6: the folder mutex carries an OWNER token. `finally` releases only if the
   * entry still holds this call's token, so a watchdog that gives up on a stuck op
   * can never release a lock some other holder owns (F2).
   */
  private async withFolderMutex<T>(imapPath: string, fn: () => Promise<T>, owner: symbol = Symbol('folder-mutex')): Promise<T> {
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
  private async yieldFolderToWrites(imapPath: string): Promise<void> {
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

  /** Task 4: does any pending/running write op touch this folder? (sync coexistence) */
  hasInFlightOps(folderPath: string): boolean {
    return this.store.db.prepare(`SELECT 1 FROM op_journal WHERE folder_path = ? OR target_folder_path = ?
      LIMIT 1`).get(folderPath, folderPath) !== undefined;
  }

  constructor(private account: AccountConfig, private store: Store, options?: {
    forceNoCondstore?: boolean;
    log?: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
  }) {
    this.progress.accountId = account.id;
    // Task 3: kill-switch for testing the no-CONDSTORE path against Dovecot
    // (Task 5: comes in through the factory options, not process.env)
    this.simulateNoCondstore = options?.forceNoCondstore === true;
    this.log = options?.log ?? {};
  }

  get isSandbox(): boolean { return !this.account.readOnly; }

  getStatus(): SyncProgress {
    const retryAt = this.progress.connection === 'offline' && this.nextPollAt !== null
      ? new Date(this.nextPollAt).toISOString() : null;
    return { ...this.progress, running: this.syncing, lastSyncAt: this.lastSyncAt, paused: this.paused, retryAt };
  }

  /** A connection attempt failed: a rejected login stops the engine, anything else is offline. */
  private noteConnectFailure(e: unknown): void {
    if (this.authFailed) return;
    const message = e instanceof Error ? e.message : String(e);
    if (!isAuthFailure(e)) {
      this.progress.connection = 'offline';
      this.progress.connectionError = message;
      return;
    }
    this.authFailed = true;
    this.stopped = true;
    this.pollingStop = true;
    this.progress.connection = 'auth-failed';
    this.progress.connectionError = message;
    this.progress.idleConnected = false;
    this.emit({ type: 'error', path: null, message: 'login rejected: no further attempts until the account is saved again' });
    try { this.onAuthFailed?.(); } catch { /* the stop above stands either way */ }
  }

  private noteOnline(): void {
    this.progress.connection = 'online';
    this.progress.connectionError = null;
  }

  isSyncing(): boolean { return this.syncing; }

  /** A3: the sync engine's own connection, for read-only work (repair fetches).
   *  Shares the 2-connection limit; callers must not open a second client. */
  connection(): Promise<ImapFlow> { return this.connect(); }

  /** Task 3: pause the initial download (drains within ~one batch, then idles). */
  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.progress.paused = true;
      this.progress.phase = 'paused';
    }
  }

  /** Task 3: resume a paused download. */
  resume(): void {
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
   * Task 3: circuit breaker for the live server. Consecutive errors or repeated
   * disconnects open the circuit for a cooldown; the caller must stop and report.
   * Returns true when the circuit is open (caller should abort the pass).
   */
  private noteError(context: string): boolean {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= SyncEngine.ERROR_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + SyncEngine.CIRCUIT_COOLDOWN_MS;
      this.emit({ type: 'error', path: null, message: `circuit breaker OPEN (${context}): ${this.consecutiveErrors} consecutive errors — cooling down ${SyncEngine.CIRCUIT_COOLDOWN_MS / 1000}s` });
      return true;
    }
    return false;
  }

  private noteSuccess(): void {
    this.consecutiveErrors = 0;
  }

  /**
   * H1: record that the server answered. The UI shows this as "Synchronisiert HH:MM",
   * so it must move on every successful contact - not only at the end of a full
   * syncAll(). The poll runs every 2 minutes and is the thing that keeps the mailbox
   * current; while it never touched this value the label could sit hours in the past and
   * the user reasonably read it as "my mail is stale".
   */
  private noteServerContact(): void {
    this.lastSyncAt = new Date().toISOString();
    this.progress.lastSyncAt = this.lastSyncAt;
  }

  private noteDisconnect(): boolean {
    const now = Date.now();
    this.disconnectTimestamps = this.disconnectTimestamps.filter(t => now - t < SyncEngine.REPEATED_DISCONNECT_WINDOW_MS);
    this.disconnectTimestamps.push(now);
    if (this.disconnectTimestamps.length >= SyncEngine.REPEATED_DISCONNECT_LIMIT) {
      this.circuitOpenUntil = now + SyncEngine.CIRCUIT_COOLDOWN_MS;
      this.emit({ type: 'error', path: null, message: `circuit breaker OPEN: ${this.disconnectTimestamps.length} disconnects in ${SyncEngine.REPEATED_DISCONNECT_WINDOW_MS / 60000} min — server may be rate-limiting; stopping sync activity` });
      this.disconnectTimestamps = [];
      return true;
    }
    return false;
  }

  private async gate(): Promise<void> {
    if (Date.now() < this.circuitOpenUntil) {
      const waitMs = this.circuitOpenUntil - Date.now();
      this.emit({ type: 'error', path: null, message: `circuit open: waiting ${Math.ceil(waitMs / 1000)}s before next server contact` });
      await new Promise(r => setTimeout(r, waitMs));
      this.circuitOpenUntil = 0;
      this.consecutiveErrors = 0;
      this.disconnectTimestamps = [];
    }
    await this.waitWhilePaused();
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

  private newClient(): ImapFlow {
    const client = new ImapFlow({
      host: this.account.host,
      port: this.account.port,
      ...imapSecurityOptions(this.account.security),
      auth: { user: this.account.user, pass: this.account.pass },
      // enables CONDSTORE + QRESYNC (+UTF8=ACCEPT) automatically after login.
      // Harmless when the server lacks them (server just ignores ENABLE).
      qresync: true,
      logger: false, emitLogs: false,
      ...IMAP_TIMEOUTS,
    });
    // After connect() imapflow reports a dead connection (socket timeout, reset) as an 'error'
    // event, which would throw without a listener. The connection is closed by then; the next
    // connect() or the IDLE loop opens a new one.
    client.on('error', (err: Error) => {
      this.log.warn?.(`imap connection error: ${err.message}`);
    });
    return client;
  }

  /** Task 3: server capabilities, detected once per engine (used to pick sync strategy). */
  private async detectCapabilities(): Promise<void> {
    if (this.condstore || this.idleCapable) return;   // already detected
    const client = await this.connect();
    const caps = client.capabilities;
    this.condstore = this.simulateNoCondstore ? false : (caps?.has?.('CONDSTORE') === true);
    this.idleCapable = caps?.has?.('IDLE') !== false;  // absent list → assume yes (mandatory since IMAP4rev1)
    if (this.simulateNoCondstore) {
      this.emit({ type: 'error', path: null, message: 'forceNoCondstore option set — forcing UID-sweep sync strategy (test mode)' });
    }
  }

  get hasCondstore(): boolean { return this.condstore; }

  private async connect(): Promise<ImapFlow> {
    if (this.authFailed) throw new Error('login rejected earlier: not logging in again');
    await this.gate();
    if (this.authFailed) throw new Error('login rejected earlier: not logging in again');
    if (this.client && this.client.usable) return this.client;
    if (this.client) { try { this.client.close(); } catch { /* stale client is already unusable; a failed close leaves nothing to release */ } this.client = null; }
    // Task 3: hard connection cap (1 sync + 1 IDLE for prod)
    const cap = this.account.maxConnections ?? 4;
    while (this.connectionCount >= cap) {
      await new Promise(r => setTimeout(r, 500));
      if (this.stopped) throw new Error('stopped');
    }
    const client = this.newClient();
    this.connectionCount++;
    try {
      await client.connect();
    } catch (e) {
      this.connectionCount--;
      this.noteConnectFailure(e);
      this.noteDisconnect();
      throw e;
    }
    this.noteOnline();
    client.on('close', () => {
      this.connectionCount = Math.max(0, this.connectionCount - 1);
      if (this.client === client || this.idleClient === client) this.noteDisconnect();
    });
    this.client = client;
    this.backoffMs = 1000;
    this.noteSuccess();
    return client;
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
    for (const f of list) {
      if (f.flags.has('\\Noselect')) continue;
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
      && !f.imap_path.startsWith('__staging__/'));
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
    this.emit({ type: 'folder-list', folders: paths });
    return paths;
  }

  // ---------- per-folder sync ----------
  async syncFolder(imapPath: string, opts: { full?: boolean } = {}): Promise<void> {
    await this.withFolderMutex(imapPath, () => this.syncFolderInner(imapPath, opts));
  }

  private async syncFolderInner(imapPath: string, opts: { full?: boolean } = {}): Promise<void> {
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
        await this.resyncAfterValidityChange(client, imapPath, folder.id, uidValidity, highestModseq);
        return;
      }

      // mode decision: full vs incremental. Without CONDSTORE, a "full" pass is still
      // cheap-ish: UID list diff + flags refresh + new downloads; old bodies are kept.
      const mode: 'full' | 'incremental' = (opts.full || !folder || !prevModseq) ? 'full' : 'incremental';
      this.emit({ type: 'folder-start', path: imapPath, mode });

      if (mode === 'full') {
        await this.fullSyncFolder(client, imapPath, uidValidity, highestModseq);
      } else {
        await this.incrementalSyncFolder(client, imapPath, uidValidity, prevModseq!, highestModseq);
      }
    } catch (e) {
      this.emit({ type: 'error', path: imapPath, message: (e as Error).message });
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
   */
  private async resyncAfterValidityChange(client: ImapFlow, imapPath: string, folderId: string, uidValidity: string, highestModseq: string | null): Promise<void> {
    const oldRows = this.store.db.prepare('SELECT id, file_path, message_key FROM messages WHERE folder_id = ?')
      .all(folderId) as { id: number; file_path: string; message_key: string }[];

    // stage the fresh download under a temp folder mapping (message_key includes the NEW
    // uidValidity → old and new rows cannot collide, both can coexist during download)
    const tempFolder = this.store.upsertFolder({ imapPath: `__staging__/${imapPath}`, delimiter: '/', specialUse: null, uidValidity });
    let swapped = false;
    try {
      const serverUids = new Set<number>();
      for await (const m of client.fetch('1:*', { uid: true }, { uid: true })) serverUids.add(Number(m.uid));
      // BUG FIX (found 2026-10-23, consistency suite after a live staged swap): the
      // staged download previously computed message_key with tempFolder.id — the swap
      // then moved rows to the real folder id but the key kept the staging id baked
      // in, producing unrecomputable keys (sha1(account|stagingId|validity|uid)).
      // The key must ALWAYS be derived from the REAL folder id; the staging folder
      // only exists so old and new rows can coexist in the DB during download.
      await this.downloadMessages(client, [...serverUids], imapPath, tempFolder.id, uidValidity, { newestFirst: true, keyFolderId: folderId });

      // atomic swap: new rows move to the real folder id, old rows' DB rows disappear
      const swap = this.store.db.transaction(() => {
        this.store.db.prepare('UPDATE messages SET folder_id = ? WHERE folder_id = ?').run(folderId, tempFolder.id);
        for (const r of oldRows) this.store.db.prepare('DELETE FROM messages WHERE id = ?').run(r.id);
        this.store.db.prepare(`UPDATE folders SET uid_validity=@v, uid_next=@n, highest_modseq=@m,
          last_sync_at=datetime('now'), last_flag_sweep=datetime('now') WHERE id=@id`)
          .run({ v: uidValidity, n: serverUids.size ? Math.max(...serverUids) + 1 : 1, m: highestModseq, id: folderId });
      });
      swap();
      swapped = true;

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
      this.store.db.prepare('DELETE FROM folders WHERE id = ?').run(tempFolder.id);
      this.emit({ type: 'folder-done', path: imapPath, newCount: serverUids.size, flagChanges: 0, expunged: oldRows.length, moved: 0 });
    } finally {
      if (!swapped) {
        // download failed mid-way: remove staged DB rows + their files (re-downloadable);
        // deleting rows first keeps the FK happy when dropping the staging folder
        const staged = this.store.db.prepare('SELECT id, file_path FROM messages WHERE folder_id = ?')
          .all(tempFolder.id) as { id: number; file_path: string }[];
        this.store.deleteMessages(staged.map(r => r.id));
        for (const r of staged) {
          try { fs.unlinkSync(this.store.filePath(r.file_path)); } catch { /* aborted staging download: the file is re-downloadable, so a failed unlink only leaves an orphan */ }
        }
        this.store.db.prepare('DELETE FROM folders WHERE id = ?').run(tempFolder.id);
      }
    }
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

  private async fullSyncFolder(client: ImapFlow, imapPath: string, uidValidity: string, highestModseq: string | null): Promise<void> {
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
    if (expungedLocal.length) {
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
    newCount = await this.downloadMessages(client, [...serverUids].filter(u => !localByUid.has(u)), imapPath, folder.id, uidValidity,
      { yieldToWrites: true });

    this.store.db.prepare(`UPDATE folders SET uid_validity=@uidValidity, uid_next=@uidNext,
      highest_modseq=@highestModseq, last_sync_at=datetime('now'),
      last_flag_sweep=datetime('now') WHERE id=@id`)
      .run({ uidValidity, uidNext: serverUids.size ? Math.max(...serverUids) + 1 : 1, highestModseq, id: folder.id });

    this.emit({ type: 'folder-done', path: imapPath, newCount, flagChanges, expunged, moved: 0 });
  }

  private async incrementalSyncFolder(client: ImapFlow, imapPath: string, uidValidity: string, changedSince: bigint, highestModseq: string | null): Promise<void> {
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
    if (expungedLocal.length) {
      this.store.deleteMessages(expungedLocal.map(r => r.id));
      for (const r of expungedLocal) {
        try { fs.unlinkSync(this.store.filePath(r.file_path)); } catch { /* server-side expunge: the row is gone already, a leftover file is an orphan for the sweep */ }
      }
      expunged = expungedLocal.length;
    }

    // 3. new messages
    const newUids = [...serverUids].filter(u => !localByUid.has(u));
    newCount = await this.downloadMessages(client, newUids, imapPath, folder.id, uidValidity, { yieldToWrites: true });

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

    this.store.db.prepare(`UPDATE folders SET uid_validity=@uidValidity, highest_modseq=@highestModseq,
      last_sync_at=datetime('now') WHERE id=@id`)
      .run({ uidValidity, highestModseq, id: folder.id });

    this.emit({ type: 'folder-done', path: imapPath, newCount, flagChanges, expunged, moved: 0 });
  }

  /**
   * Download a list of UIDs (full bodies) into the store. Returns count stored.
   * Task 3: throttled for live servers — batches sized by bytes, inter-batch delay,
   * pause-aware, progress-accounted (messagesDone/bytesDone). newestFirst for the
   * prioritized initial download (recent mail first → search useful early).
   */
  private async downloadMessages(client: ImapFlow, uids: number[], imapPath: string, folderId: string, uidValidity: string, opts: { newestFirst?: boolean; keyFolderId?: string; yieldToWrites?: boolean } = {}): Promise<number> {
    if (!uids.length) return 0;
    let stored = 0;
    // message_key identity uses keyFolderId (the REAL folder id) even when rows are
    // staged under a temp folder mapping — see resyncAfterValidityChange
    const keyFolderId = opts.keyFolderId ?? folderId;
    const sorted = [...uids].sort((a, b) => opts.newestFirst ? b - a : a - b);
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
      for await (const msg of client.fetch(range, {
        uid: true, source: true, flags: true, internalDate: true, size: true,
      }, { uid: true })) {
        if (!msg.source) continue;
        await this.storeMessage(keyFolderId, uidValidity, { ...msg, source: msg.source });
        batchStored++;
        this.progress.messagesDone++;
        this.progress.bytesDone += msg.source.length;
        // pause responsive even within a batch: fetch iterator is lazy, so waiting here
        // defers only the next fetch continuation (server command already in flight —
        // acceptable: one batch is ~4 MB)
        if (this.paused) await this.waitWhilePaused();
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

  /**
   * G5: store an appended draft locally at once, using the same parse/insert path as a synced mail.
   *
   * A saved draft used to have NO local row: it only appeared after the IMAP APPEND finished AND the
   * Drafts folder had been resynced, which re-downloaded the message the client had just uploaded.
   * On a real server that is the delay the person saw - the draft was on the server but invisible
   * in the list. Storing it here is the same work the resync would do, without the round-trip.
   */
  async storeAppendedDraft(
    folderId: string,
    uidValidity: string,
    uid: number,
    source: Buffer,
    flags?: Set<string>
  ): Promise<void> {
    await this.storeMessage(folderId, uidValidity, { uid, source, flags });
  }

  private async storeMessage(folderId: string, uidValidity: string, msg: {
    uid: number; source: Buffer; flags?: Set<string>; internalDate?: Date | string; modseq?: bigint; size?: number;
  }): Promise<void> {
    if (!msg.source) return;
    const key = this.store.messageKey(this.account.id, folderId, uidValidity, msg.uid);
    // idempotency: the IDLE connection and the main sync connection may both reach the
    // same new UID (message_key is UNIQUE) — the second one must be a no-op, not an error.
    if (this.store.getByKey(key)) return;
    // A3: opaque, permanent file name, written crash-safely (tmp -> fsync -> rename).
    // The row points at a file that exists: if the rename keeps failing, the file stays
    // under its .tmp name and that name is what the row stores.
    const relPath = writeMessageFile(this.store.dataDirResolved, msg.source);

    let parsed: Awaited<ReturnType<typeof simpleParser>>;
    try {
      parsed = await simpleParser(msg.source);
    } catch (e) {
      // insert minimal row so the message is not silently lost
      const flags = flagsFromSet(msg.flags);
      try {
        this.store.insertMessage({
          account_id: this.account.id, folder_id: folderId, uid: msg.uid, message_key: key, file_path: relPath,
          message_id: null, in_reply_to: null, references_json: '[]', thread_id: null,
          date: toIso(msg.internalDate), internal_date: toIso(msg.internalDate),
          subject: '', from_name: '', from_email: '', to_json: '[]', cc_json: '[]', bcc_json: '[]',
          flags_json: JSON.stringify(flags), modseq: msg.modseq !== undefined ? String(msg.modseq) : null,
          has_attachments: 0, attachments_json: '[]', size_bytes: msg.source.length,
          body_text: '', body_html: null, snippet: '', parsed_ok: 0, parse_error: (e as Error).message,
        });
      } catch (insertError) {
        // the other connection won the UNIQUE race: our file belongs to no row
        this.removeFile(relPath);
        if (!/UNIQUE/i.test((insertError as Error).message)) throw insertError;
      }
      return;
    }

    const flags = flagsFromSet(msg.flags);
    const from = addrList(parsed.from)[0] || { name: '', email: '' };
    const refs = parseReferences(parsed.references);
    const threadId = computeThreadId(parsed, refs);
    const messageId = parsed.messageId || null;
    if (messageId) this.passInsertedMsgIds.add(messageId);

    try {
      this.store.insertMessage({
        account_id: this.account.id, folder_id: folderId, uid: msg.uid, message_key: key, file_path: relPath,
        message_id: messageId,
        in_reply_to: parsed.inReplyTo || null,
        references_json: JSON.stringify(refs),
        thread_id: threadId,
        date: parsed.date && !isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : toIso(msg.internalDate),
        internal_date: toIso(msg.internalDate),
        subject: parsed.subject || '',
        from_name: from.name, from_email: from.email,
        to_json: JSON.stringify(addrList(parsed.to)),
        cc_json: JSON.stringify(addrList(parsed.cc)),
        bcc_json: JSON.stringify(addrList(parsed.bcc)),
        flags_json: JSON.stringify(flags),
        modseq: msg.modseq !== undefined ? String(msg.modseq) : null,
        has_attachments: (parsed.attachments || []).length > 0 ? 1 : 0,
        attachments_json: JSON.stringify((parsed.attachments || []).map(a => ({
          partId: a.partId || '', filename: a.filename || '', contentType: a.contentType || '',
          size: a.size || 0, isInline: /inline/i.test(a.contentDisposition || '') || false,
          contentId: a.contentId || null,
        }))),
        size_bytes: msg.source.length,
        body_text: (parsed.text || '').slice(0, 1_000_000),
        body_html: parsed.html ? parsed.html.slice(0, 5_000_000) : null,
        snippet: (parsed.text || '').replace(/\s+/g, ' ').slice(0, 200),
        parsed_ok: 1, parse_error: null,
      });
    } catch (insertError) {
      // the other connection won the UNIQUE race: our file belongs to no row
      this.removeFile(relPath);
      if (!/UNIQUE/i.test((insertError as Error).message)) throw insertError;
    }
  }

  /** Best-effort removal of a message file this engine just wrote (A3 step 2). */
  private removeFile(relPath: string): void {
    try {
      fs.unlinkSync(this.store.filePath(relPath));
    } catch { /* already gone, or held by another process: the sweep retries */ }
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
        } catch {
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

  // ---------- IMAP IDLE (dedicated connection on INBOX) ----------
  // imapflow pattern (verified experimentally in scripts/diag-idle-latency.ts):
  //  - auto-IDLE engages on an OPEN, INACTIVE connection. Holding a mailbox lock
  //    suppresses it (the connection counts as active) — that is why waiting under a
  //    held lock never produced events. So: open the mailbox WITHOUT a lock, wait for
  //    events, run the incremental pass, and let the connection go inactive again.
  //  - updates arrive as 'exists' / 'expunge' / 'flags' / 'highestModseq' events.
  //  - a manual `await client.idle()` would block until IDLE is *finished* — never used here.
  async startIdle(mailboxPath = 'INBOX', onChange?: () => void): Promise<void> {
    if (this.authFailed) return;
    this.stopped = false;
    const loop = async () => {
      while (!this.stopped) {
        try {
          if (!this.idleClient || !this.idleClient.usable) {
            // Only once the main connection is logged in: a wrong password is then tried
            // once, not on both connections, and an offline server is probed by one loop
            while (!this.stopped && this.progress.connection !== 'online') {
              await new Promise(r => setTimeout(r, 500));
            }
            if (this.stopped) break;
            this.idleClient = this.newClient();
            try {
              await this.idleClient.connect();
            } catch (e) {
              // with the main connection still up only this one failed: not offline
              if (isAuthFailure(e) || !this.client?.usable) this.noteConnectFailure(e);
              throw e;
            }
            this.progress.idleConnected = true;
          }
          const client = this.idleClient;

          // event → dirty flag (coalesced)
          let dirty = false;
          const markDirty = () => { dirty = true; };
          client.on('exists', markDirty);
          client.on('expunge', markDirty);
          client.on('flags', markDirty);
          client.on('highestModseq', markDirty);

          try {
            // open the mailbox WITHOUT holding a lock → connection auto-IDLEs when inactive
            const mailbox = await client.mailboxOpen(mailboxPath, this.account.readOnly ? { readOnly: true } : {});

            // initial sync of this folder on the idle connection (if never synced)
            const uidValidity0 = String(mailbox.uidValidity);
            const folder0 = this.store.getFolderByPath(mailboxPath);
            if (!folder0 || (folder0.uid_validity && folder0.uid_validity !== uidValidity0)) {
              await this.withFolderMutex(mailboxPath, async () => {
                if (folder0?.uid_validity && folder0.uid_validity !== uidValidity0) {
                  // Task 3: safe staged swap — never wipe local data first
                  await this.resyncAfterValidityChange(client, mailboxPath, folder0.id, uidValidity0,
                    mailbox.highestModseq ? String(mailbox.highestModseq) : null);
                } else {
                  await this.fullSyncFolder(client, mailboxPath, uidValidity0,
                    mailbox.highestModseq ? String(mailbox.highestModseq) : null);
                }
              });
              onChange?.();
            }

            while (!this.stopped && client.usable) {
              // wait for an IMAP event, or 25 min safety poll (missed events, server timeout)
              if (!dirty) {
                await new Promise<void>(resolve => {
                  const poll = setInterval(() => { if (dirty) { clearInterval(poll); resolve(); } }, 100);
                  const cap = setTimeout(() => { clearInterval(poll); resolve(); }, 25 * 60 * 1000);
                  const stopCheck = setInterval(() => {
                    if (this.stopped) { clearInterval(poll); clearTimeout(cap); clearInterval(stopCheck); resolve(); }
                  }, 500);
                });
              }
              dirty = false;
              if (this.stopped || !client.usable) break;
              const mb = client.mailbox;
              if (!mb) break;
              // sync through the shared mutex so the main connection never double-syncs
              await this.withFolderMutex(mailboxPath, async () => {
                const uidValidity = String(mb.uidValidity);
                const folder = this.store.getFolderByPath(mailboxPath);
                const prevModseq = folder?.highest_modseq ? BigInt(folder.highest_modseq) : null;
                if (folder?.uid_validity && folder.uid_validity !== uidValidity) {
                  // Task 3: safe staged swap — never wipe local data first
                  await this.resyncAfterValidityChange(client, mailboxPath, folder.id, uidValidity,
                    mb.highestModseq ? String(mb.highestModseq) : null);
                } else if (!folder || !prevModseq) {
                  await this.fullSyncFolder(client, mailboxPath, uidValidity, mb.highestModseq ? String(mb.highestModseq) : null);
                } else {
                  await this.incrementalSyncFolder(client, mailboxPath, uidValidity, prevModseq, mb.highestModseq ? String(mb.highestModseq) : null);
                }
              });
              onChange?.();
            }
          } finally {
            client.off('exists', markDirty);
            client.off('expunge', markDirty);
            client.off('flags', markDirty);
            client.off('highestModseq', markDirty);
          }
          this.backoffMs = 1000;
          this.noteSuccess();
        } catch (e) {
          this.progress.idleConnected = false;
          this.emit({ type: 'error', path: mailboxPath, message: `idle: ${(e as Error).message}` });
          if (this.idleClient) { try { this.idleClient.close(); } catch { /* IDLE connection already dropped; nothing left to release */ } this.idleClient = null; }
          if (this.authFailed) break;
          this.noteDisconnect();
          this.noteError('idle');
          // circuit breaker open → idle in cooldown before reconnecting
          const waitMs = Math.max(this.backoffMs, this.circuitOpenUntil - Date.now());
          if (waitMs > 0) await new Promise(r => setTimeout(r, Math.min(waitMs, 120_000)));
          this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
        }
      }
    };
    void loop();
  }

  // ---------- STATUS polling + tiered flag refresh (Task 3) ----------
  // IDLE only watches INBOX (one connection per folder doesn't scale to 264 folders).
  // Without CONDSTORE there is no changedSince for flags either, so a flag refresh is
  // a full FETCH 1:* FLAGS per folder — fine for 100-message folders, wasteful for a
  // 17k-message one. Tiers (TASK3.md):
  //   tier 1: INBOX + currently open folder — every poll (IDLE covers INBOX anyway)
  //   tier 2: recently active (last flag sweep < 24 h ago OR local rows exist and the
  //           folder had any change detected) — every 12th poll
  //   tier 3: everything else — every 72nd poll
  // Count/uidNext mismatches from the STATUS comparison trigger a folder sync
  // regardless of tier (that's how new mail and deletions propagate).
  private pollingStop = false;
  private pollCount = 0;

  /**
   * H1: one poll pass. Extracted from the loop so a test can run exactly one pass, and
   * so the "we reached the server" bookkeeping lives in one place.
   *
   * Returns false when nothing was attempted (a sync is already running).
   */
  async pollOnce(): Promise<boolean> {
    if (this.pollingStop || this.syncing) return false;
    const client = await this.connect();
    this.pollCount++;
    const folders = this.store.allFolders();
    for (let i = 0; i < folders.length; i++) {
      if (this.pollingStop || this.syncing) break;
      const f = folders[i];
      await this.gate();
      try {
        const st = await client.status(f.imap_path, { messages: true, uidNext: true, highestModseq: true });
        if (!st) continue;
        if (typeof st === 'boolean') continue;
        const localCount = (this.store.db.prepare('SELECT COUNT(*) c FROM messages WHERE folder_id = ?').get(f.id) as { c: number }).c;
        const changed =
          (st.messages !== undefined && st.messages !== localCount) ||
          (st.uidNext !== undefined && f.uid_next !== null && st.uidNext !== f.uid_next) ||
          (st.highestModseq !== undefined && f.highest_modseq !== null && String(st.highestModseq) !== f.highest_modseq);
        if (changed) {
          await this.syncFolder(f.imap_path);
          // Task 4 fix: syncFolder used to skip flag fetching entirely without
          // CONDSTORE — now it applies flags (incrementalSyncFolder else-branch),
          // but keep the sweep fallback ONLY when the folder sync itself errored
          // out silently (e.g. folder vanished mid-poll).
          continue;
        }
        // tiered flag sweep (only without CONDSTORE; with it, changedSince is enough).
        // Divisors measured on prod (32k msgs): sweep-all ~95 s of server time, so
        // tier-2 folders (recently active) are swept every 6th poll and cold ones
        // every 36th (~72 min) — NOT every 2nd/6th, which starved searches.
        if (!this.hasCondstore && this.syncingFolders.size === 0) {
          const tier = this.flagTier(f);
          if (tier === 1 || this.pollCount % tier === 0) {
            await this.flagSweep(client, f);
          }
        }
        if (this.account.requestDelayMs) await new Promise(r => setTimeout(r, this.account.requestDelayMs));
      } catch {
        // folder vanished / transient error — next sweep retries
      }
    }
    this.noteServerContact();
    this.noteSuccess();
    return true;
  }

  async startPolling(intervalMs = 60_000): Promise<void> {
    if (this.authFailed) return;
    this.pollingStop = false;
    const loop = async () => {
      while (!this.pollingStop) {
        this.nextPollAt = Date.now() + intervalMs;
        await new Promise(r => setTimeout(r, intervalMs));
        if (this.pollingStop || this.syncing) continue;
        // a first pass that never finished (started offline, or cut off) is run again
        if (!this.lastSyncAt) {
          await this.syncAll();
          continue;
        }
        try {
          await this.pollOnce();
        } catch (e) {
          if (this.authFailed) break;
          this.emit({ type: 'error', path: null, message: `poll: ${(e as Error).message}` });
          this.noteError('poll');
        }
      }
      this.nextPollAt = null;
    };
    void loop();
  }

  /** Task 3: poll-interval divisor per flag-sweep tier.
   *  tier 1 = every poll  (INBOX — IDLE covers it later; sweep is the fallback)
   *  tier 2 = every 6th poll (~12 min) — folders swept within the last 24 h
   *  tier 3 = every 36th poll (~72 min) — cold folders */
  private flagTier(f: { last_flag_sweep: string | null; imap_path: string }): number {
    if (f.imap_path === 'INBOX') return 1;
    if (!f.last_flag_sweep) return 1;    // never swept → sweep now (initial pass fills tiers)
    const ageH = (Date.now() - new Date(f.last_flag_sweep).getTime()) / 3_600_000;
    if (ageH < 24) return 6;             // recently active: every 6th poll
    return 36;                           // cold: every 36th poll
  }

  /** Full FLAGS fetch for one folder (no MODSEQ available) — updates local rows. */
  private async flagSweep(client: ImapFlow, f: { id: string; imap_path: string }): Promise<number> {
    let changes = 0;
    const localRows = this.store.db.prepare('SELECT id, uid, message_key, flags_json FROM messages WHERE folder_id = ?')
      .all(f.id) as { id: number; uid: number; message_key: string; flags_json: string }[];
    const localByUid = new Map(localRows.map(r => [r.uid, r]));
    if (!localByUid.size) return 0;
    const uidList = [...localByUid.keys()].sort((a, b) => a - b);
    // collect-then-apply: one transaction per 500-UID chunk instead of one autocommit
    // per changed row (each updateMessage was a full-row UPDATE incl. body_text +
    // FTS delete/reinsert — ~75 KB row rewrite + FTS churn per flag change; during
    // a sweep that blocked the event loop and queued searches for seconds).
    let pending: { id: number; flags_json: string }[] = [];
    const flush = () => {
      if (!pending.length) return;
      this.store.db.transaction(() => {
        for (const p of pending) this.store.db.prepare('UPDATE messages SET flags_json=? WHERE id=?').run(p.flags_json, p.id);
      })();
      changes += pending.length;
      pending = [];
    };
    for (let i = 0; i < uidList.length; i += 500) {
      const range = uidRange(uidList.slice(i, i + 500));
      if (!range) continue;
      for await (const m of client.fetch(range, { uid: true, flags: true }, { uid: true })) {
        const local = localByUid.get(Number(m.uid));
        if (!local) continue;
        // Task 4 coexistence: skip messages with pending/running write ops
        if (this.store.opInFlightForMessageKey(local.message_key)) continue;
        const flags = flagsFromSet(m.flags);
        if (JSON.stringify(JSON.parse(local.flags_json)) !== JSON.stringify(flags)) {
          pending.push({ id: local.id, flags_json: JSON.stringify(flags) });
        }
      }
      flush();
      if (this.account.requestDelayMs) await new Promise(r => setTimeout(r, this.account.requestDelayMs));
    }
    flush();
    this.store.setFlagSwept(f.id, new Date().toISOString());
    this.progress.flagChanges += changes;
    return changes;
  }

  stopPolling(): void {
    this.pollingStop = true;
    this.nextPollAt = null;
  }

  stopIdle(): void {
    this.stopped = true;
  }

  async close(): Promise<void> {
    this.stopIdle();
    if (this.client) { try { this.client.close(); } catch { /* shutdown: the connection may already be gone */ } this.client = null; }
    if (this.idleClient) { try { this.idleClient.close(); } catch { /* shutdown: the IDLE connection may already be gone */ } this.idleClient = null; }
    this.progress.idleConnected = false;
  }
}

// ---------- helpers ----------
function flagsFromSet(set: Set<string> | undefined): Flags {
  const s = set || new Set<string>();
  return {
    seen: s.has('\\Seen'),
    flagged: s.has('\\Flagged'),
    draft: s.has('\\Draft'),
    deleted: s.has('\\Deleted'),
    answered: s.has('\\Answered'),
  };
}

function toIso(d: Date | string | undefined | null): string | null {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d.toISOString();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

function addrList(a: unknown): { name: string; email: string }[] {
  if (!a) return [];
  const obj = a as { value?: { name?: string; address?: string }[] };
  const arr = Array.isArray(obj)
    ? obj as unknown as { name?: string; address?: string }[]
    : (obj.value || []);
  return arr
    .map(x => ({ name: x.name || '', email: (x.address || '').toLowerCase() }))
    .filter(x => x.email || x.name);
}

function parseReferences(ref: unknown): string[] {
  if (!ref) return [];
  if (Array.isArray(ref)) return ref.map(String);
  return String(ref).split(/\s+/).filter(Boolean);
}

function computeThreadId(parsed: { messageId?: string; subject?: string }, refs: string[]): string | null {
  // thread root = first reference; else own message-id; else normalized subject
  if (refs.length) return crypto.createHash('sha1').update(refs[0]).digest('hex').slice(0, 16);
  if (parsed.messageId) return crypto.createHash('sha1').update(parsed.messageId).digest('hex').slice(0, 16);
  const norm = (parsed.subject || '').replace(/^(aw|re|fwd?|wg)\s*:\s*/gi, '').trim().toLowerCase();
  return norm ? crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16) : null;
}
