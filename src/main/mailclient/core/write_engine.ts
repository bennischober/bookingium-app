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
import { connectWriteImap, sendRefusal, writeSmtp, WriteAccount } from './write_guard.js'
import { WriteConnectionPool } from './write_connection.js'
import type { ConnectionBudget } from './connection_budget.js'
import { isPathOrChild } from './folders.js'
import { selectFailed } from './write_select.js'

export type OpResult =
  | { outcome: 'done'; detail?: string }
  | { outcome: 'conflict'; reason: string }
  | { outcome: 'failed'; reason: string } // transient — retried by the replay loop
  | { outcome: 'unknown'; reason: string } // send: outcome ambiguous — needs probe/user
  | { outcome: 'noop'; reason: string } // op is moot (e.g. flag already set)

/** I8 (MR-06): the start of a folder_delete conflict reason when the server's folder is not empty */
export const FOLDER_DELETE_REFUSED = 'folder not empty'

export { folderMissing } from './write_select.js'

/** B4: one mail inside a batch move, as the op's payload records it */
export type BatchMember = { uid: number; messageKey: string; messageId: string | null }
/** B4: where a member landed (COPYUID); durable before the local rows change.
 *  `messageKey` is the source key the move started from, `newKey` the row's key after it. */
export type BatchMoved = {
  uid: number
  messageKey: string
  destUid: number
  /** set once the local row has been re-keyed; undo finds the row by it */
  newKey?: string
}

/** I1: a send as the journal stores it (see doSend for the phases) */
type SendPayload = {
  mime: string
  messageId: string
  sentFolderPath: string
  envelope: { from?: string; to: string[]; cc: string[]; bcc: string[] }
  /** The saved draft this mail was written in; it goes once the mail is sent */
  draft?: { path: string; uid: number; uidValidity: string | null }
  phase?: 'smtp' | 'sent'
}

/**
 * I1: did the SMTP server definitely NOT take the mail? Only then may a send be retried.
 * It is definite when the server refused the login (EAUTH) or the envelope (EENVELOPE:
 * MAIL FROM, RCPT TO or DATA itself), rejected the message with a response code after
 * the content (EMESSAGE), or the connection never came up (DNS, refused, unreachable).
 * Everything else is unknown: nodemailer labels every socket error, timeout and
 * unexpected close `CONN` / ESOCKET / ETIMEDOUT / ECONNECTION, even one that happens
 * after the content was sent, so neither the command nor a response code on those
 * proves anything. Before, a regex listed the ambiguous cases, so every error it did
 * not know (EPIPE, ENETRESET) counted as definite and was retried.
 */
export function smtpRefused(error: unknown): boolean {
  const e = (error ?? {}) as { code?: string; originalCode?: string; responseCode?: unknown }
  if (e.code === 'EAUTH' || e.code === 'EENVELOPE' || e.code === 'EDNS') return true
  if (e.code === 'EMESSAGE' && typeof e.responseCode === 'number') return true
  // a system error that only a connect attempt can raise; nodemailer keeps it in originalCode
  const system = e.originalCode ?? e.code ?? ''
  return ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(system)
}

/**
 * I15a (MR-32): the one UID a moved message got, found by Message-ID at the target. Only UIDs at
 * or above the UIDNEXT recorded before the move count, and exactly one must: two means another
 * copy arrived meanwhile, and taking either would be a guess.
 */
function arrivedOnce(found: number[] | false | undefined, since: number): number | null {
  const arrived = (found || []).filter((uid) => uid >= since)
  return arrived.length === 1 ? arrived[0] : null
}

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
  }
  /** A7: the account this engine writes for */
  private readonly writeAccount: WriteAccount
  private readonly credentials: () => Promise<{ user: string; pass: string }>
  private readonly budget: ConnectionBudget | null
  private clock: () => Date
  private log: { warn?: (msg: string) => void } | null
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
        return this.doMoveLike(op, signal) // archive = move to the Archive folder (same checks)
      case 'move_batch':
        return this.doMoveBatch(op, signal) // B4: one UID MOVE for many mails
      case 'expunge':
        return this.doExpunge(op, signal)
      case 'folder_create':
        return this.doFolderCreate(op)
      case 'folder_rename':
        return this.doFolderRename(op)
      case 'folder_delete':
        return this.doFolderDelete(op)
      case 'send':
        return this.doSend(op, signal)
      case 'draft_save':
        return this.doDraftSave(op, signal)
      case 'draft_delete':
        return this.doMoveLike(op, signal) // draft deletion = move to Trash, same checks
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

  private static isConflict(r: OpResult): r is { outcome: 'conflict'; reason: string } {
    return r.outcome === 'conflict'
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

  // ----- move / delete / archive ----------------------------------------------
  private async doMoveLike(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
    const target = op.kind === 'delete' ? op.target_folder_path || 'Trash' : op.target_folder_path
    if (!target) return { outcome: 'conflict', reason: 'move without target folder' }
    // map Trash folder name: prefer the special-use Trash folder's real path
    let targetPath = target
    if (op.kind === 'delete' || op.kind === 'draft_delete') {
      const trash = this.store.allFolders().find((f) => f.special_use?.includes('Trash'))
      if (trash) targetPath = trash.imap_path
    }
    // A2c: a move whose target IS the source folder (a UID MOVE into the selected
    // mailbox) is undefined territory - the sandbox wedged on it. Production paths
    // cannot produce it (MailCore skips same-folder moves; undo goes back to the
    // original folder), but the write path refuses it before any server contact.
    if (op.folder_path && op.folder_path === targetPath) {
      return { outcome: 'conflict', reason: 'move refused: target equals source folder' }
    }
    const client = await this.writeClient()
    try {
      const pf = await this.preflight(op, client)
      if (!pf.ok) {
        // "target vanished" for a move the sync engine already applied (e.g. MOVE by
        // this op completed but crashed before the journal update) → check destination
        if (
          WriteEngine.isConflict(pf.result) &&
          /vanished/.test(pf.result.reason) &&
          op.message_id
        ) {
          const resumed = await this.resumeHalfMoved(op, client, targetPath)
          if (resumed)
            return { outcome: 'done', detail: 'resumed after crash (found at destination)' }
        }
        return pf.result
      }
      const payload = JSON.parse(op.payload || '{}') as { copiedTo?: { uid: number } }
      // duplicate-safe resume: a previous attempt already copied to the target.
      // The check must open the TARGET: after preflight the SELECTED mailbox is the
      // SOURCE, so looking there would miss a genuine crash-after-copy (duplicate on
      // retry) and could resume on a coincidentally matching source uid (A2b).
      if (payload.copiedTo?.uid) {
        let found = false
        try {
          await client.mailboxOpen(targetPath)
          const existsAtTarget = client.fetch(
            String(payload.copiedTo.uid),
            { uid: true },
            { uid: true }
          )
          // one step is enough: any message at that UID means the copy already landed
          found = !(await existsAtTarget.next()).done
        } catch {
          /* target vanished — fall through to a fresh copy attempt */
        }
        // whatever the outcome: the copy/delete below act on the SELECTED mailbox,
        // which must be the SOURCE again
        await client.mailboxOpen(op.folder_path!)
        if (found) {
          // copy already happened; finish by deleting the source (see fallback step 3)
          return await this.finishMovedSource(op, client, payload.copiedTo.uid, signal)
        }
      }
      const caps = [...(client as unknown as { capabilities: Set<string> }).capabilities].map(
        (c) => (Array.isArray(c) ? c[0] : c)
      )
      const hasMove = caps.includes('MOVE')
      const hasUidplus = caps.includes('UIDPLUS')
      // A2b: without MOVE the fallback ends in UID EXPUNGE — and imapflow's
      // messageDelete degrades to a PLAIN EXPUNGE without UIDPLUS, which would wipe
      // EVERY \Deleted message in the mailbox (including ones other clients flagged for
      // deletion). Refuse BEFORE copying anything: a copy followed by a refusal would
      // leave a duplicate on the server. No MOVE + no UIDPLUS ⇒ no safe deletion.
      if (!hasMove && !hasUidplus) {
        return {
          outcome: 'conflict',
          reason:
            "move refused: server has neither MOVE nor UIDPLUS — the copy+expunge fallback would issue a plain EXPUNGE (removes other clients' \\Deleted messages); no safe per-message deletion exists"
        }
      }
      // I15a (MR-32): the target's UIDNEXT before anything moves; a resume after a crash then
      // accepts only a message that arrived at or above it, never a copy that was there already
      await this.recordTargetUidNext(op, client, targetPath)
      if (hasMove) {
        const result = await client.messageMove(String(op.uid), targetPath, { uid: true })
        if (!result) return { outcome: 'failed', reason: 'MOVE returned false' }
        const destUid = result.uidMap?.get(Number(op.uid))
        const ab = this.abandoned(signal)
        if (ab) return ab
        this.applyMoveLocally(op, targetPath, destUid)
        return { outcome: 'done' }
      }
      // COPY fallback (crash-safe: record mapping before touching the source)
      const copyResult = await client.messageCopy(String(op.uid), targetPath, { uid: true })
      if (!copyResult) return { outcome: 'failed', reason: 'COPY returned false' }
      const destUid = copyResult.uidMap?.get(Number(op.uid)) ?? null
      if (destUid) {
        // durable mapping BEFORE deleting anything
        const ab = this.abandoned(signal)
        if (ab) return ab
        this.store.journalUpdate(op.id, { payload: { ...this.payloadOf(op), copiedTo: { uid: destUid } } })
        return await this.finishMovedSource(op, client, destUid, signal)
      }
      return { outcome: 'failed', reason: 'copy returned no destination uid (COPYUID missing)' }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  // ----- batch move (B4) -------------------------------------------------------
  /**
   * One UID MOVE for a whole (source, target) group instead of one op per mail.
   *
   * The op's payload holds `members: [{ uid, messageKey, messageId }]`; the group is
   * capped at 500 UIDs by the caller. The per-mail preflight is a single FETCH over the
   * set: a UID that is gone or whose identity does not match makes the whole op a
   * conflict - a partial move would leave the caller unable to reason about the rest.
   *
   * Crash safety: the UID MOVE either happened or it did not. After a crash the resume
   * finds the members at the TARGET by Message-ID (`resumeBatchMoved`), never by
   * guessing a UID, and without COPYUID the op refuses (A2b's rule).
   */
  private async doMoveBatch(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
    const targetPath = op.target_folder_path
    if (!targetPath) return { outcome: 'conflict', reason: 'batch move without target folder' }
    if (op.folder_path && op.folder_path === targetPath) {
      return { outcome: 'conflict', reason: 'move refused: target equals source folder' }
    }
    const payload = JSON.parse(op.payload || '{}') as {
      members?: BatchMember[]
      movedTo?: BatchMoved[]
    }
    const members = payload.members ?? []
    if (members.length === 0) return { outcome: 'conflict', reason: 'batch move without members' }
    // A previous attempt recorded its result: finish locally, never move twice
    if (payload.movedTo?.length) {
      this.applyBatchLocally(op, targetPath, payload.movedTo)
      return { outcome: 'done', detail: 'resumed after crash (result was recorded)' }
    }

    const client = await this.writeClient()
    try {
      const pf = await this.preflightBatch(op, client, members)
      if (!pf.ok) {
        // The move may have happened and the crash come before the journal update. I15a (MR-32):
        // only then is every source UID gone; one still there means the group did not move.
        if (pf.allGone) {
          const resumed = await this.resumeBatchMoved(op, client, targetPath, members)
          if (resumed) return { outcome: 'done', detail: 'resumed after crash (found at destination)' }
        }
        return pf.result
      }

      const caps = [...(client as unknown as { capabilities: Set<string> }).capabilities].map((c) =>
        Array.isArray(c) ? c[0] : c
      )
      if (!caps.includes('MOVE')) {
        // The single-move COPY+EXPUNGE fallback is UIDPLUS-gated; for a batch there is no
        // safe per-message deletion without it either, and a half-done group is worse
        // than a refused one. Refuse before touching the server.
        return {
          outcome: 'conflict',
          reason:
            'batch move refused: server has no MOVE — the copy+expunge fallback cannot delete a whole group safely; nothing was moved'
        }
      }

      await this.recordTargetUidNext(op, client, targetPath)
      const uids = members.map((m) => m.uid)
      const result = await client.messageMove(uids.join(','), targetPath, { uid: true })
      if (!result) return { outcome: 'failed', reason: 'MOVE returned false' }
      const ab = this.abandoned(signal)
      if (ab) return ab

      // COPYUID is the only trustworthy mapping; without it refuse (A2b's rule)
      const mapped: BatchMoved[] = []
      for (const member of members) {
        const destUid = result.uidMap?.get(member.uid)
        if (!destUid) {
          return {
            outcome: 'conflict',
            reason:
              'batch move: server returned no COPYUID for at least one mail — refusing to guess the new UIDs (a resync will show the moved mails)'
          }
        }
        mapped.push({ uid: member.uid, messageKey: member.messageKey, destUid })
      }
      // durable BEFORE the local update: a crash after this line resumes locally
      this.store.journalUpdate(op.id, { payload: { ...this.payloadOf(op), movedTo: mapped } })
      this.applyBatchLocally(op, targetPath, mapped)
      return { outcome: 'done', detail: `${mapped.length} mails moved in one UID MOVE` }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  /** One FETCH for the whole set: every UID must exist and match the local row */
  private async preflightBatch(
    op: JournalRow,
    client: ImapFlow,
    members: BatchMember[]
  ): Promise<{ ok: true } | { ok: false; result: OpResult; allGone?: boolean }> {
    if (!op.folder_path) return { ok: false, result: { outcome: 'conflict', reason: 'op has no folder' } }
    let mb
    try {
      mb = await client.mailboxOpen(op.folder_path)
    } catch (e) {
      return { ok: false, result: selectFailed(e) }
    }
    if (op.folder_uidvalidity && String(mb.uidValidity) !== op.folder_uidvalidity) {
      return {
        ok: false,
        result: {
          outcome: 'conflict',
          reason: `UIDVALIDITY changed (op ${op.folder_uidvalidity} vs server ${mb.uidValidity})`
        }
      }
    }
    const wanted = new Map(members.map((m) => [m.uid, m]))
    const fetched = client.fetch(members.map((m) => m.uid).join(','), { uid: true, size: true, internalDate: true }, { uid: true })
    let seen = 0
    let mismatch = false
    for await (const m of fetched) {
      const member = wanted.get(m.uid)
      if (!member) continue
      seen++
      const local = this.store.db
        .prepare('SELECT size_bytes, internal_date FROM messages WHERE message_key = ?')
        .get(member.messageKey) as { size_bytes: number; internal_date: string } | undefined
      if (!local) continue
      if (local.size_bytes != null && m.size != null && Number(local.size_bytes) !== Number(m.size)) {
        mismatch = true
      }
      if (local.internal_date && m.internalDate) {
        const a = new Date(local.internal_date).getTime()
        const b = new Date(m.internalDate).getTime()
        if (Math.abs(a - b) > 2000) mismatch = true
      }
    }
    if (seen !== members.length) {
      return {
        ok: false,
        allGone: seen === 0,
        result: { outcome: 'conflict', reason: `batch move: ${members.length - seen} of ${members.length} mails vanished (uid not in server view)` }
      }
    }
    if (mismatch) {
      return {
        ok: false,
        result: { outcome: 'conflict', reason: 'batch move: identity mismatch (same uid, different message?)' }
      }
    }
    return { ok: true }
  }

  /** Crash between MOVE and the journal update: are the members at the target by Message-ID? */
  private async resumeBatchMoved(
    op: JournalRow,
    client: ImapFlow,
    targetPath: string,
    members: BatchMember[]
  ): Promise<boolean> {
    // I15a (MR-32): every member must be found, so one without a Message-ID cannot be; the
    // members found used to be marked moved and the rest dropped silently. A resync is the
    // honest answer then.
    if (members.some((m) => !m.messageId)) return false
    const since = this.recordedUidNext(op)
    if (since === null) return false
    try {
      await client.mailboxOpen(targetPath)
      const mapped: BatchMoved[] = []
      const taken = new Set<number>()
      for (const member of members) {
        const found = await client.search(
          { header: { 'message-id': member.messageId! } },
          { uid: true }
        )
        const destUid = arrivedOnce(found, since)
        if (destUid === null || taken.has(destUid)) return false
        taken.add(destUid)
        mapped.push({ uid: member.uid, messageKey: member.messageKey, destUid })
      }
      this.store.journalUpdate(op.id, { payload: { ...this.payloadOf(op), movedTo: mapped } })
      this.applyBatchLocally(op, targetPath, mapped)
      return true
    } catch {
      return false
    }
  }

  private applyBatchLocally(op: JournalRow, targetPath: string, moved: BatchMoved[]): void {
    for (const m of moved) {
      m.newKey = this.applyMoveLocallyForKey(op, targetPath, m.destUid, m.messageKey) ?? undefined
    }
    // The rows are re-keyed now: record their new keys, or undo cannot find them
    const payload = JSON.parse(this.store.journalGet(op.id)?.payload || '{}') as Record<
      string,
      unknown
    >
    this.store.journalUpdate(op.id, { payload: { ...payload, movedTo: moved } })
  }

  // ----- folders (B1) -------------------------------------------------------
  /**
   * B1: one op per folder change, journaled like every other write.
   *
   * Idempotent replay is what makes a crash safe: a create whose folder exists
   * is done, a rename whose target exists and whose source is gone is done, and a
   * delete of a folder that is gone is done. Each of them then finishes its local
   * half, so a crash between the server call and the local update resumes.
   */
  private async doFolderCreate(op: JournalRow): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as { path?: string; delimiter?: string }
    const path = payload.path
    if (!path) return { outcome: 'conflict', reason: 'folder_create without path' }
    const client = await this.writeClient()
    try {
      const existing = await this.folderExists(client, path)
      if (existing) {
        // A replay of a create that already ran: keep the local row and be done
        this.store.upsertFolder({ imapPath: path, delimiter: payload.delimiter ?? '/' })
        return { outcome: 'done', detail: 'resumed: folder already exists' }
      }
      await client.mailboxCreate(path)
      this.store.upsertFolder({ imapPath: path, delimiter: payload.delimiter ?? '/' })
      return { outcome: 'done' }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  private async doFolderRename(op: JournalRow): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as {
      from?: string
      to?: string
      delimiter?: string
    }
    const from = payload.from
    const to = payload.to
    if (!from || !to) return { outcome: 'conflict', reason: 'folder_rename without from/to' }
    const delimiter = payload.delimiter ?? '/'
    const client = await this.writeClient()
    try {
      const targetExists = await this.folderExists(client, to)
      const sourceExists = await this.folderExists(client, from)
      // Replay of a rename that already ran: the target is there, the source is not
      const alreadyRenamed = targetExists && !sourceExists
      if (!alreadyRenamed) {
        if (!sourceExists) {
          return { outcome: 'conflict', reason: `folder gone: ${from}` }
        }
        if (targetExists) {
          return { outcome: 'conflict', reason: `target exists: ${to}` }
        }
        await client.mailboxRename(from, to)
      }
      // Local half: SELECT the new path and compare UIDVALIDITY. The same
      // UIDVALIDITY means the mail is still valid, so the rows are re-keyed;
      // a different one drops them and the normal swap re-downloads.
      let keepUids = true
      try {
        const before = this.store.getFolderByPath(from)
        const after = await client.mailboxOpen(to)
        const afterValidity = String(after.uidValidity)
        if (before?.uid_validity && before.uid_validity !== afterValidity) keepUids = false
        this.store.rekeyFolder(from, to, keepUids)
        // the new UIDVALIDITY is what the next sync compares against
        this.store.upsertFolder({ imapPath: to, delimiter, uidValidity: afterValidity })
      } catch {
        // Cannot confirm: keep the rows, a resync corrects them
        this.store.rekeyFolder(from, to, true)
      }
      return { outcome: 'done', detail: alreadyRenamed ? 'resumed: already renamed' : undefined }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  private async doFolderDelete(op: JournalRow): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as { path?: string }
    const path = payload.path
    if (!path) return { outcome: 'conflict', reason: 'folder_delete without path' }
    const client = await this.writeClient()
    try {
      const list = await client.list()
      const listed = list.find((f) => f.path === path)
      const exists = Boolean(listed)
      if (listed) {
        // I8 (MR-06): IMAP DELETE takes the folder's mail with it, past Trash. The core
        // checked its local copy before journaling; that copy misses mail another client
        // moved in since, so the server is asked here, right before the DELETE.
        const delimiter = listed.delimiter || '/'
        if (list.some((f) => f.path !== path && isPathOrChild(f.path, path, delimiter))) {
          return { outcome: 'conflict', reason: `${FOLDER_DELETE_REFUSED}: subfolders on the server` }
        }
        // imapflow answers false when STATUS failed: not known to be empty, so not deleted now
        const status = await client.status(path, { messages: true })
        if (!status) return { outcome: 'failed', reason: 'folder_delete: STATUS failed' }
        if (status.messages !== 0) {
          return { outcome: 'conflict', reason: `${FOLDER_DELETE_REFUSED}: ${status.messages ?? 'unknown'} mails on the server` }
        }
        await client.mailboxDelete(path)
      }
      const local = this.store.getFolderByPath(path)
      if (local) this.store.deleteFolderRow(local.id)
      return { outcome: 'done', detail: exists ? undefined : 'resumed: already gone' }
    } catch (e) {
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  /** Whether the server lists this path right now */
  private async folderExists(client: ImapFlow, path: string): Promise<boolean> {
    const list = await client.list()
    return list.some((f) => f.path === path)
  }

  /** The op's payload as the journal has it now (earlier steps of this run may have added to it) */
  private payloadOf(op: JournalRow): Record<string, unknown> {
    return JSON.parse(this.store.journalGet(op.id)?.payload || '{}') as Record<string, unknown>
  }

  /**
   * I15a (MR-32): ask the target for its UIDNEXT and journal it before a move. Whatever the move
   * puts there gets a UID at or above it; what was there before stays below.
   */
  private async recordTargetUidNext(op: JournalRow, client: ImapFlow, targetPath: string): Promise<void> {
    const status = await client.status(targetPath, { uidNext: true })
    if (!status || typeof status.uidNext !== 'number') return
    this.store.journalUpdate(op.id, { payload: { ...this.payloadOf(op), targetUidNext: status.uidNext } })
  }

  /** The target's UIDNEXT recorded before the move, or null (an op from before I15a: no resume) */
  private recordedUidNext(op: JournalRow): number | null {
    const value = this.payloadOf(op).targetUidNext
    return typeof value === 'number' ? value : null
  }

  /** Crash between copy and delete: is our message-id already at the destination? */
  private async resumeHalfMoved(
    op: JournalRow,
    client: ImapFlow,
    targetPath: string
  ): Promise<boolean> {
    if (!op.message_id) return false
    // I15a (MR-32): found[0] used to be taken, so a copy that was already there (a list mail, a
    // CC duplicate) marked the move done and re-keyed the row to someone else's UID
    const since = this.recordedUidNext(op)
    if (since === null) return false
    try {
      await client.mailboxOpen(targetPath)
      const found = await client.search({ header: { 'message-id': op.message_id } }, { uid: true })
      const destUid = arrivedOnce(found, since)
      if (destUid !== null) {
        this.applyMoveLocally(op, targetPath, destUid)
        return true
      }
    } catch {
      /* folder really gone — keep conflict */
    }
    return false
  }

  /** Fallback step 3+4: source still exists, copy is done → flag + UID EXPUNGE.
   *  A2b: refuses without UIDPLUS — a plain EXPUNGE here would delete OTHER clients'
   *  \\Deleted messages, not just ours (imapflow degrades silently). The crash-resume
   *  path can reach here without doMoveLike's capability gate having run. */
  private async finishMovedSource(
    op: JournalRow,
    client: ImapFlow,
    destUid: number,
    signal: AbortSignal
  ): Promise<OpResult> {
    const targetPath =
      op.kind === 'delete'
        ? (this.store.allFolders().find((f) => f.special_use?.includes('Trash'))?.imap_path ??
          'Trash')
        : op.target_folder_path || ''
    const caps = [...(client as unknown as { capabilities: Set<string> }).capabilities].map((c) =>
      Array.isArray(c) ? c[0] : c
    )
    if (!caps.includes('UIDPLUS')) {
      return {
        outcome: 'conflict',
        reason:
          "move fallback refused: no UIDPLUS — UID EXPUNGE unavailable, plain EXPUNGE would remove other clients' \\Deleted messages; copy stays (duplicate possible), nothing destroyed"
      }
    }
    const ab = this.abandoned(signal)
    if (ab) return ab
    // messageDelete = flag \Deleted + UID EXPUNGE (UIDPLUS-only path, see expunge)
    await client.messageDelete(String(op.uid), { uid: true })
    this.applyMoveLocally(op, targetPath, destUid)
    return { outcome: 'done', detail: 'fallback move (copy+delete)' }
  }

  private applyMoveLocally(
    op: JournalRow,
    targetPath: string,
    destUid: number | null | undefined
  ): void {
    if (!op.message_key) return
    const newKey = this.applyMoveLocallyForKey(op, targetPath, destUid, op.message_key)
    if (!newKey) return
    // the op's message_key names the source now; undo finds the row by the new key
    // (re-read: the COPY path stored copiedTo after this op row was loaded)
    const payload = JSON.parse(this.store.journalGet(op.id)?.payload || '{}') as Record<
      string,
      unknown
    >
    this.store.journalUpdate(op.id, {
      payload: { ...payload, movedTo: { uid: destUid, messageKey: newKey } }
    })
  }

  /**
   * B4: the local half of a move for one mail. `messageKey` names the source row; the
   * batch path calls this per member, the single path passes the op's own key.
   * Returns the row's new key, or null when nothing was updated.
   */
  private applyMoveLocallyForKey(
    op: JournalRow,
    targetPath: string,
    destUid: number | null | undefined,
    messageKey: string
  ): string | null {
    const srcFolder = op.folder_path ? this.store.getFolderByPath(op.folder_path) : null
    const dstFolder = this.store.getFolderByPath(targetPath)
    const row = srcFolder
      ? (this.store.db
          .prepare('SELECT * FROM messages WHERE message_key = ?')
          .get(messageKey) as Record<string, unknown> | undefined)
      : undefined
    if (!row || !srcFolder || !dstFolder) return null
    const newValidity = dstFolder.uid_validity ?? ''
    const newUid = destUid ?? null
    if (newUid == null) return null
    const newKey = this.store.messageKey(this.accountId, dstFolder.id, newValidity, newUid)
    // A3: file names are opaque and permanent, so a move only updates the row. The file
    // is NOT renamed any more: it is the same mail, and the DB owns the mapping.
    this.store.db
      .prepare(`UPDATE messages SET folder_id=@fid, uid=@uid, message_key=@mk WHERE id=@id`)
      .run({ fid: dstFolder.id, uid: newUid, mk: newKey, id: row.id as number })
    return newKey
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

  // ----- send (state machine; docs/WRITE_PATH.md §5) ---------------------------
  //
  // I1: the journal's payload.phase is the send's state, not op.state:
  //   (none)  nothing left the machine yet: sending is safe
  //   'smtp'  the SMTP exchange started: the server may have the mail, NEVER send again,
  //           only probe (op.state 'unknown' says the same and is kept in step)
  //   'sent'  the server took it: only filing into Sent is left, never SMTP again
  // A replay of any op reads the phase first, so a quit, a crash or a kill at any point
  // cannot lead to a second delivery.
  private async doSend(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as SendPayload
    const mimeBuf = Buffer.from(payload.mime, 'base64')
    // A7 part 2: the canary is a real mailbox, so phase 1 sends to the account's own
    // address only. Refused before any connection opens.
    const refusal = sendRefusal(this.writeAccount, [
      ...payload.envelope.to,
      ...payload.envelope.cc,
      ...payload.envelope.bcc
    ])
    if (refusal) return { outcome: 'failed', reason: `WRITE GUARD: ${refusal}` }
    if (payload.phase === 'sent') {
      // a replay after the server took the mail (checked first: it is the one sure state):
      // filing is all that is left. Probe first, the APPEND may have happened before the
      // journal could say so.
      if ((await this.sentProbe(payload.messageId, payload.sentFolderPath)) === 'sent')
        return { outcome: 'done', detail: 'sent earlier, found in Sent' }
      return this.fileSent(op, payload, mimeBuf)
    }
    if (op.state === 'unknown' || payload.phase === 'smtp') {
      // I1 (MR-01): a send interrupted after SMTP started (quit, crash, kill) comes back
      // 'running' with phase 'smtp'. It is unknown, and the resolution probe never resends.
      if (op.state !== 'unknown') {
        this.store.journalUpdate(op.id, {
          state: 'unknown',
          error: 'interrupted after the SMTP phase started'
        })
      }
      return await this.resolveUnknownSend(op, payload)
    }
    // crash-resume guard: if a previous attempt already ACKed and filed the message,
    // re-executing must not send twice. Probe by Message-ID first (RFC 4549 §5.1:
    // verify-before-replay for non-idempotent commands). I2: the editor keeps one
    // Message-ID per mail, so this also catches a manual "send again" of a mail that went out.
    const already = await this.sentProbe(payload.messageId, payload.sentFolderPath)
    if (already === 'sent')
      return { outcome: 'done', detail: 'already sent (found by Message-ID probe)' }

    const ab = this.abandoned(signal)
    if (ab) return ab
    // credentials and transport before the phase: a failure here sent nothing
    const transporter = writeSmtp(this.writeAccount, await this.credentials())
    // A6 step 5: record that the SMTP phase has started. Any timeout or failure from
    // here on is UNKNOWN unless the server itself said no - a failed send would be retried
    // and could deliver twice.
    this.store.journalUpdate(op.id, { payload: { ...payload, phase: 'smtp' } })
    try {
      await transporter.sendMail({
        raw: mimeBuf,
        envelope: {
          from: payload.envelope.from ?? '',
          to: [...payload.envelope.to, ...payload.envelope.cc, ...payload.envelope.bcc]
        }
      })
    } catch (e) {
      const msg = ((e as Error).message || '').slice(0, 100)
      if (smtpRefused(e)) {
        // the server answered no, or the session never got past the greeting: nothing
        // went out, so the phase goes back and a later attempt may send
        this.store.journalUpdate(op.id, { payload: { ...payload, phase: undefined } })
        return { outcome: 'failed', reason: `smtp: ${msg}` }
      }
      // no answer after the greeting: the server may have accepted DATA. Mark the op
      // unknown BEFORE returning - replay then probes, never resends
      this.store.journalUpdate(op.id, { state: 'unknown', error: `smtp ambiguous: ${msg}` })
      return { outcome: 'unknown', reason: `smtp outcome ambiguous: ${msg}` }
    }
    // SMTP acked: from here on only filing into Sent is left (retryable, never a resend)
    this.store.journalUpdate(op.id, { payload: { ...payload, phase: 'sent' } })
    if (payload.draft) await this.removeSentDraft(payload.draft)
    return this.fileSent(op, payload, mimeBuf)
  }

  /**
   * I1 (MR-43): file a mail the server took. A failure stays a 'failed' op in phase 'sent',
   * which goes back to pending and is filed by the next replay - before, the op was marked
   * done with "will file" and nothing ever filed it.
   */
  private async fileSent(op: JournalRow, payload: SendPayload, mimeBuf: Buffer): Promise<OpResult> {
    const filed = await this.appendToSent(op, payload, mimeBuf)
    if (filed === true) return { outcome: 'done' }
    return {
      outcome: 'failed',
      reason: `sent-append: ${filed} (already delivered - will file, not resend)`
    }
  }

  /** Best effort: the mail is out, a draft left behind is only clutter */
  private async removeSentDraft(draft: {
    path: string
    uid: number
    uidValidity: string | null
  }): Promise<void> {
    const client = await this.writeClient().catch(() => null)
    if (!client) return
    try {
      await this.removeDraft(client, draft.path, draft.uid, draft.uidValidity)
    } catch {
      /* see above */
    }
  }

  /** Probe the Sent folder for a Message-ID ('sent' | 'absent' | 'unavailable'). */
  private async sentProbe(
    messageId: string,
    sentFolderPath: string | null
  ): Promise<'sent' | 'absent' | 'unavailable'> {
    if (!sentFolderPath || !messageId) return 'unavailable'
    try {
      // I1 (MR-02): a failed connect is 'unavailable', not a throw that strands the op
      const client = await this.writeClient()
      await client.mailboxOpen(sentFolderPath)
      const found = await client.search({ header: { 'message-id': messageId } }, { uid: true })
      return found && found.length ? 'sent' : 'absent'
    } catch {
      return 'unavailable'
    }
  }

  private async resolveUnknownSend(op: JournalRow, payload: SendPayload): Promise<OpResult> {
    // 1) Sent folder on the IMAP server
    const probe = await this.sentProbe(payload.messageId, payload.sentFolderPath)
    if (probe === 'sent') return { outcome: 'done', detail: 'resolved: found in Sent' }
    // 2) sink probe (injected; Mailpit in the sandbox host) — best-effort extra signal
    if (this.sinkProbe) {
      try {
        const delivered = await this.sinkProbe(payload.messageId)
        if (delivered) {
          // delivered but not filed: retry ONLY the Sent APPEND (never the SMTP send).
          // I1: the phase says so first, so a failed filing is retried as filing only.
          this.store.journalUpdate(op.id, { payload: { ...payload, phase: 'sent' } })
          const filed = await this.fileSent(op, payload, Buffer.from(payload.mime, 'base64'))
          return filed.outcome === 'done'
            ? { outcome: 'done', detail: 'resolved via sink: delivered, filed late' }
            : filed
        }
      } catch {
        /* sink probe is best-effort */
      }
    }
    if (probe === 'absent' && payload.sentFolderPath) {
      // Sent folder reachable and the Message-ID is definitively not there, but the
      // sink probe can't be trusted for real providers → still needs a human decision
      return {
        outcome: 'conflict',
        reason: 'Sent folder checked (absent), sink probe inconclusive — needs user decision'
      }
    }
    return {
      outcome: 'conflict',
      reason: 'send outcome still unknown after probe — needs user decision'
    }
  }

  private async appendToSent(
    _op: JournalRow,
    payload: { sentFolderPath: string },
    mimeBuf: Buffer
  ): Promise<true | string> {
    try {
      const client = await this.writeClient()
      const sentPath =
        payload.sentFolderPath ||
        this.store.allFolders().find((f) => f.special_use?.includes('Sent'))?.imap_path ||
        'Sent'
      await client.append(sentPath, mimeBuf, ['\\Seen'], this.clock())
      return true
    } catch (e) {
      return (e as Error).message.slice(0, 100)
    }
  }

  // ----- drafts ----------------------------------------------------------------
  private async doDraftSave(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
    const payload = JSON.parse(op.payload || '{}') as {
      mime: string
      oldUid?: number
      appendedUid?: number
    }
    const mimeBuf = Buffer.from(payload.mime, 'base64')
    const draftsPath =
      op.folder_path ||
      this.store.allFolders().find((f) => f.special_use?.includes('Drafts'))?.imap_path ||
      'Drafts'
    const client = await this.writeClient()
    try {
      // I17 (write path L7): the editor has saved a newer version since this op was journaled
      // (a replay after a crash). Appending now would bring the older text back, so this op
      // stops. A copy an earlier run of it already appended goes; the old version is the
      // newer save's to remove.
      if (this.store.journalDraftSuperseded(op)) {
        const own =
          payload.appendedUid ??
          (op.attempts > 0
            ? await this.findDraftByMessageId(client, draftsPath, op.message_id)
            : null)
        if (own != null) {
          const ab = this.abandoned(signal)
          if (ab) return ab
          await this.removeDraft(client, draftsPath, own, op.folder_uidvalidity)
        }
        return { outcome: 'noop', reason: 'a newer version of this draft was saved' }
      }
      // A5: record the new uid durably. A replay after a crash past the APPEND finds
      // it and must NOT append a second copy.
      if (!payload.appendedUid) {
        // A5 (F5): on a REPLAY the previous attempt may have appended and then lost
        // the journal update. Before appending again, look for our Message-ID in Drafts.
        // This probe is only safe because every draft save builds a FRESH Message-ID
        // (compose.ts uses randomUUID() per build), so a found id is always THIS
        // attempt's copy and never an older version's.
        // I1 (MR-15): execute() counts every run before the body starts, so attempts > 0
        // on the row a run was given means an earlier run got as far as the body
        if (op.attempts > 0) {
          const found = await this.findDraftByMessageId(client, draftsPath, op.message_id)
          if (found != null) {
            payload.appendedUid = found
            this.store.journalUpdate(op.id, { payload })
          }
        }
        if (!payload.appendedUid) {
          const ab0 = this.abandoned(signal)
          if (ab0) return ab0
          // F12: no \Seen on a draft. A draft you cannot see is a draft you forget,
          // and the folder count is how the user notices there is one.
          const appended = await client.append(
            draftsPath,
            mimeBuf,
            ['\\Draft'],
            this.clock()
          )
          if (!appended || typeof appended !== 'object' || !appended.uid) {
            return { outcome: 'failed', reason: 'draft APPEND returned no uid (no UIDPLUS?)' }
          }
          payload.appendedUid = Number(appended.uid)
          this.store.journalUpdate(op.id, { payload })
          // G5: make the draft visible NOW. Without this the row only appeared after the resync
          // below re-downloaded the message the client had just uploaded - the delay the person saw.
          // Best effort: a failure here must not fail the save, the resync is still the fallback.
          const draftFolder = this.store.getFolderByPath(draftsPath)
          if (draftFolder) {
            await this.engineHooks
              ?.storeAppendedDraft?.(
                draftsPath,
                draftFolder.uid_validity ?? '',
                payload.appendedUid,
                mimeBuf,
                // F12: the draft is appended with \Draft and never \Seen, so the local row must
                // say the same or the folder count would not show it
                new Set(['\\Draft'])
              )
              .catch(() => undefined)
          }
        }
      }
      // previous version gone meanwhile → fine, nothing to do (RFC 4549 §5.1 case 5).
      // I17 (write path L7): besides the version the editor names, the copy the latest earlier
      // save of this session appended. They are the same unless an earlier save was replayed
      // after the editor had moved on; then that copy would stay behind as a stale draft.
      const stale = new Set([payload.oldUid, this.store.journalLastDraftUidBefore(op)])
      for (const uid of stale) {
        if (uid == null || uid === payload.appendedUid) continue
        const ab = this.abandoned(signal)
        if (ab) return ab
        await this.removeDraft(client, draftsPath, uid, op.folder_uidvalidity)
      }
      return { outcome: 'done' }
    } catch (e) {
      // the new version is stored; an old one left behind is only clutter
      if (payload.appendedUid)
        return { outcome: 'done', detail: 'draft appended, old version kept' }
      return { outcome: 'failed', reason: (e as Error).message.slice(0, 120) }
    }
  }

  /** A5: the UID of the draft this attempt already appended, found by Message-ID.
   *  Returns null when the id is unknown, the folder cannot be opened, or nothing matches. */
  private async findDraftByMessageId(
    client: ImapFlow,
    draftsPath: string,
    messageId: string | null
  ): Promise<number | null> {
    if (!messageId) return null
    try {
      await client.mailboxOpen(draftsPath)
      // message_id is stored without angle brackets; the header search wants them
      const id = messageId.replace(/^</, '').replace(/>$/, '')
      const uids = await client.search({ header: { 'message-id': `<${id}>` } }, { uid: true })
      if (uids && uids.length) return Number(uids[0])
    } catch {
      /* folder or search unavailable: append a fresh copy */
    }
    return null
  }

  /** Permanently removes one saved version of a draft: only in the Drafts folder it was
   *  saved to (same UIDVALIDITY), only a message flagged \Draft, only by UID EXPUNGE. */
  private async removeDraft(
    client: ImapFlow,
    draftsPath: string,
    uid: number,
    uidValidity: string | null
  ): Promise<string> {
    const mb = await client.mailboxOpen(draftsPath)
    if (uidValidity && String(mb.uidValidity) !== uidValidity) return 'UIDVALIDITY changed'
    const caps = [...(client as unknown as { capabilities: Set<string> }).capabilities].map((c) =>
      Array.isArray(c) ? c[0] : c
    )
    if (!caps.includes('UIDPLUS')) return 'no UIDPLUS'
    let isDraft: boolean | null = null
    for await (const m of client.fetch(String(uid), { uid: true, flags: true }, { uid: true })) {
      isDraft = m.flags?.has('\\Draft') ?? false
    }
    if (isDraft === null) return 'absent'
    if (!isDraft) return 'not a draft'
    await client.messageDelete(String(uid), { uid: true })
    return 'removed'
  }
}
