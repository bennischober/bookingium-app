// R1: the sync engine's IMAP connections, out of SyncEngine: opening a client, capability
// detection, backoff, the circuit breaker and the connection state the UI shows. The engine
// keeps one-line delegations, so its passes, IDLE and polling call these as before.
import { ImapFlow } from 'imapflow';
import { IMAP_TIMEOUTS, imapSecurityOptions, isAuthFailure } from './imap_options.js';
import type { ConnectionBudget } from './connection_budget.js';
import type { AccountConfig, SyncEvent, SyncProgress } from './sync.js';

/** What the connection needs from its engine. */
export interface SyncConnectionContext {
  readonly account: AccountConfig;
  readonly budget: ConnectionBudget;
  readonly log: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
  /** The engine's progress; a new pass replaces the object, so it is read on every use. */
  progress(): SyncProgress;
  emit(e: SyncEvent): void;
  isStopped(): boolean;
  /** A rejected login: IDLE and polling stop for good. */
  stopAfterAuthFailure(): void;
  /** Then the engine's onAuthFailed hook (the factory drops its cached credentials). */
  authFailed(): void;
  waitWhilePaused(): Promise<void>;
}

export class SyncConnection {
  client: ImapFlow | null = null;          // main connection (sync + writes)
  idleClient: ImapFlow | null = null;      // dedicated IDLE connection (INBOX)
  backoffMs = 1000;
  lastSyncAt: string | null = null;
  // A rejected login stops all server contact for good: retrying a wrong password gets the
  // account locked. Only a new engine (the host restarts the core after a save) logs in again.
  authFailed = false;
  private consecutiveErrors = 0;
  circuitOpenUntil = 0;
  private static readonly ERROR_THRESHOLD = 5;
  private static readonly CIRCUIT_COOLDOWN_MS = 60_000;
  private static readonly REPEATED_DISCONNECT_WINDOW_MS = 10 * 60_000;
  private static readonly REPEATED_DISCONNECT_LIMIT = 8;
  private disconnectTimestamps: number[] = [];
  // Task 3: server capability cache (set on first connect)
  private condstore = false;
  private idleCapable = false;

  constructor(
    private readonly ctx: SyncConnectionContext,
    // Task 3: testing hook — force the no-CONDSTORE code path even on servers that have it
    // (Task 5: injected via the factory's options.forceNoCondstore, no env reads)
    private readonly simulateNoCondstore: boolean,
  ) {}

  private get account(): AccountConfig { return this.ctx.account; }
  private get progress(): SyncProgress { return this.ctx.progress(); }
  private get log(): SyncConnectionContext['log'] { return this.ctx.log; }
  private emit(e: SyncEvent): void { this.ctx.emit(e); }

  /** A connection attempt failed: a rejected login stops the engine, anything else is offline. */
  noteConnectFailure(e: unknown): void {
    if (this.authFailed) return;
    const message = e instanceof Error ? e.message : String(e);
    if (!isAuthFailure(e)) {
      this.progress.connection = 'offline';
      this.progress.connectionError = message;
      return;
    }
    this.authFailed = true;
    this.ctx.stopAfterAuthFailure();
    this.progress.connection = 'auth-failed';
    this.progress.connectionError = message;
    this.progress.idleConnected = false;
    this.emit({ type: 'error', path: null, message: 'login rejected: no further attempts until the account is saved again' });
    try { this.ctx.authFailed(); } catch { /* the stop above stands either way */ }
  }

  private noteOnline(): void {
    this.progress.connection = 'online';
    this.progress.connectionError = null;
  }

  /**
   * Task 3: circuit breaker for the live server. Consecutive errors or repeated
   * disconnects open the circuit for a cooldown; the caller must stop and report.
   * Returns true when the circuit is open (caller should abort the pass).
   */
  noteError(context: string): boolean {
    this.consecutiveErrors++;
    if (this.consecutiveErrors >= SyncConnection.ERROR_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + SyncConnection.CIRCUIT_COOLDOWN_MS;
      this.emit({ type: 'error', path: null, message: `circuit breaker OPEN (${context}): ${this.consecutiveErrors} consecutive errors — cooling down ${SyncConnection.CIRCUIT_COOLDOWN_MS / 1000}s` });
      return true;
    }
    return false;
  }

  noteSuccess(): void {
    this.consecutiveErrors = 0;
  }

  /**
   * H1: record that the server answered. The UI shows this as "Synchronisiert HH:MM",
   * so it must move on every successful contact - not only at the end of a full
   * syncAll(). The poll runs every 2 minutes and is the thing that keeps the mailbox
   * current; while it never touched this value the label could sit hours in the past and
   * the user reasonably read it as "my mail is stale".
   */
  noteServerContact(): void {
    this.lastSyncAt = new Date().toISOString();
    this.progress.lastSyncAt = this.lastSyncAt;
  }

  noteDisconnect(): boolean {
    const now = Date.now();
    this.disconnectTimestamps = this.disconnectTimestamps.filter(t => now - t < SyncConnection.REPEATED_DISCONNECT_WINDOW_MS);
    this.disconnectTimestamps.push(now);
    if (this.disconnectTimestamps.length >= SyncConnection.REPEATED_DISCONNECT_LIMIT) {
      this.circuitOpenUntil = now + SyncConnection.CIRCUIT_COOLDOWN_MS;
      this.emit({ type: 'error', path: null, message: `circuit breaker OPEN: ${this.disconnectTimestamps.length} disconnects in ${SyncConnection.REPEATED_DISCONNECT_WINDOW_MS / 60000} min — server may be rate-limiting; stopping sync activity` });
      this.disconnectTimestamps = [];
      return true;
    }
    return false;
  }

  async gate(): Promise<void> {
    if (Date.now() < this.circuitOpenUntil) {
      const waitMs = this.circuitOpenUntil - Date.now();
      this.emit({ type: 'error', path: null, message: `circuit open: waiting ${Math.ceil(waitMs / 1000)}s before next server contact` });
      await new Promise(r => setTimeout(r, waitMs));
      this.circuitOpenUntil = 0;
      this.consecutiveErrors = 0;
      this.disconnectTimestamps = [];
    }
    await this.ctx.waitWhilePaused();
  }

  newClient(): ImapFlow {
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
  async detectCapabilities(): Promise<void> {
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

  async connect(): Promise<ImapFlow> {
    if (this.authFailed) throw new Error('login rejected earlier: not logging in again');
    await this.gate();
    if (this.authFailed) throw new Error('login rejected earlier: not logging in again');
    if (this.client && this.client.usable) return this.client;
    if (this.client) { try { this.client.close(); } catch { /* stale client is already unusable; a failed close leaves nothing to release */ } this.client = null; }
    // Task 3: hard connection cap (1 sync + 1 IDLE for prod). I15a (MR-19): the budget is shared
    // with the IDLE connection and the write engine, so all of them count.
    const release = await this.ctx.budget.acquire({ cancelled: () => this.ctx.isStopped() });
    const client = this.newClient();
    try {
      await client.connect();
    } catch (e) {
      release();
      this.noteConnectFailure(e);
      this.noteDisconnect();
      throw e;
    }
    this.noteOnline();
    client.on('close', () => {
      release();
      if (this.client === client || this.idleClient === client) this.noteDisconnect();
    });
    if (!client.usable) release();
    this.client = client;
    this.backoffMs = 1000;
    this.noteSuccess();
    return client;
  }
}
