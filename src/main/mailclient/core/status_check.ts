// #156: the STATUS round both the background poll (idle_poll.ts) and the sync button
// (SyncEngine.syncChanges) use to find the folders that changed on the server, and the one rule
// that decides "changed". Without CONDSTORE a folder sync is a fresh SELECT, a UID FETCH 1:* and a
// FETCH 1:* FLAGS; a STATUS is one short command. So a pass asks every folder for STATUS first
// and syncs only the folders whose counts moved.
//
// LIST-STATUS (RFC 5819): when the server advertises it, the whole round is ONE LIST command
// with the STATUS data inline, so no per-folder pacing is needed. Otherwise every folder gets
// its own STATUS, paced by the census pause (censusDelayMs, default 150 ms like requestDelayMs:
// a cautious value from the prototype, never measured; issue #64). imapflow falls back to its
// own unpaced per-folder STATUS when a server advertises LIST-STATUS but rejects it, and then
// sets `skipListStatusArgs` on that connection; the engine remembers that and uses the paced
// path from then on, so such a server pays the unpaced round at most once. syncAll's STATUS
// sweep (the deep check and the start pass) uses the same LIST-STATUS answer, with SIZE.
import type { ImapFlow } from 'imapflow';
import { STAGING_PREFIX, Store, type FolderRow } from './store.js';
import type { AccountConfig } from './sync.js';

/** The STATUS items a check compares. */
export interface FolderStatus {
  messages?: number;
  uidNext?: number;
  highestModseq?: bigint;
  unseen?: number;
  /** #63: octets, only where the server has STATUS=SIZE and the caller asked for it (syncAll). */
  size?: number;
}

/** One folder's answer in a round; `status` is null when the server did not answer for it. */
export interface StatusAnswer {
  folder: FolderRow;
  status: FolderStatus | null;
}

export interface StatusCheckContext {
  readonly account: AccountConfig;
  readonly store: Store;
  gate(): Promise<void>;
  syncFolder(imapPath: string, opts?: { full?: boolean }): Promise<void>;
  renamePending(imapPath: string): boolean;
  /** How many sync errors this folder has reported so far (SyncEngine.emit). */
  folderErrors(imapPath: string): number;
}

/**
 * #156: the pause after each STATUS of a census (a STATUS round over the folders): the
 * account's own censusDelayMs where set, else requestDelayMs, the pause of sweeps and downloads.
 */
export function censusPauseOf(account: Pick<AccountConfig, 'censusDelayMs' | 'requestDelayMs'>): number {
  return account.censusDelayMs ?? account.requestDelayMs ?? 0;
}

/**
 * #156: a census pause as the host got it as text (BOOKINGIUM_MAIL_CENSUS_PAUSE_MS): a whole
 * number of ms from 0 to 10000. Anything else (unset, empty, not a number, out of range) is
 * undefined, so the account default applies. The core reads no environment; the host passes it.
 */
export function parseCensusPause(value: string | undefined): number | undefined {
  const v = value?.trim();
  if (!v || !/^\d{1,5}$/.test(v)) return undefined;
  const ms = Number(v);
  return ms <= 10_000 ? ms : undefined;
}

/** The folders a round asks: every stored folder except the staging copies of a UIDVALIDITY swap. */
export function checkableFolders(store: Store): FolderRow[] {
  return store.allFolders().filter(f => !f.imap_path.startsWith(STAGING_PREFIX));
}

export class StatusCheck {
  /** Set once a server advertised LIST-STATUS but rejected it; the paced per-folder round is used from then on. */
  listStatusBroken = false;
  /** Rounds that used LIST-STATUS / per-folder STATUS (tests and diagnostics). */
  readonly rounds = { listStatus: 0, perFolder: 0 };

  constructor(private readonly ctx: StatusCheckContext) {}

  // HIGHESTMODSEQ as the poll always asked it: imapflow leaves it out where the server has no
  // CONDSTORE, and SIZE where it has no STATUS=SIZE, so neither can get the command rejected
  private query(opts: { size?: boolean } = {}) {
    return { messages: true, uidNext: true, unseen: true, highestModseq: true, ...(opts.size ? { size: true } : {}) };
  }

  private async pace(): Promise<void> {
    const ms = censusPauseOf(this.ctx.account);
    if (ms) await new Promise(r => setTimeout(r, ms));
  }

  /** One paced STATUS for one folder; null when the server did not answer. */
  async statusOf(client: ImapFlow, imapPath: string): Promise<FolderStatus | null> {
    await this.ctx.gate();
    try {
      const st = await client.status(imapPath, this.query());
      return st && typeof st === 'object' ? toStatus(st as unknown as Record<string, unknown>) : null;
    } catch {
      return null;   // folder vanished / transient error: the next round asks again
    } finally {
      await this.pace();
    }
  }

  /**
   * STATUS for every folder, in order. Yields one answer per folder; the caller syncs between
   * answers. `shouldStop` is asked before each per-folder STATUS (and each yield) and ends the round.
   */
  async *round(client: ImapFlow, folders: FolderRow[], shouldStop: () => boolean): AsyncGenerator<StatusAnswer> {
    const inline = await this.listStatus(client);
    if (!inline) this.rounds.perFolder++;
    for (const folder of folders) {
      if (shouldStop()) return;
      const known = inline?.get(folder.imap_path);
      // a folder the LIST answer left out (imapflow's INBOX fix-up, a folder created meanwhile) is asked on its own
      const status = known ?? await this.statusOf(client, folder.imap_path);
      if (shouldStop()) return;
      yield { folder, status };
    }
  }

  /**
   * The inline STATUS answers of one LIST-STATUS command, by IMAP path, or null when the server
   * cannot give them (no LIST-STATUS, or it rejected it before). `round` uses it, and so does
   * `syncAll`'s STATUS sweep (with `size`), which then asks only the folders missing from the
   * map on their own. Counts `rounds.listStatus` when it answered.
   */
  async listStatus(client: ImapFlow, opts: { size?: boolean } = {}): Promise<Map<string, FolderStatus> | null> {
    if (this.listStatusBroken || !client.capabilities?.has('LIST-STATUS')) return null;
    const connection = client as unknown as { skipListStatusArgs?: boolean };
    if (connection.skipListStatusArgs) { this.listStatusBroken = true; return null; }
    await this.ctx.gate();
    let entries: Awaited<ReturnType<ImapFlow['list']>>;
    try {
      entries = await client.list({ statusQuery: this.query(opts) });
    } catch {
      this.listStatusBroken = true;
      return null;
    }
    // imapflow answered from its own per-folder fallback: the answers are good, but the next
    // round goes the paced way
    if (connection.skipListStatusArgs) this.listStatusBroken = true;
    const map = new Map<string, FolderStatus>();
    for (const e of entries) {
      const st = e.status as (Record<string, unknown> & { error?: unknown }) | undefined;
      if (st && !st.error) map.set(e.path, toStatus(st));
    }
    this.rounds.listStatus++;
    return map;
  }

  /**
   * Did this folder change on the server since it was last synced? New or removed mail
   * (MESSAGES against the stored rows, UIDNEXT), CONDSTORE's HIGHESTMODSEQ, and read state
   * (UNSEEN). A folder never synced counts as changed. A value not known locally (NULL) never
   * counts: the first round only records it.
   */
  changed(f: FolderRow, st: FolderStatus): boolean {
    if (!f.uid_validity) return true;
    const localCount = (this.ctx.store.db.prepare('SELECT COUNT(*) c FROM messages WHERE folder_id = ?').get(f.id) as { c: number }).c;
    return (st.messages !== undefined && st.messages !== localCount) ||
      (st.uidNext !== undefined && f.uid_next !== null && st.uidNext !== f.uid_next) ||
      (st.highestModseq !== undefined && f.highest_modseq !== null && String(st.highestModseq) !== f.highest_modseq) ||
      (st.unseen !== undefined && f.unseen !== null && st.unseen !== f.unseen);
  }

  /**
   * Sync one folder and, when the sync went through, remember the UNSEEN count asked BEFORE it.
   * The earlier count is the safe one: a change during the sync then shows up as a difference
   * in the next round instead of being recorded as seen. syncFolder swallows folder errors
   * (folder_sync.ts), so success is "no error reported for this folder meanwhile".
   */
  async syncAndRemember(imapPath: string, st: FolderStatus | null, opts: { full?: boolean } = {}): Promise<void> {
    const skipped = this.ctx.renamePending(imapPath);
    const errors = this.ctx.folderErrors(imapPath);
    await this.ctx.syncFolder(imapPath, opts);
    if (skipped || st?.unseen === undefined || this.ctx.folderErrors(imapPath) !== errors) return;
    const f = this.ctx.store.getFolderByPath(imapPath);
    if (f) this.ctx.store.setFolderUnseen(f.id, st.unseen);
  }

  /** An unchanged folder whose UNSEEN is not known yet takes the server's count as its starting point. */
  rememberBaseline(f: FolderRow, st: FolderStatus): void {
    if (st.unseen !== undefined && f.unseen === null) this.ctx.store.setFolderUnseen(f.id, st.unseen);
  }
}

function toStatus(st: Record<string, unknown>): FolderStatus {
  const num = (v: unknown) => typeof v === 'number' ? v : undefined;
  const out: FolderStatus = { messages: num(st.messages), uidNext: num(st.uidNext), unseen: num(st.unseen) };
  if (typeof st.highestModseq === 'bigint') out.highestModseq = st.highestModseq;
  if (typeof st.size === 'number') out.size = st.size;
  return out;
}
