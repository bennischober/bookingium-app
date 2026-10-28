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
import { ImapFlow } from 'imapflow'
import fs from 'fs'
import { Store, JournalRow } from './store.js'
import { connectWriteImap, WriteAccount } from './write_guard.js'
import { WriteConnectionPool } from './write_connection.js'
import type { ConnectionBudget } from './connection_budget.js'
import { isPathOrChild } from './folders.js'
import { selectFailed } from './write_select.js'
import { WriteMoves } from './write_moves.js'
import { WriteSend } from './write_send.js'
import { WriteFolders } from './write_folders.js'

export type OpResult =
  | { outcome: 'done'; detail?: string }
  | { outcome: 'conflict'; reason: string }
  | { outcome: 'failed'; reason: string } // transient — retried by the replay loop
  | { outcome: 'unknown'; reason: string } // send: outcome ambiguous — needs probe/user
  | { outcome: 'noop'; reason: string } // op is moot (e.g. flag already set)

export { folderMissing } from './write_select.js'
export type { BatchMember, BatchMoved } from './write_moves.js'
export { smtpRefused } from './write_send.js'
export { FOLDER_DELETE_REFUSED } from './write_folders.js'

export class WriteEngine {
  // serialized playback: one operation at a time per account
  private chain: Promise<unknown> = Promise.resolve()
  // ops queued or running, by id: the startup replay must not run an op a second
  // time while the call that enqueued it still waits for a folder
  private inFlight = new Map<string, Promise<OpResult>>()
  // I1: the op bodies themselves, until they end; close() drains these, not the answers
  private bodies = new Set<Promise<OpResult>>()
  private engineHooks: {
    withFolderMutex: (path: string, fn: () => Promise<void>) => Promise<void>
    triggerResync: (path: string) => void
    /** G5: store a draft the client just appended, so it is visible without a resync */
    storeAppendedDraft?: (
      folderPath: string,
      uidValidity: string,
      uid: number,
      source: Buffer,
      flags?: Set<string>
    ) => Promise<void>
  } | null = null
  // Task 5: the sandbox sink probe (Mailpit in this prototype) is injected so the core
  // carries no hard-coded test-environment URLs. Optional — without it, unknown sends
  // fall back to the Sent-folder probe only (always safe, just less conclusive).
  private sinkProbe: ((messageId: string) => Promise<boolean>) | null = null

  constructor(
    private store: Store,
    private accountId: string,
    options: {
      /** A7: this account's own write endpoints - never a global sandbox config */
      writeAccount: WriteAccount
      /** A7: credentials for this account, resolved lazily from the host */
      credentials: () => Promise<{ user: string; pass: string }>
      /** probe a message sink (e.g. Mailpit API) for a Message-ID; true = definitely delivered */
      sinkProbe?: (messageId: string) => Promise<boolean>
      /** injectable clock (task 5 Step 3 makes timing-dependent tests deterministic) */
      clock?: () => Date
      /** host logger; expunge reports a failed file unlink here (never the file name) */
      log?: { warn?: (msg: string) => void }
      /** I15a: the account's connection budget, shared with the sync engine */
      budget?: ConnectionBudget
    }
  ) {
    this.writeAccount = options.writeAccount
    this.credentials = options.credentials
    this.budget = options.budget ?? null
    this.sinkProbe = options.sinkProbe ?? null
    this.clock = options.clock ?? (() => new Date())
    this.log = options.log ?? null
    this.moves = new WriteMoves({
      store,
      accountId: this.accountId,
      writeClient: () => this.writeClient(),
      preflight: (op, client, targetPath) => this.preflight(op, client, targetPath),
      abandoned: (signal) => this.abandoned(signal)
    })
    this.send = new WriteSend({
      store,
      writeAccount: this.writeAccount,
      credentials: () => this.credentials(),
      sinkProbe: () => this.sinkProbe,
      clock: () => this.clock(),
      engineHooks: () => this.engineHooks,
      writeClient: () => this.writeClient(),
      abandoned: (signal) => this.abandoned(signal)
    })
    this.folders = new WriteFolders({ store, writeClient: () => this.writeClient() })
  }
  /** A7: the account this engine writes for */
  private readonly writeAccount: WriteAccount
  private readonly credentials: () => Promise<{ user: string; pass: string }>
  private readonly budget: ConnectionBudget | null
  private clock: () => Date
  private log: { warn?: (msg: string) => void } | null
  private readonly moves: WriteMoves
  private readonly send: WriteSend
  private readonly folders: WriteFolders
  /** A6: true once the watchdog gave up on an op; the queue is stopped for this account */
  private queueStopped = false

  /** A6: the per-op watchdog limit. Size-aware for append/send: a big draft on a slow
   *  link may legitimately take long, so the limit grows with the payload at 32 KB/s. */
  private watchdogMs(op: JournalRow): number {
    const base = 120_000
    if (op.kind !== 'draft_save' && op.kind !== 'send') return base
    let bytes = 0
    try {
      const payload = JSON.parse(op.payload || '{}') as { mime?: string }
      bytes = payload.mime ? Buffer.from(payload.mime, 'base64').length : 0
    } catch {
      /* unreadable payload: the base limit applies */
    }
    return Math.max(base, Math.round(bytes / 32_000) * 1000)
  }

  /** Wired by account_entries.ts: lets the write path share the sync engine's folder mutexes
   *  and request a folder resync after conflicts. */
  attachEngine(hooks: WriteEngine['engineHooks']): void {
    this.engineHooks = hooks
  }

  /** Serialized execution: journal replay never interleaves. */ private enqueue<T>(
    fn: () => Promise<T>
  ): Promise<T> {
    const next = this.chain.then(fn, fn) // run regardless of previous failure
    this.chain = next.catch(() => {})
    return next as Promise<T>
  }

  /** account_entries.ts hook: ask the sync engine to resync a folder after a conflict. */
  requestResync(folderPath: string): void {
    this.engineHooks?.triggerResync(folderPath)
  }

  /** I3: is this op queued or running here right now (a cancel must wait for it)? */
  isInFlight(opId: string): boolean {
    return this.inFlight.has(opId)
  }

  /** account_entries.ts hook: run fn under the sync engine's folder mutex (single-writer rule). */
  runUnderFolderMutex<T>(folderPath: string, fn: () => Promise<T>): Promise<T> {
    if (this.engineHooks)
      return this.engineHooks.withFolderMutex(folderPath, fn as () => Promise<void>) as Promise<T>
    return fn()
  }

  /**
   * G2/L3c: the write connection, kept open between ops.
   *
   * Every op used to connect, LOGIN and logout - six round trips for one delete. Against the
   * real IONOS server a TLS handshake plus LOGIN costs several hundred milliseconds, and the
   * user pays it on every click. One connection is now reused for the whole serialized op
   * chain, which is safe because the ops are already serialized (`enqueue`).
   *
   * The caching itself lives in WriteConnectionPool so it can be tested without a server.
   */
  private readonly pool = new WriteConnectionPool(() => this.connectCounted())

  /**
   * I15a (MR-19): the write connection counts against the account's `maxConnections`. It asks
   * for its slot as urgent (the user is waiting), which makes the IDLE connection give its slot
   * back; the slot is returned when the connection closes.
   */
  private async connectCounted(): Promise<ImapFlow> {
    const release = this.budget ? await this.budget.acquire({ urgent: true }) : () => undefined
    try {
      const client = await connectWriteImap(this.writeAccount, await this.credentials())
      client.once('close', release)
      if (!client.usable) release()
      return client
    } catch (e) {
      release()
      throw e
    }
  }

  private writeClient(): Promise<ImapFlow> {
    return this.pool.get()
  }

  /** Drop the cached connection (after an error, or when the engine closes) */
  private dropClient(): Promise<void> {
    return this.pool.drop()
  }

  /** G2/L3c: close the shared connection; the journal makes the next start safe */
  async close(): Promise<void> {
    await this.dropClient()
  }

  /**
   * The folders whose sync mutex an op holds while it runs: its source and target, and for a
   * folder rename (I4, MR-31) the whole subtree on both sides. A sync of a subfolder during the
   * rename read a path that was being renamed under it and re-created rows the re-key moves.
   */
  lockedFolders(op: JournalRow): string[] {
    const paths = [op.folder_path, op.target_folder_path].filter((p): p is string => !!p)
    if (op.kind === 'folder_rename') {
      try {
        const payload = JSON.parse(op.payload || '{}') as { from?: string; to?: string; delimiter?: string }
        const delimiter = payload.delimiter ?? '/'
        const roots = [payload.from, payload.to].filter((p): p is string => !!p)
        paths.push(...roots)
        for (const f of this.store.allFolders()) {
          if (roots.some((root) => isPathOrChild(f.imap_path, root, delimiter))) paths.push(f.imap_path)
        }
      } catch {
        // a payload that does not parse is refused by the op itself; lock what the row names
      }
    }
    return [...new Set(paths)]
  }

  /** Execute one journaled op (or resume a 'running' one after a crash). */
  async execute(op: JournalRow): Promise<OpResult> {
    const queued = this.inFlight.get(op.id)
    if (queued) return queued
    if (this.queueStopped) {
      return { outcome: 'failed', reason: 'write queue stopped: restart bookingum to continue' }
    }
    // I1 (MR-16): a body the watchdog abandoned keeps its mutexes until it really ends, but
    // the caller gets its answer now - through this, not through the queued promise
    let answerEarly: (r: OpResult) => void = () => undefined
    const early = new Promise<OpResult>((resolve) => (answerEarly = resolve))
    const run = this.enqueue(async () => {
      // A5: attempts > 0 tells a replay from a first run (the draft probe reads it)
      this.store.journalBumpAttempts(op.id)
      // single-writer rule (docs/WRITE_PATH.md §6): hold the sync engine's folder
      // mutex for the source folder during the whole op; move ops also lock the target.
      // A2c: a self-move (target == source) must not nest the SAME mutex - the inner
      // acquire would poll forever for an entry the outer holds, deadlocking the serialized
      // op chain before doMoveLike's own refusal can run. Deduplicate first.
      const folders = this.lockedFolders(op)
      // A6: the watchdog starts only AFTER every mutex is held (F2) - an op that merely
      // waits behind a long folder sync must not be considered stuck.
      // I1 (MR-02): an op body that throws (a refused connect, a dropped socket) becomes an
      // outcome here. Before, the throw skipped the journal update and left the op 'running',
      // so the next start replayed it - for a send, a second copy the user never asked for.
      const body = (signal: AbortSignal): Promise<OpResult> =>
        this.executeOne(op, signal).catch((error: unknown) => this.thrownOutcome(op, error))
      const guarded = async (): Promise<OpResult> => {
        let stuck: Promise<unknown> | null = null
        const r = await this.withWatchdog(op, body, (work) => (stuck = work))
        if (stuck) {
          answerEarly(r)
          await stuck
        }
        return r
      }
      // nested in list order: the first folder is taken first and released last
      const locked = folders.reduceRight<() => Promise<OpResult>>(
        (inner, path) => () => this.runUnderFolderMutex(path, inner),
        guarded
      )
      const owned = await locked()
      // G2/L3c: a failed op may have left the shared connection in an unknown state, so
      // it is discarded rather than handed to the next op. The next op reconnects once.
      if (owned.outcome === 'failed' || owned.outcome === 'unknown') await this.dropClient()
      // I15a: kept for the next click, and closed once it has been idle a while
      else this.pool.idle()
      return owned
    })
    // a throw outside the body (a mutex, the journal) must not strand the op either
    const settled = run.catch((error: unknown) => this.thrownOutcome(op, error))
    const result = Promise.race([settled, early])
    this.inFlight.set(op.id, result)
    this.bodies.add(settled)
    // the entry stays until the body really ended, so a second execute() of it shares it
    void settled.finally(() => {
      this.inFlight.delete(op.id)
      this.bodies.delete(settled)
    })
    return result
  }

  /**
   * I1: what a thrown op body means. Before the SMTP phase nothing left the machine, so it is
   * a plain failure. From the SMTP phase on the server may have taken the mail: unknown, and
   * recorded as such right away, so a replay probes instead of sending again.
   */
  private thrownOutcome(op: JournalRow, error: unknown): OpResult {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 100)
    if (this.opPhase(op) === 'smtp') {
      this.store.journalUpdate(op.id, { state: 'unknown', error: `smtp ambiguous: ${message}` })
      return { outcome: 'unknown', reason: `smtp outcome ambiguous: ${message}` }
    }
    return { outcome: 'failed', reason: message }
  }

  /**
   * I1 (MR-01): wait for the ops in flight before the connection closes, bounded. A send cut
   * off here is still safe (its journal says 'smtp', the next start probes), but one that
   * finishes writes 'done' and needs no probe at all.
   */
  async drain(timeoutMs: number): Promise<void> {
    const pending = [...this.bodies]
    if (!pending.length) return
    let timer: NodeJS.Timeout | null = null
    await Promise.race([
      Promise.allSettled(pending),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
        timer.unref?.()
      })
    ])
    if (timer) clearTimeout(timer)
  }

  /**
   * A6: run one op body under the watchdog. On timeout the op is abandoned (its signal is
   * aborted, its clients are closed), never force-released: the mutex stays held, the queue
   * stops, and the host must restart the worker. The journal makes that restart safe.
   *
   * I1 (MR-16): "the mutex stays held" is made true by `onAbandoned`. It receives the body
   * that would not stop, and execute() keeps the mutexes until that body really ends.
   */
  private async withWatchdog(
    op: JournalRow,
    body: (signal: AbortSignal) => Promise<OpResult>,
    onAbandoned?: (work: Promise<unknown>) => void
  ): Promise<OpResult> {
    const controller = new AbortController()
    let timer: NodeJS.Timeout | null = null
    let lateTimer: NodeJS.Timeout | null = null
    const limit = this.watchdogMs(op)
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), limit)
      timer.unref?.()
    })
    const work = body(controller.signal).then((r) => ({ kind: 'result' as const, r }))
    try {
      const first = await Promise.race([work, timeout])
      if (first !== 'timeout') return first.r
      // Timed out: abandon the op and give the body a bounded chance to settle
      controller.abort()
      // I15a (MR-19): close the connection too. An op hung on a dead socket waits for an answer
      // that never comes; closing rejects its pending command, so the body ends within the
      // grace period below instead of stopping the queue.
      this.pool.discard()
      const settled = await Promise.race([
        work.catch(() => null),
        new Promise<'late'>((r) => {
          lateTimer = setTimeout(() => r('late'), 15_000)
          lateTimer.unref?.()
        })
      ])
      // a body that finished its work after all keeps its result: a send that reached
      // 'done' needs no probe
      if (settled && settled !== 'late' && (settled.r.outcome === 'done' || settled.r.outcome === 'noop'))
        return settled.r
      // A send that already reached SMTP is UNKNOWN, never failed (F3: a failed send would
      // be retried and could deliver twice). I1 (MR-03): that holds for a body that is still
      // running too - before, 'late' returned failed and sendMail cancelled a live send.
      const smtpUnknown: OpResult = {
        outcome: 'unknown',
        reason: 'timed out after the SMTP phase started - outcome unknown, probe required'
      }
      const sending = this.opPhase(op) === 'smtp'
      if (settled !== 'late') {
        // The body stopped on its own: record an outcome, the mutex can be released.
        return sending ? smtpUnknown : { outcome: 'failed', reason: 'timed out' }
      }
      // Still running: do NOT release the mutex, stop the queue, ask for a restart.
      this.queueStopped = true
      onAbandoned?.(work.catch(() => undefined))
      this.log?.warn?.(
        `write op ${op.id} (${op.kind}) did not stop after ${limit} ms - write queue stopped; restart required`
      )
      this.onQueueStopped?.('Schreibvorgänge angehalten. Bitte bookingum neu starten.')
      if (sending) {
        this.store.journalUpdate(op.id, { state: 'unknown', error: smtpUnknown.reason })
        return smtpUnknown
      }
      return {
        outcome: 'failed',
        reason: 'op did not stop after timeout - write queue stopped, restart required'
      }
    } finally {
      if (timer) clearTimeout(timer)
      if (lateTimer) clearTimeout(lateTimer)
    }
  }

  /** A6: the recorded phase of an op (set before the SMTP call) */
  private opPhase(op: JournalRow): string | null {
    try {
      return (
        (JSON.parse(this.store.journalGet(op.id)?.payload || '{}') as { phase?: string }).phase ??
        null
      )
    } catch {
      return null
    }
  }

  /** A6: the host reports a stopped queue to the UI (set by MailCore) */
  onQueueStopped: ((message: string) => void) | null = null

  private async executeOne(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
    switch (op.kind) {
      case 'flag':
        return this.doFlag(op, signal)
      case 'move':
      case 'delete':
        return this.moves.doMoveLike(op, signal) // archive = move to the Archive folder (same checks)
      case 'move_batch':
        return this.moves.doMoveBatch(op, signal) // B4: one UID MOVE for many mails
      case 'expunge':
        return this.doExpunge(op, signal)
      case 'folder_create':
        return this.folders.doFolderCreate(op)
      case 'folder_rename':
        return this.folders.doFolderRename(op)
      case 'folder_delete':
        return this.folders.doFolderDelete(op)
      case 'send':
        return this.send.doSend(op, signal)
      case 'draft_save':
        return this.send.doDraftSave(op, signal)
      case 'draft_delete':
        return this.moves.doMoveLike(op, signal) // draft deletion = move to Trash, same checks
      default:
        return { outcome: 'conflict', reason: `unknown op kind ${String(op.kind)}` }
    }
  }

  /** A6: called before every LOCAL write of an op. An abandoned op stops here. */
  private abandoned(signal: AbortSignal): OpResult | null {
    return signal.aborted ? { outcome: 'failed', reason: 'abandoned by the watchdog' } : null
  }

  /** Shared pre-flight: fresh SELECT + UIDVALIDITY + existence + cheap identity.
   *  Returns the open client + mailbox on success; the caller MUST logout. */
  private async preflight(
    op: JournalRow,
    client: ImapFlow,
    targetPath?: string
  ): Promise<{ ok: true; mailbox: { uidValidity: bigint } } | { ok: false; result: OpResult }> {
    const folderPath = targetPath ?? op.folder_path
    if (!folderPath || op.uid == null)
      return { ok: false, result: { outcome: 'conflict', reason: 'op has no folder/uid' } }
    // fresh SELECT — never trust a cached selection (RFC 2180 practice; Task 3 bug)
    let mb
    try {
      mb = await client.mailboxOpen(folderPath)
    } catch (e) {
      return { ok: false, result: selectFailed(e) }
    }
    // UIDVALIDITY must equal what the op was created against
    if (op.folder_uidvalidity && String(mb.uidValidity) !== op.folder_uidvalidity) {
      return {
        ok: false,
        result: {
          outcome: 'conflict',
          reason: `UIDVALIDITY changed (op ${op.folder_uidvalidity} vs server ${mb.uidValidity})`
        }
      }
    }
    // target must exist in the server's current view + cheap identity check
    // (imapflow fetch is an AsyncGenerator, not a Promise — do NOT await it directly)
    const fetched = client.fetch(
      String(op.uid),
      { uid: true, flags: true, size: true, internalDate: true },
      { uid: true }
    )
    let found = false
    let mismatch = false
    for await (const m of fetched) {
      found = true
      const local = this.localRowFor(op)
      if (local) {
        if (
          local.size_bytes != null &&
          m.size != null &&
          Number(local.size_bytes) !== Number(m.size)
        )
          mismatch = true
        if (local.internal_date && m.internalDate) {
          const a = new Date(local.internal_date).getTime()
          const b = new Date(m.internalDate).getTime()
          if (Math.abs(a - b) > 2000) mismatch = true // 2 s tolerance for server rounding
        }
      }
    }
    if (!found)
      return {
        ok: false,
        result: { outcome: 'conflict', reason: 'target vanished (uid not in server view)' }
      }
    if (mismatch)
      return {
        ok: false,
        result: { outcome: 'conflict', reason: 'identity mismatch (same uid, different message?)' }
      }
    return { ok: true, mailbox: { uidValidity: mb.uidValidity } }
  }

  private localRowFor(
    op: JournalRow
  ): { size_bytes: number | null; internal_date: string | null } | null {
    if (!op.message_key) return null
    const row = this.store.db
      .prepare('SELECT size_bytes, internal_date FROM messages WHERE message_key = ?')
      .get(op.message_key) as { size_bytes: number; internal_date: string } | undefined
    return row ?? null
  }

  // ----- flag -----------------------------------------------------------------
  private async doFlag(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as { add: string[]; remove: string[] }
    const client = await this.writeClient()
    try {
      const pf = await this.preflight(op, client)
      if (!pf.ok) return pf.result
      // per-delta STORE with ±FLAGS.SILENT (RFC 4549 §4.2.3 — never the full FLAGS form)
      if (payload.add?.length) {
        await client.messageFlagsAdd(String(op.uid), payload.add, { uid: true })
      }
      if (payload.remove?.length) {
        await client.messageFlagsRemove(String(op.uid), payload.remove, { uid: true })
      }
      // apply locally (authoritative now: server acked)
      const ab = this.abandoned(signal)
      if (ab) return ab
      this.applyFlagLocally(op, payload)
      return { outcome: 'done' }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  private applyFlagLocally(op: JournalRow, payload: { add: string[]; remove: string[] }): void {
    if (!op.message_key) return
    const row = this.store.db
      .prepare('SELECT id, flags_json FROM messages WHERE message_key = ?')
      .get(op.message_key) as { id: number; flags_json: string } | undefined
    if (!row) return
    // flags_json is a JSON OBJECT {"seen":bool,...} (store convention), not an array
    const flags = JSON.parse(row.flags_json) as Record<string, boolean>
    for (const f of payload.add || []) flags[f.replace('\\', '').toLowerCase()] = true
    for (const f of payload.remove || []) flags[f.replace('\\', '').toLowerCase()] = false
    this.store.updateMessageFlags(row.id, JSON.stringify(flags))
  }

  // ----- expunge (permanent deletion from Trash) -------------------------------
  private async doExpunge(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
    // hard rule: permanent deletion only from Trash
    const trash = this.store.allFolders().find((f) => f.special_use?.includes('Trash'))
    if (!trash || op.folder_path !== trash.imap_path) {
      return { outcome: 'conflict', reason: 'expunge refused: not in Trash' }
    }
    const client = await this.writeClient()
    try {
      const pf = await this.preflight(op, client)
      if (!pf.ok) return pf.result
      const caps = [...(client as unknown as { capabilities: Set<string> }).capabilities].map(
        (c) => (Array.isArray(c) ? c[0] : c)
      )
      if (!caps.includes('UIDPLUS')) {
        return {
          outcome: 'conflict',
          reason: 'UID EXPUNGE unavailable (no UIDPLUS) — permanent deletion refused by design'
        }
      }
      await client.messageFlagsAdd(String(op.uid), ['\\Deleted'], { uid: true })
      // UID EXPUNGE only this UID (messageDelete = flag \Deleted + UID EXPUNGE, UIDPLUS-gated)
      await client.messageDelete(String(op.uid), { uid: true })
      // local: remove the row + file
      const ab = this.abandoned(signal)
      if (ab) return ab
      if (op.message_key) await this.removeLocally(op.message_key)
      return { outcome: 'done' }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  /**
   * Local half of a permanent deletion: drop the row, then its file (card A1).
   * The row goes first, so a crash in between leaves an orphan file - never a row whose
   * file is gone. The `messages_bd` trigger already removes the row from the FTS index,
   * so the index needs no second delete here.
   * The file path is resolved against the account's data dir: `file_path` is relative and
   * a bare unlink would resolve against the process's working directory (F7).
   */
  removeLocally(messageKey: string): void {
    const row = this.store.db
      .prepare('SELECT id, file_path FROM messages WHERE message_key = ?')
      .get(messageKey) as { id: number; file_path: string } | undefined
    if (!row) return
    this.store.deleteMessages([row.id])
    const absPath = this.store.filePath(row.file_path)
    try {
      fs.unlinkSync(absPath)
    } catch (error) {
      // The row is gone, so the file is an orphan for the sweep. No file name in the
      // message: the key identifies the mail without leaking its path.
      this.log?.warn?.(
        `expunge: could not remove the file of ${messageKey}: ${(error as NodeJS.ErrnoException).code ?? 'unknown error'}`
      )
    }
  }

}
