// R1: IDLE, STATUS polling and the tiered flag sweep, out of SyncEngine. The IDLE loop holds INBOX
// open on its own connection; the poll asks every folder for STATUS and syncs what changed. The
// engine keeps one-line delegations and owns the state both read (stopped, syncing, in flight).
// Tests override engine methods (connect, newClient, fullSyncFolder, syncFolderInner), so every
// call back into the engine goes through the context.
import { ImapFlow } from 'imapflow';
import { Store } from './store.js';
import { isAuthFailure } from './imap_options.js';
import { isDiskFullError } from './disk_full.js';
import { flagsFromSet } from './message_ingest.js';
import { uidRange } from './folder_sync.js';
import type { ConnectionBudget } from './connection_budget.js';
import type { AccountConfig, SyncEvent, SyncProgress } from './sync.js';

/** What the IDLE loop needs from its engine. */
export interface IdleLoopContext {
  readonly account: AccountConfig;
  readonly store: Store;
  readonly budget: ConnectionBudget;
  /** The engine's progress; a new pass replaces the object, so it is read on every use. */
  progress(): SyncProgress;
  emit(e: SyncEvent): void;
  isStopped(): boolean;
  setStopped(stopped: boolean): void;
  isDiskFull(): boolean;
  authFailed(): boolean;
  client(): ImapFlow | null;
  idleClient(): ImapFlow | null;
  setIdleClient(client: ImapFlow | null): void;
  backoffMs(): number;
  setBackoffMs(ms: number): void;
  circuitOpenUntil(): number;
  newClient(): ImapFlow;
  noteConnectFailure(e: unknown): void;
  noteDisconnect(): boolean;
  noteError(context: string): boolean;
  noteSuccess(): void;
  noteDiskFull(path: string | null): void;
  withFolderMutex<T>(imapPath: string, fn: () => Promise<T>): Promise<T>;
  fullSyncFolder(client: ImapFlow, imapPath: string, uidValidity: string, highestModseq: string | null, uidNext?: number): Promise<void>;
  incrementalSyncFolder(client: ImapFlow, imapPath: string, uidValidity: string, changedSince: bigint, highestModseq: string | null, uidNext?: number): Promise<void>;
  resyncAfterValidityChange(client: ImapFlow, imapPath: string, folderId: string, uidValidity: string, highestModseq: string | null, uidNext?: number): Promise<void>;
}

export class IdleLoop {
  // I15a: set when the IDLE connection gave its slot to a write; the reconnect then catches up
  private idleCatchUp = false;
  private unregisterIdleYield: (() => void) | null = null;

  constructor(private readonly ctx: IdleLoopContext) {}

  private get account(): AccountConfig { return this.ctx.account; }
  private get store(): Store { return this.ctx.store; }
  private get budget(): ConnectionBudget { return this.ctx.budget; }
  private get progress(): SyncProgress { return this.ctx.progress(); }
  private get stopped(): boolean { return this.ctx.isStopped(); }
  private set stopped(stopped: boolean) { this.ctx.setStopped(stopped); }
  private get diskFull(): boolean { return this.ctx.isDiskFull(); }
  private get authFailed(): boolean { return this.ctx.authFailed(); }
  private get client(): ImapFlow | null { return this.ctx.client(); }
  private get idleClient(): ImapFlow | null { return this.ctx.idleClient(); }
  private set idleClient(client: ImapFlow | null) { this.ctx.setIdleClient(client); }
  private get backoffMs(): number { return this.ctx.backoffMs(); }
  private set backoffMs(ms: number) { this.ctx.setBackoffMs(ms); }
  private get circuitOpenUntil(): number { return this.ctx.circuitOpenUntil(); }
  private emit(e: SyncEvent): void { this.ctx.emit(e); }
  private newClient(): ImapFlow { return this.ctx.newClient(); }
  private noteConnectFailure(e: unknown): void { this.ctx.noteConnectFailure(e); }
  private noteDisconnect(): boolean { return this.ctx.noteDisconnect(); }
  private noteError(context: string): boolean { return this.ctx.noteError(context); }
  private noteSuccess(): void { this.ctx.noteSuccess(); }
  private noteDiskFull(path: string | null): void { this.ctx.noteDiskFull(path); }
  private withFolderMutex<T>(imapPath: string, fn: () => Promise<T>): Promise<T> { return this.ctx.withFolderMutex(imapPath, fn); }
  private fullSyncFolder(...a: Parameters<IdleLoopContext['fullSyncFolder']>): Promise<void> { return this.ctx.fullSyncFolder(...a); }
  private incrementalSyncFolder(...a: Parameters<IdleLoopContext['incrementalSyncFolder']>): Promise<void> { return this.ctx.incrementalSyncFolder(...a); }
  private resyncAfterValidityChange(...a: Parameters<IdleLoopContext['resyncAfterValidityChange']>): Promise<void> { return this.ctx.resyncAfterValidityChange(...a); }

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
    // I15a (MR-19): a write that finds the budget full asks for this slot. The IDLE connection
    // closes at once (its loop sees it unusable) and comes back once the write connection idles
    // out; the reconnect then syncs whatever arrived in between.
    this.unregisterIdleYield?.();
    this.unregisterIdleYield = this.budget.onYieldRequest(() => this.dropConnection());
    const loop = async () => {
      while (!this.stopped) {
        // I4: a full disk stops IDLE's syncs too; wait for resume() instead of reconnecting
        if (this.diskFull) { await new Promise(r => setTimeout(r, 1000)); continue; }
        try {
          if (!this.idleClient || !this.idleClient.usable) {
            // Only once the main connection is logged in: a wrong password is then tried
            // once, not on both connections, and an offline server is probed by one loop
            while (!this.stopped && this.progress.connection !== 'online') {
              await new Promise(r => setTimeout(r, 500));
            }
            if (this.stopped) break;
            // I15a (sync L2): the IDLE connection used to be opened outside the cap
            const release = await this.budget.acquire({ cancelled: () => this.stopped });
            const idle = this.newClient();
            idle.once('close', release);
            this.idleClient = idle;
            try {
              await idle.connect();
            } catch (e) {
              release();
              // a write took the slot back while this one was still logging in: not a failure
              if (this.idleClient !== idle) continue;
              // with the main connection still up only this one failed: not offline
              if (isAuthFailure(e) || !this.client?.usable) this.noteConnectFailure(e);
              throw e;
            }
            if (this.idleClient !== idle) continue;
            this.progress.idleConnected = true;
          }
          const client = this.idleClient;

          // event → dirty flag (coalesced). I15a: after giving the slot to a write, start dirty
          // so the changes made while this connection was away are synced now
          let dirty = this.idleCatchUp;
          this.idleCatchUp = false;
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
                    mailbox.highestModseq ? String(mailbox.highestModseq) : null, mailbox.uidNext);
                } else {
                  await this.fullSyncFolder(client, mailboxPath, uidValidity0,
                    mailbox.highestModseq ? String(mailbox.highestModseq) : null, mailbox.uidNext);
                }
              });
              onChange?.();
            }

            while (!this.stopped && client.usable) {
              // wait for an IMAP event, or 25 min safety poll (missed events, server timeout)
              if (!dirty) await idleWait(() => dirty || this.stopped || !client.usable);
              dirty = false;
              if (this.stopped || !client.usable || this.diskFull) break;
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
                    mb.highestModseq ? String(mb.highestModseq) : null, mb.uidNext);
                } else if (!folder || !prevModseq) {
                  await this.fullSyncFolder(client, mailboxPath, uidValidity, mb.highestModseq ? String(mb.highestModseq) : null, mb.uidNext);
                } else {
                  await this.incrementalSyncFolder(client, mailboxPath, uidValidity, prevModseq, mb.highestModseq ? String(mb.highestModseq) : null, mb.uidNext);
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
          // I4: the connection is fine, the drive is not - no disconnect, no backoff, no circuit
          if (isDiskFullError(e)) { this.noteDiskFull(mailboxPath); continue; }
          this.progress.idleConnected = false;
          // I15a: stopped while waiting for a slot, or the slot given to a write mid-sync: no error
          if (this.stopped) break;
          if (this.idleCatchUp && !this.idleClient) continue;
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

  /**
   * Close the IDLE connection now; the loop reconnects (once the main connection is online, within
   * the budget and its backoff) and starts dirty, so whatever arrived meanwhile is synced. Used when
   * a write needs the slot (I15a), and after the machine woke from sleep: the socket may have died
   * without either side noticing, and IDLE would wait on it until the 25-minute cap.
   *
   * Cleared before it is closed, so the close counts as no disconnect and the loop's error path
   * takes it for what it is.
   */
  dropConnection(): void {
    const idle = this.idleClient;
    if (!idle) return;
    this.idleClient = null;
    this.idleCatchUp = true;
    this.progress.idleConnected = false;
    try { idle.close(); } catch { /* already closed: its slot is released on 'close' */ }
  }

  stopIdle(): void {
    this.stopped = true;
    this.unregisterIdleYield?.();
    this.unregisterIdleYield = null;
  }
}

/** What the poll needs from its engine. */
export interface PollerContext {
  readonly account: AccountConfig;
  readonly store: Store;
  /** The engine's progress; a new pass replaces the object, so it is read on every use. */
  progress(): SyncProgress;
  emit(e: SyncEvent): void;
  isSyncing(): boolean;
  isDiskFull(): boolean;
  authFailed(): boolean;
  hasCondstore(): boolean;
  lastSyncAt(): string | null;
  inFlight(): number;
  setInFlight(n: number): void;
  syncingFolders(): Map<string, symbol>;
  connect(): Promise<ImapFlow>;
  gate(): Promise<void>;
  noteError(context: string): boolean;
  noteSuccess(): void;
  noteServerContact(): void;
  noteDiskFull(path: string | null): void;
  syncFolder(imapPath: string): Promise<void>;
  syncAll(): Promise<SyncProgress>;
  withSelected<T>(imapPath: string, expectedValidity: string | null, fn: (client: ImapFlow) => Promise<T>): Promise<T | null>;
}

export class Poller {
  nextPollAt: number | null = null;

  constructor(private readonly ctx: PollerContext) {}

  private get account(): AccountConfig { return this.ctx.account; }
  private get store(): Store { return this.ctx.store; }
  private get progress(): SyncProgress { return this.ctx.progress(); }
  private get syncing(): boolean { return this.ctx.isSyncing(); }
  private get diskFull(): boolean { return this.ctx.isDiskFull(); }
  private get authFailed(): boolean { return this.ctx.authFailed(); }
  private get hasCondstore(): boolean { return this.ctx.hasCondstore(); }
  private get lastSyncAt(): string | null { return this.ctx.lastSyncAt(); }
  private get inFlight(): number { return this.ctx.inFlight(); }
  private set inFlight(n: number) { this.ctx.setInFlight(n); }
  private get syncingFolders(): Map<string, symbol> { return this.ctx.syncingFolders(); }
  private emit(e: SyncEvent): void { this.ctx.emit(e); }
  private connect(): Promise<ImapFlow> { return this.ctx.connect(); }
  private gate(): Promise<void> { return this.ctx.gate(); }
  private noteError(context: string): boolean { return this.ctx.noteError(context); }
  private noteSuccess(): void { this.ctx.noteSuccess(); }
  private noteServerContact(): void { this.ctx.noteServerContact(); }
  private noteDiskFull(path: string | null): void { this.ctx.noteDiskFull(path); }
  private syncFolder(imapPath: string): Promise<void> { return this.ctx.syncFolder(imapPath); }
  private syncAll(): Promise<SyncProgress> { return this.ctx.syncAll(); }
  private withSelected<T>(imapPath: string, expectedValidity: string | null, fn: (client: ImapFlow) => Promise<T>): Promise<T | null> {
    return this.ctx.withSelected(imapPath, expectedValidity, fn);
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
  pollingStop = false;
  private pollCount = 0;

  /**
   * H1: one poll pass. Extracted from the loop so a test can run exactly one pass, and
   * so the "we reached the server" bookkeeping lives in one place.
   *
   * Returns false when nothing was attempted (a sync is already running, or the disk is full).
   *
   * I4 (L3): only a pass in which the server answered for at least one folder counts as
   * contact. A pass in which every STATUS failed used to move "Synchronisiert HH:MM" anyway
   * and reset the circuit breaker, so a server refusing every folder looked current.
   */
  async pollOnce(): Promise<boolean> {
    if (this.pollingStop || this.syncing || this.diskFull) return false;
    // I17 (test gap): a poll writes flags and folder state outside any mutex; close() waits for it
    this.inFlight++;
    try {
      return await this.pollPass();
    } finally {
      this.inFlight--;
    }
  }

  private async pollPass(): Promise<boolean> {
    const client = await this.connect();
    this.pollCount++;
    const folders = this.store.allFolders();
    let answered = 0;
    for (let i = 0; i < folders.length; i++) {
      if (this.pollingStop || this.syncing || this.diskFull) break;
      const f = folders[i];
      await this.gate();
      try {
        const st = await client.status(f.imap_path, { messages: true, uidNext: true, highestModseq: true });
        if (!st) continue;
        if (typeof st === 'boolean') continue;
        answered++;
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
            await this.flagSweep(f);
          }
        }
        if (this.account.requestDelayMs) await new Promise(r => setTimeout(r, this.account.requestDelayMs));
      } catch (e) {
        // I4: a full disk stops the poll (and everything else) until resume()
        if (isDiskFullError(e)) { this.noteDiskFull(f.imap_path); break; }
        // folder vanished / transient error — next sweep retries
      }
    }
    if (this.diskFull) return true;
    if (folders.length > 0 && answered === 0) {
      this.emit({ type: 'error', path: null, message: `poll: no folder answered (${folders.length} tried)` });
      this.noteError('poll');
      return true;
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

  /**
   * Full FLAGS fetch for one folder (no MODSEQ available) — updates local rows.
   * I4 (MR-09): the FETCH runs inside `withSelected`, i.e. on THIS folder. It used to go
   * to whichever folder the sync connection had selected last, and with two folders
   * sharing UIDs that copied one folder's flags onto the other's messages.
   */
  private async flagSweep(f: { id: string; imap_path: string; uid_validity: string | null }): Promise<number> {
    return (await this.withSelected(f.imap_path, f.uid_validity, client => this.flagSweepSelected(client, f))) ?? 0;
  }

  private async flagSweepSelected(client: ImapFlow, f: { id: string; imap_path: string }): Promise<number> {
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
}

/** IDLE's longest wait without an event: a safety poll for missed events and server timeouts */
export const IDLE_CAP_MS = 25 * 60 * 1000;

/**
 * I15a (MR-39): wait until `wake()` turns true or the cap runs out. One check interval and one
 * cap timer, both cleared on either path; a dirty wakeup used to leave the 500 ms stop check and
 * the 25 min cap running, so a day of IDLE events piled up hundreds of timers in the worker.
 */
export function idleWait(wake: () => boolean, capMs = IDLE_CAP_MS): Promise<void> {
  return new Promise<void>(resolve => {
    const check = setInterval(() => { if (wake()) done(); }, 100);
    const cap = setTimeout(done, capMs);
    function done() { clearInterval(check); clearTimeout(cap); resolve(); }
  });
}
