// R2: the accounts behind MailCore, out of core/index.ts: one entry per account (store, sync
// engine, write engine on a shared connection budget), opening a store with its one recovery
// attempt, the host's credentials, and which entry a call works on. MailCore keeps one-line
// delegations; tests read its `entries`, which is this same Map.
import path from 'path';
import { Store } from './store.js';
import { SyncEngine, AccountConfig, makeProductionAccount, makeSandboxAccount, makeCanaryAccount } from './sync.js';
import { WriteEngine } from './write_engine.js';
import { WriteAccount, writeEndpointReachable, isCanary, writeRefusal, assertWriteAllowed } from './write_guard.js';
import { ConnectionBudget } from './connection_budget.js';
import { isCorruptStoreError } from './store_recovery.js';
import { draftStoreValidity } from './draft_store.js';
import type { AccountInfo, AccountSummary } from './types.js';
import type { AccountEntry, Logger, MailCoreEvent, MailCoreOptions } from './index.js';

/** A7 part 2: how an account reports itself - the canary is writable but not a sandbox.
 * I6 (MR-18): the flag is on the write account; the sync config never carried it, so a canary
 * used to report itself as 'sandbox'. */
function accountMode(e: { config: { readOnly: boolean }; writeAccount: WriteAccount }): AccountInfo['mode'] {
  if (e.config.readOnly) return 'production-readonly';
  return isCanary(e.writeAccount) ? 'canary' : 'sandbox';
}

/** What the accounts need from the core. */
export interface AccountEntriesContext {
  readonly log: Logger;
  readonly clock: () => number;
  emitEvent(e: MailCoreEvent): void;
}

export class AccountEntries {
  readonly entries = new Map<string, AccountEntry>();
  activeId = '';
  private credentialCache = new Map<string, { user: string; pass: string }>();

  constructor(private readonly ctx: AccountEntriesContext) {}

  private get log(): Logger { return this.ctx.log; }
  private get clock(): () => number { return this.ctx.clock; }
  private emitEvent(e: MailCoreEvent): void { this.ctx.emitEvent(e); }

  /** One entry per account; an account whose store cannot be opened is skipped. */
  buildEntries(options: MailCoreOptions): void {
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
      // production pacing with the write path enabled. I6 (MR-20): an account the guard
      // refuses is read-only with the production pacing, whatever kind it was saved as -
      // a sandbox-kind account on a real host without the flag used to sync read-write
      // with no connection cap, and journal ops that waited for a flag set later.
      const config: AccountConfig = writeRefusal(writeAccount) !== null
        ? makeProductionAccount(input)
        : isCanary(a)
          ? makeCanaryAccount(input)
          : makeSandboxAccount(input);
      // user/pass are resolved lazily via ensureCredentials(), which the engine calls before
      // every login — never stored at construction, never logged
      // I12 (MR-41): one account whose store cannot be opened is skipped, not fatal for the rest.
      let store: Store;
      try {
        store = this.openAccountStore(dir, a.id);
      } catch (err) {
        this.log.warn?.(`mail account ${a.id} could not be opened and is skipped: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      // I15a (MR-19): sync, IDLE and write connections share one cap per account
      const budget = new ConnectionBudget(config.maxConnections ?? 4);
      const engine = new SyncEngine(config, store, {
        forceNoCondstore: options.forceNoCondstore,
        faultWriteCode: options.faultWriteCode,
        log: this.log,
        budget,
        credentials: () => this.ensureCredentials(a.id),
      });
      const writes = new WriteEngine(store, a.id, {
        writeAccount,
        budget,
        /** A7: credentials come from the host, lazily, and never from the guard */
        credentials: () => this.ensureCredentials(a.id),
        sinkProbe: options.sinkProbe,
        clock: () => new Date(this.clock()),
        log: this.log,
      });
      writes.attachEngine({
        withFolderMutex: (p, fn) => engine.withFolderMutexPublic(p, fn),
        triggerResync: p => void engine.syncFolder(p).catch(() => { }),
        // G5: a saved draft gets its local row immediately, instead of appearing only after
        // the Drafts folder is resynced and re-downloads the message just uploaded
        storeAppendedDraft: (folderPath, uidValidity, uid, source, flags) => {
          const folder = store.getFolderByPath(folderPath)
          if (!folder) return Promise.resolve()
          // G6: the stored key must match the one the next sync computes, or the sync inserts
          // a SECOND row for the same draft (message_key is UNIQUE, but the keys would differ).
          const validity = draftStoreValidity(uidValidity, folder.uid_validity)
          if (!validity) return Promise.resolve()
          return engine.storeAppendedDraft(folder.id, validity, uid, source, flags)
        },
      });
      // A6: a watchdog that could not stop an op stops the whole queue and asks for a
      // restart. The journal makes that restart safe; nothing is force-released.
      writes.onQueueStopped = message => this.emitEvent({
        type: 'op-event', accountId: a.id, opId: '', kind: 'queue', outcome: 'stopped', reason: message,
      });
      this.entries.set(a.id, { options: a, config, writeAccount, store, engine, writes });
      // forward sync events to subscribers (Task 5: events are the core's only
      // progress channel — no console writes inside the core)
      // MR-28: a finished folder carries its special-use, so main finds Sent by `\Sent`, not by name
      engine.onSyncEvent = ev => this.emitEvent({
        type: 'sync-event', accountId: a.id,
        event: ev.type === 'folder-done' ? { ...ev, specialUse: store.getFolderByPath(ev.path)?.special_use ?? null } : ev,
      });
      // the rejected password must not stay around; the engine has stopped for good anyway
      engine.onAuthFailed = () => this.credentialCache.delete(a.id);
    }
  }

  /**
   * Open one account's store. G9: mail stored before contacts existed never taught the contacts
   * table who you correspond with, so one pass over the existing rows runs once, marked in kv.
   * I12 (MR-26/41): that pass reads every row, so it is where a damaged page usually shows up;
   * the store has marked itself by then, and reopening it once checks and, if needed, rebuilds.
   * A failed backfill is never fatal: contacts are a convenience.
   */
  private openAccountStore(dir: string, id: string): Store {
    let store = new Store(dir, id, this.clock, this.log);
    try {
      store.backfillContactsOnce();
      return store;
    } catch (err) {
      if (!isCorruptStoreError(err)) {
        this.log.warn?.(`mail account ${id}: contacts backfill failed: ${err instanceof Error ? err.message : String(err)}`);
        return store;
      }
    }
    try { store.close(); } catch { /* a corrupt handle may refuse the checkpoint; the reopen checks the file */ }
    store = new Store(dir, id, this.clock, this.log);
    try {
      store.backfillContactsOnce();
    } catch (err) {
      this.log.warn?.(`mail account ${id}: contacts backfill failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return store;
  }

  /** Resolve credentials for an account through the host's provider (lazily). */
  async ensureCredentials(id: string): Promise<{ user: string; pass: string }> {
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

  async getAccount(): Promise<AccountInfo> {
    const e = this.entry();
    const reachable = e.config.readOnly ? true : await writeEndpointReachable(e.writeAccount);
    return {
      id: e.config.id,
      email: e.options.email ?? e.config.user,
      mode: accountMode(e),
      canWrite: !e.config.readOnly && reachable,
    };
  }

  async listAccounts(): Promise<AccountSummary[]> {
    const out: AccountSummary[] = [];
    for (const [id, e] of this.entries) {
      out.push({
        id,
        email: e.options.email ?? e.config.user,
        mode: accountMode(e),
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

  entry(id?: string): AccountEntry {
    const key = id ?? this.activeId;
    const e = this.entries.get(key);
    if (!e) throw new Error(`unknown account "${key}"`);
    return e;
  }

  /** Account for WRITE operations: defaults to the PRIMARY WRITABLE account, never
   * the currently selected one (Task 2 compose regression lesson). */
  writableEntry(id?: string): AccountEntry {
    const key = id ?? [...this.entries.keys()].find(k => !this.entries.get(k)!.config.readOnly);
    const e = this.entry(key);
    if (e.config.readOnly) throw new Error('WRITE GUARD: account is read-only');
    // I6 (MR-20): the guard decides before an op is journaled, not only when it connects
    assertWriteAllowed(e.writeAccount);
    return e;
  }
}
