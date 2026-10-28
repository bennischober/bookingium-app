// R3: the send and draft path, out of core/write_engine.ts: send with its phases, the probe
// for an unknown outcome, filing to Sent, draft save and the removal of old draft versions.
import type { ImapFlow } from 'imapflow'
import type { Store, JournalRow } from './store.js'
import { sendRefusal, writeSmtp, WriteAccount } from './write_guard.js'
import type { OpResult, WriteEngine } from './write_engine.js'


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

/** What the send and draft path needs from the engine. */
export interface WriteSendContext {
  readonly store: Store
  readonly writeAccount: WriteAccount
  credentials(): Promise<{ user: string; pass: string }>
  sinkProbe(): ((messageId: string) => Promise<boolean>) | null
  clock(): Date
  engineHooks(): WriteEngine['engineHooks']
  writeClient(): Promise<ImapFlow>
  abandoned(signal: AbortSignal): OpResult | null
}

export class WriteSend {
  constructor(private readonly ctx: WriteSendContext) {}

  private get store(): Store { return this.ctx.store }
  private get writeAccount(): WriteAccount { return this.ctx.writeAccount }
  private get sinkProbe(): ((messageId: string) => Promise<boolean>) | null { return this.ctx.sinkProbe() }
  private get engineHooks(): WriteEngine['engineHooks'] { return this.ctx.engineHooks() }
  private credentials(): Promise<{ user: string; pass: string }> { return this.ctx.credentials() }
  private clock(): Date { return this.ctx.clock() }
  private writeClient(): Promise<ImapFlow> { return this.ctx.writeClient() }
  private abandoned(signal: AbortSignal): OpResult | null { return this.ctx.abandoned(signal) }

  // ----- send (state machine; docs/WRITE_PATH.md §5) ---------------------------
  //
  // I1: the journal's payload.phase is the send's state, not op.state:
  //   (none)  nothing left the machine yet: sending is safe
  //   'smtp'  the SMTP exchange started: the server may have the mail, NEVER send again,
  //           only probe (op.state 'unknown' says the same and is kept in step)
  //   'sent'  the server took it: only filing into Sent is left, never SMTP again
  // A replay of any op reads the phase first, so a quit, a crash or a kill at any point
  // cannot lead to a second delivery.
  async doSend(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
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
  async doDraftSave(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
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
