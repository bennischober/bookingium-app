// Task 4: write engine — executes journaled operations against the SANDBOX only.
// Design: docs/WRITE_PATH.md. Rules enforced here (see docs/LESSONS.md):
//  - journal-first: callers enqueue BEFORE calling execute; the journal row exists
//    before any server contact and survives crashes (WAL).
//  - fresh SELECT of the exact folder per operation (never a cached mailbox view —
//    Task 3's stale-view bug class would act on the SERVER here).
//  - UIDVALIDITY re-check in the same session; mismatch ⇒ conflict + resync.
//  - UID-only addressing; cheap identity check (size + INTERNALDATE) before acting.
//  - UID EXPUNGE only, from Trash only, never a blanket EXPUNGE.
//  - MOVE when advertised, else COPY(+mapping)+flag+UID EXPUNGE with duplicate-safe
//    resume (mapping recorded before touching the source).
//  - send is a state machine with stored MIME bytes; ambiguous SMTP outcome ⇒
//    'unknown' + probe by Message-ID; never an automatic resend.
//  - per-account single writer: playback serialized; folder-level mutual exclusion
//    with the sync engine via engine.withFolderMutex.
import { ImapFlow } from 'imapflow';
import fs from 'fs';
import path from 'path';
import { Store, JournalRow } from './store.js';
import { assertSandboxHost, getSandboxConfig } from './write_guard.js';
import nodemailer from 'nodemailer';

export type OpResult =
  | { outcome: 'done'; detail?: string }
  | { outcome: 'conflict'; reason: string }
  | { outcome: 'failed'; reason: string }        // transient — retried by the replay loop
  | { outcome: 'unknown'; reason: string }       // send: outcome ambiguous — needs probe/user
  | { outcome: 'noop'; reason: string };         // op is moot (e.g. flag already set)


export class WriteEngine {
  // serialized playback: one operation at a time per account
  private chain: Promise<unknown> = Promise.resolve();
  // ops queued or running, by id: the startup replay must not run an op a second
  // time while the call that enqueued it still waits for a folder
  private inFlight = new Map<string, Promise<OpResult>>();
  private engineHooks: { withFolderMutex: (path: string, fn: () => Promise<void>) => Promise<void>; triggerResync: (path: string) => void } | null = null;
  // Task 5: the sandbox sink probe (Mailpit in this prototype) is injected so the core
  // carries no hard-coded test-environment URLs. Optional — without it, unknown sends
  // fall back to the Sent-folder probe only (always safe, just less conclusive).
  private sinkProbe: ((messageId: string) => Promise<boolean>) | null = null;

  constructor(private store: Store, private accountId: string, options?: {
    /** probe a message sink (e.g. Mailpit API) for a Message-ID; true = definitely delivered */
    sinkProbe?: (messageId: string) => Promise<boolean>;
    /** injectable clock (task 5 Step 3 makes timing-dependent tests deterministic) */
    clock?: () => Date;
  }) {
    this.sinkProbe = options?.sinkProbe ?? null;
    this.clock = options?.clock ?? (() => new Date());
  }
  private clock: () => Date;

  /** Wired by index.ts: lets the write path share the sync engine's folder mutexes
   *  and request a folder resync after conflicts. */
  attachEngine(hooks: WriteEngine['engineHooks']): void {
    this.engineHooks = hooks;
  }

  /** Serialized execution: journal replay never interleaves. */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);   // run regardless of previous failure
    this.chain = next.catch(() => { });
    return next as Promise<T>;
  }

  /** index.ts hook: ask the sync engine to resync a folder after a conflict. */
  requestResync(folderPath: string): void {
    this.engineHooks?.triggerResync(folderPath);
  }

  /** index.ts hook: run fn under the sync engine's folder mutex (single-writer rule). */
  runUnderFolderMutex<T>(folderPath: string, fn: () => Promise<T>): Promise<T> {
    if (this.engineHooks) return this.engineHooks.withFolderMutex(folderPath, fn as () => Promise<void>) as Promise<T>;
    return fn();
  }

  private sandboxClient(): Promise<ImapFlow> {
    const cfg = getSandboxConfig();
    assertSandboxHost(cfg.imapHost);        // hard guard, again, at call time
    const client = new ImapFlow({
      host: cfg.imapHost, port: cfg.imapPort, secure: false,
      auth: { user: cfg.user, pass: cfg.pass },
      logger: false, emitLogs: false,
      connectionTimeout: 15_000, greetingTimeout: 15_000,
    });
    return client.connect().then(() => client);
  }

  /** Execute one journaled op (or resume a 'running' one after a crash). */
  async execute(op: JournalRow): Promise<OpResult> {
    const queued = this.inFlight.get(op.id);
    if (queued) return queued;
    const result = this.enqueue(async () => {
      // single-writer rule (docs/WRITE_PATH.md §6): hold the sync engine's folder
      // mutex for the source folder during the whole op; move ops also lock the target
      const folders = [op.folder_path, op.target_folder_path].filter((p): p is string => !!p);
      const run = () => this.executeOne(op);
      if (!folders.length) return run();
      return await this.runUnderFolderMutex(folders[0], async () => {
        if (folders.length > 1) return await this.runUnderFolderMutex(folders[1], run);
        return run();
      });
    });
    this.inFlight.set(op.id, result);
    void result.catch(() => { }).finally(() => this.inFlight.delete(op.id));
    return result;
  }

  private async executeOne(op: JournalRow): Promise<OpResult> {
    switch (op.kind) {
      case 'flag': return this.doFlag(op);
      case 'move':
      case 'delete': return this.doMoveLike(op);   // archive = move to the Archive folder (same checks)
      case 'expunge': return this.doExpunge(op);
      case 'send': return this.doSend(op);
      case 'draft_save': return this.doDraftSave(op);
      case 'draft_delete': return this.doMoveLike(op); // draft deletion = move to Trash, same checks
      default: return { outcome: 'conflict', reason: `unknown op kind ${String(op.kind)}` };
    }
  }

  /** Shared pre-flight: fresh SELECT + UIDVALIDITY + existence + cheap identity.
   *  Returns the open client + mailbox on success; the caller MUST logout. */
  private async preflight(op: JournalRow, client: ImapFlow, targetPath?: string): Promise<
    { ok: true; mailbox: { uidValidity: bigint; } } | { ok: false; result: OpResult }> {
    const folderPath = targetPath ?? op.folder_path;
    if (!folderPath || op.uid == null) return { ok: false, result: { outcome: 'conflict', reason: 'op has no folder/uid' } };
    // fresh SELECT — never trust a cached selection (RFC 2180 practice; Task 3 bug)
    let mb;
    try {
      mb = await client.mailboxOpen(folderPath);
    } catch (e) {
      return { ok: false, result: { outcome: 'conflict', reason: `folder gone: ${(e as Error).message.slice(0, 80)}` } };
    }
    // UIDVALIDITY must equal what the op was created against
    if (op.folder_uidvalidity && String(mb.uidValidity) !== op.folder_uidvalidity) {
      return { ok: false, result: { outcome: 'conflict', reason: `UIDVALIDITY changed (op ${op.folder_uidvalidity} vs server ${mb.uidValidity})` } };
    }
    // target must exist in the server's current view + cheap identity check
    // (imapflow fetch is an AsyncGenerator, not a Promise — do NOT await it directly)
    const fetched = client.fetch(String(op.uid), { uid: true, flags: true, size: true, internalDate: true }, { uid: true });
    let found = false;
    let mismatch = false;
    for await (const m of fetched) {
      found = true;
      const local = this.localRowFor(op);
      if (local) {
        if (local.size_bytes != null && m.size != null && Number(local.size_bytes) !== Number(m.size)) mismatch = true;
        if (local.internal_date && m.internalDate) {
          const a = new Date(local.internal_date).getTime();
          const b = new Date(m.internalDate).getTime();
          if (Math.abs(a - b) > 2000) mismatch = true;   // 2 s tolerance for server rounding
        }
      }
    }
    if (!found) return { ok: false, result: { outcome: 'conflict', reason: 'target vanished (uid not in server view)' } };
    if (mismatch) return { ok: false, result: { outcome: 'conflict', reason: 'identity mismatch (same uid, different message?)' } };
    return { ok: true, mailbox: { uidValidity: mb.uidValidity } };
  }

  private localRowFor(op: JournalRow): { size_bytes: number | null; internal_date: string | null } | null {
    if (!op.message_key) return null;
    const row = this.store.db.prepare('SELECT size_bytes, internal_date FROM messages WHERE message_key = ?')
      .get(op.message_key) as { size_bytes: number; internal_date: string } | undefined;
    return row ?? null;
  }

  private static isConflict(r: OpResult): r is { outcome: 'conflict'; reason: string } {
    return r.outcome === 'conflict';
  }

  // ----- flag -----------------------------------------------------------------
  private async doFlag(op: JournalRow): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as { add: string[]; remove: string[] };
    const client = await this.sandboxClient();
    try {
      const pf = await this.preflight(op, client);
      if (!pf.ok) return pf.result;
      // per-delta STORE with ±FLAGS.SILENT (RFC 4549 §4.2.3 — never the full FLAGS form)
      if (payload.add?.length) {
        await client.messageFlagsAdd(String(op.uid), payload.add, { uid: true });
      }
      if (payload.remove?.length) {
        await client.messageFlagsRemove(String(op.uid), payload.remove, { uid: true });
      }
      // apply locally (authoritative now: server acked)
      this.applyFlagLocally(op, payload);
      return { outcome: 'done' };
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) };
    } finally {
      await client.logout().catch(() => { });
    }
  }

  private applyFlagLocally(op: JournalRow, payload: { add: string[]; remove: string[] }): void {
    if (!op.message_key) return;
    const row = this.store.db.prepare('SELECT id, flags_json FROM messages WHERE message_key = ?')
      .get(op.message_key) as { id: number; flags_json: string } | undefined;
    if (!row) return;
    // flags_json is a JSON OBJECT {"seen":bool,...} (store convention), not an array
    const flags = JSON.parse(row.flags_json) as Record<string, boolean>;
    for (const f of payload.add || []) flags[f.replace('\\', '').toLowerCase()] = true;
    for (const f of payload.remove || []) flags[f.replace('\\', '').toLowerCase()] = false;
    this.store.updateMessageFlags(row.id, JSON.stringify(flags));
  }

  // ----- move / delete / archive ----------------------------------------------
  private async doMoveLike(op: JournalRow): Promise<OpResult> {
    const target = op.kind === 'delete' ? (op.target_folder_path || 'Trash') : op.target_folder_path;
    if (!target) return { outcome: 'conflict', reason: 'move without target folder' };
    const client = await this.sandboxClient();
    try {
      const pf = await this.preflight(op, client);
      if (!pf.ok) {
        // "target vanished" for a move the sync engine already applied (e.g. MOVE by
        // this op completed but crashed before the journal update) → check destination
        if (WriteEngine.isConflict(pf.result) && /vanished/.test(pf.result.reason) && op.message_id) {
          const resumed = await this.resumeHalfMoved(op, client, target);
          if (resumed) return { outcome: 'done', detail: 'resumed after crash (found at destination)' };
        }
        return pf.result;
      }
      const payload = JSON.parse(op.payload || '{}') as { copiedTo?: { uid: number } };
      // duplicate-safe resume: a previous attempt already copied to the target
      if (payload.copiedTo?.uid) {
        const existsAtTarget = client.fetch(String(payload.copiedTo.uid), { uid: true }, { uid: true });
        let found = false;
        for await (const _ of existsAtTarget) { found = true; break; }
        if (found) {
          // copy already happened; finish by deleting the source (see fallback step 3)
          return await this.finishMovedSource(op, client, payload.copiedTo.uid);
        }
      }
      // map Trash folder name: prefer the special-use Trash folder's real path
      let targetPath = target;
      if (op.kind === 'delete') {
        const trash = this.store.allFolders().find(f => f.special_use?.includes('Trash'));
        if (trash) targetPath = trash.imap_path;
      }
      const caps = [...(client as unknown as { capabilities: Set<string> }).capabilities].map(c => (Array.isArray(c) ? c[0] : c));
      const hasMove = caps.includes('MOVE');
      if (hasMove) {
        const result = await client.messageMove(String(op.uid), targetPath, { uid: true });
        if (!result) return { outcome: 'failed', reason: 'MOVE returned false' };
        const destUid = result.uidMap?.get(Number(op.uid));
        this.applyMoveLocally(op, targetPath, destUid);
        return { outcome: 'done' };
      }
      // COPY fallback (crash-safe: record mapping before touching the source)
      const copyResult = await client.messageCopy(String(op.uid), targetPath, { uid: true });
      if (!copyResult) return { outcome: 'failed', reason: 'COPY returned false' };
      const destUid = copyResult.uidMap?.get(Number(op.uid)) ?? null;
      if (destUid) {
        // durable mapping BEFORE deleting anything
        this.store.journalUpdate(op.id, { payload: { ...payload, copiedTo: { uid: destUid } } });
        return await this.finishMovedSource(op, client, destUid);
      }
      return { outcome: 'failed', reason: 'copy returned no destination uid (COPYUID missing)' };
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) };
    } finally {
      await client.logout().catch(() => { });
    }
  }

  /** Crash between copy and delete: is our message-id already at the destination? */
  private async resumeHalfMoved(op: JournalRow, client: ImapFlow, targetPath: string): Promise<boolean> {
    if (!op.message_id) return false;
    try {
      await client.mailboxOpen(targetPath);
      const found = await client.search({ header: { 'message-id': op.message_id } }, { uid: true });
      if (found && found.length) {
        this.applyMoveLocally(op, targetPath, found[0]);
        return true;
      }
    } catch { /* folder really gone — keep conflict */ }
    return false;
  }

  /** Fallback step 3+4: source still exists, copy is done → flag + UID EXPUNGE. */
  private async finishMovedSource(op: JournalRow, client: ImapFlow, destUid: number): Promise<OpResult> {
    const targetPath = op.kind === 'delete' ? (this.store.allFolders().find(f => f.special_use?.includes('Trash'))?.imap_path ?? 'Trash') : (op.target_folder_path || '');
    // messageDelete flags \Deleted and issues UID EXPUNGE (UIDPLUS-gated by imapflow)
    await client.messageDelete(String(op.uid), { uid: true });
    this.applyMoveLocally(op, targetPath, destUid);
    return { outcome: 'done', detail: 'fallback move (copy+delete)' };
  }

  private applyMoveLocally(op: JournalRow, targetPath: string, destUid: number | null | undefined): void {
    if (!op.message_key) return;
    const srcFolder = op.folder_path ? this.store.getFolderByPath(op.folder_path) : null;
    const dstFolder = this.store.getFolderByPath(targetPath);
    const row = srcFolder ? this.store.db.prepare('SELECT * FROM messages WHERE message_key = ?').get(op.message_key) as Record<string, unknown> | undefined : undefined;
    if (!row || !srcFolder || !dstFolder) return;
    const newValidity = dstFolder.uid_validity ?? '';
    const newUid = destUid ?? null;
    if (newUid == null) return;
    const newKey = this.store.messageKey(this.accountId, dstFolder.id, newValidity, newUid);
    // file name = message_key is a store invariant (consistency suite, orphan sweep and
    // repair tooling all rely on it). A move must therefore RENAME the file — the
    // original version only updated the row, leaving files named with the old key
    // (found 2026-10-23: consistency suite flagged 2 orphans-by-key after moves).
    const oldPath = path.join(this.store.dataDirResolved, String(row.file_path));
    const newPath = path.join(this.store.dataDirResolved, `${newKey}.eml`);
    try {
      fs.renameSync(oldPath, newPath);
    } catch {
      return; // keep the row as-is rather than half-updated; the orphan sweep will flag the file
    }
    // move the file reference + row to the destination folder
    this.store.db.prepare(`UPDATE messages SET folder_id=@fid, uid=@uid, message_key=@mk, file_path=@fp WHERE id=@id`)
      .run({ fid: dstFolder.id, uid: newUid, mk: newKey, fp: `${newKey}.eml`, id: row.id as number });
    // the op's message_key names the source now; undo finds the row by the new key
    // (re-read: the COPY path stored copiedTo after this op row was loaded)
    const payload = JSON.parse(this.store.journalGet(op.id)?.payload || '{}') as Record<string, unknown>;
    this.store.journalUpdate(op.id, { payload: { ...payload, movedTo: { uid: newUid, messageKey: newKey } } });
  }

  // ----- expunge (permanent deletion from Trash) -------------------------------
  private async doExpunge(op: JournalRow): Promise<OpResult> {
    // hard rule: permanent deletion only from Trash
    const trash = this.store.allFolders().find(f => f.special_use?.includes('Trash'));
    if (!trash || op.folder_path !== trash.imap_path) {
      return { outcome: 'conflict', reason: 'expunge refused: not in Trash' };
    }
    const client = await this.sandboxClient();
    try {
      const pf = await this.preflight(op, client);
      if (!pf.ok) return pf.result;
      const caps = [...(client as unknown as { capabilities: Set<string> }).capabilities].map(c => (Array.isArray(c) ? c[0] : c));
      if (!caps.includes('UIDPLUS')) {
        return { outcome: 'conflict', reason: 'UID EXPUNGE unavailable (no UIDPLUS) — permanent deletion refused by design' };
      }
      await client.messageFlagsAdd(String(op.uid), ['\\Deleted'], { uid: true });
      // UID EXPUNGE only this UID (messageDelete = flag \Deleted + UID EXPUNGE, UIDPLUS-gated)
      await client.messageDelete(String(op.uid), { uid: true });
      // local: remove the row + file
      if (op.message_key) {
        const row = this.store.db.prepare('SELECT id, file_path FROM messages WHERE message_key = ?').get(op.message_key) as { id: number; file_path: string } | undefined;
        if (row) {
          this.store.deleteMessages([row.id]);
          this.store.db.prepare('DELETE FROM fts WHERE rowid = ?').run(row.id);
          try { await import('fs').then(fs => fs.promises.unlink(row.file_path)); } catch { }
        }
      }
      return { outcome: 'done' };
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) };
    } finally {
      await client.logout().catch(() => { });
    }
  }

  // ----- send (state machine; docs/WRITE_PATH.md §5) ---------------------------
  private async doSend(op: JournalRow): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as {
      mime: string; messageId: string; sentFolderPath: string;
      envelope: { from?: string; to: string[]; cc: string[]; bcc: string[] };
      /** The saved draft this mail was written in; it goes once the mail is sent */
      draft?: { path: string; uid: number; uidValidity: string | null };
    };
    const mimeBuf = Buffer.from(payload.mime, 'base64');
    if (op.state === 'unknown') {
      // resolution probe: never resend; check the Sent folder for our Message-ID
      return await this.resolveUnknownSend(op, payload);
    }
    // crash-resume guard: if a previous attempt already ACKed and filed the message,
    // re-executing must not send twice. Probe by Message-ID first (RFC 4549 §5.1:
    // verify-before-replay for non-idempotent commands).
    const already = await this.sentProbe(payload.messageId, payload.sentFolderPath);
    if (already === 'sent') return { outcome: 'done', detail: 'already sent (found by Message-ID probe)' };

    // definitive SMTP rejection before DATA ⇒ failed → safe to retry later
    try {
      const smtp = getSandboxConfig();
      const transporter = nodemailer.createTransport({
        host: smtp.smtpHost, port: smtp.smtpPort,
        secure: false, tls: { rejectUnauthorized: false },
        // socket died mid-DATA would throw here; we cannot know if the server
        // accepted — that case is handled below, not by retrying
      });
      await transporter.sendMail({
        raw: mimeBuf,
        envelope: {
          from: payload.envelope.from ?? '',
          to: [...payload.envelope.to, ...payload.envelope.cc, ...payload.envelope.bcc],
        },
      });
    } catch (e) {
      const msg = (e as Error).message || '';
      // classify: connection-style errors AFTER the greeting are ambiguous (the server
      // may have accepted DATA). Before-DATA errors (connect refused, auth) are definitive.
      const ambiguous = /socket|ECONNRESET|timeout|closed|aborted/i.test(msg);
      if (ambiguous) {
        // mark the op unknown BEFORE returning — replay then probes, never resends
        this.store.journalUpdate(op.id, { state: 'unknown', error: `smtp ambiguous: ${msg.slice(0, 80)}` });
        return { outcome: 'unknown', reason: `smtp outcome ambiguous: ${msg.slice(0, 80)}` };
      }
      return { outcome: 'failed', reason: `smtp: ${msg.slice(0, 100)}` };
    }
    // SMTP acked. Now file into Sent (retryable separately — never re-send)
    const filed = await this.appendToSent(op, payload, mimeBuf);
    if (payload.draft) await this.removeSentDraft(payload.draft);
    if (filed === true) return { outcome: 'done' };
    // sent but not filed: record sent state durably first — a later append retry must
    // not resend; resolution probe finds it via Message-ID
    this.store.journalUpdate(op.id, { state: 'done', error: `sent, but sent-append failed: ${filed}` });
    return { outcome: 'failed', reason: `sent-append: ${filed} (already delivered — will file, not resend)` };
  }

  /** Best effort: the mail is out, a draft left behind is only clutter */
  private async removeSentDraft(draft: { path: string; uid: number; uidValidity: string | null }): Promise<void> {
    const client = await this.sandboxClient().catch(() => null);
    if (!client) return;
    try {
      await this.removeDraft(client, draft.path, draft.uid, draft.uidValidity);
    } catch { /* see above */ } finally {
      await client.logout().catch(() => { });
    }
  }

  /** Probe the Sent folder for a Message-ID ('sent' | 'absent' | 'unavailable'). */
  private async sentProbe(messageId: string, sentFolderPath: string | null): Promise<'sent' | 'absent' | 'unavailable'> {
    if (!sentFolderPath || !messageId) return 'unavailable';
    const client = await this.sandboxClient();
    try {
      await client.mailboxOpen(sentFolderPath);
      const found = await client.search({ header: { 'message-id': messageId } }, { uid: true });
      return found && found.length ? 'sent' : 'absent';
    } catch {
      return 'unavailable';
    } finally {
      await client.logout().catch(() => { });
    }
  }

  private async resolveUnknownSend(op: JournalRow, payload: { messageId: string; sentFolderPath: string; mime: string }): Promise<OpResult> {
    // 1) Sent folder on the IMAP server
    const probe = await this.sentProbe(payload.messageId, payload.sentFolderPath);
    if (probe === 'sent') return { outcome: 'done', detail: 'resolved: found in Sent' };
    // 2) sink probe (injected; Mailpit in the sandbox host) — best-effort extra signal
    if (this.sinkProbe) {
      try {
        const delivered = await this.sinkProbe(payload.messageId);
        if (delivered) {
          // delivered but not filed: retry ONLY the Sent APPEND (never the SMTP send)
          const mimeBuf = Buffer.from(payload.mime, 'base64');
          const filed = await this.appendToSent(op, payload, mimeBuf);
          if (filed === true) return { outcome: 'done', detail: 'resolved via sink: delivered, filed late' };
          return { outcome: 'failed', reason: `resolved sent, but sent-append: ${filed}` };
        }
      } catch { /* sink probe is best-effort */ }
    }
    if (probe === 'absent' && payload.sentFolderPath) {
      // Sent folder reachable and the Message-ID is definitively not there, but the
      // sink probe can't be trusted for real providers → still needs a human decision
      return { outcome: 'conflict', reason: 'Sent folder checked (absent), sink probe inconclusive — needs user decision' };
    }
    return { outcome: 'conflict', reason: 'send outcome still unknown after probe — needs user decision' };
  }

  private async appendToSent(_op: JournalRow, payload: { sentFolderPath: string }, mimeBuf: Buffer): Promise<true | string> {
    const client = await this.sandboxClient();
    try {
      const sentPath = payload.sentFolderPath || this.store.allFolders().find(f => f.special_use?.includes('Sent'))?.imap_path || 'Sent';
      await client.append(sentPath, mimeBuf, ['\\Seen'], this.clock());
      return true;
    } catch (e) {
      return (e as Error).message.slice(0, 100);
    } finally {
      await client.logout().catch(() => { });
    }
  }

  // ----- drafts ----------------------------------------------------------------
  private async doDraftSave(op: JournalRow): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as { mime: string; oldUid?: number; appendedUid?: number };
    const mimeBuf = Buffer.from(payload.mime, 'base64');
    const draftsPath = op.folder_path
      || this.store.allFolders().find(f => f.special_use?.includes('Drafts'))?.imap_path || 'Drafts';
    const client = await this.sandboxClient();
    try {
      // record the new uid durably: a replay after a crash past the APPEND finds it and
      // must NOT append a second copy
      if (!payload.appendedUid) {
        const appended = await client.append(draftsPath, mimeBuf, ['\\Seen', '\\Draft'], this.clock());
        if (!appended || typeof appended !== 'object' || !appended.uid) {
          return { outcome: 'failed', reason: 'draft APPEND returned no uid (no UIDPLUS?)' };
        }
        payload.appendedUid = Number(appended.uid);
        this.store.journalUpdate(op.id, { payload });
      }
      // previous version gone meanwhile → fine, nothing to do (RFC 4549 §5.1 case 5)
      if (payload.oldUid != null) {
        await this.removeDraft(client, draftsPath, payload.oldUid, op.folder_uidvalidity);
      }
      return { outcome: 'done' };
    } catch (e) {
      // the new version is stored; an old one left behind is only clutter
      if (payload.appendedUid) return { outcome: 'done', detail: 'draft appended, old version kept' };
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) };
    } finally {
      await client.logout().catch(() => { });
    }
  }

  /** Permanently removes one saved version of a draft: only in the Drafts folder it was
   *  saved to (same UIDVALIDITY), only a message flagged \Draft, only by UID EXPUNGE. */
  private async removeDraft(client: ImapFlow, draftsPath: string, uid: number, uidValidity: string | null): Promise<string> {
    const mb = await client.mailboxOpen(draftsPath);
    if (uidValidity && String(mb.uidValidity) !== uidValidity) return 'UIDVALIDITY changed';
    const caps = [...(client as unknown as { capabilities: Set<string> }).capabilities].map(c => (Array.isArray(c) ? c[0] : c));
    if (!caps.includes('UIDPLUS')) return 'no UIDPLUS';
    let isDraft: boolean | null = null;
    for await (const m of client.fetch(String(uid), { uid: true, flags: true }, { uid: true })) {
      isDraft = m.flags?.has('\\Draft') ?? false;
    }
    if (isDraft === null) return 'absent';
    if (!isDraft) return 'not a draft';
    await client.messageDelete(String(uid), { uid: true });
    return 'removed';
  }
}
