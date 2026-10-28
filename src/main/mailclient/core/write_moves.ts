// R3: the move path, out of core/write_engine.ts: single and batch moves (delete, archive and
// draft delete are moves too), the batch preflight, the resume after a crash, the local half.
import type { ImapFlow } from 'imapflow'
import type { Store, JournalRow } from './store.js'
import { selectFailed } from './write_select.js'
import type { OpResult } from './write_engine.js'

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

/**
 * I15a (MR-32): the one UID a moved message got, found by Message-ID at the target. Only UIDs at
 * or above the UIDNEXT recorded before the move count, and exactly one must: two means another
 * copy arrived meanwhile, and taking either would be a guess.
 */
function arrivedOnce(found: number[] | false | undefined, since: number): number | null {
  const arrived = (found || []).filter((uid) => uid >= since)
  return arrived.length === 1 ? arrived[0] : null
}

/** What the move path needs from the engine. */
export interface WriteMovesContext {
  readonly store: Store
  readonly accountId: string
  writeClient(): Promise<ImapFlow>
  preflight(
    op: JournalRow,
    client: ImapFlow,
    targetPath?: string
  ): Promise<{ ok: true; mailbox: { uidValidity: bigint } } | { ok: false; result: OpResult }>
  abandoned(signal: AbortSignal): OpResult | null
}

export class WriteMoves {
  constructor(private readonly ctx: WriteMovesContext) {}

  private get store(): Store { return this.ctx.store }
  private get accountId(): string { return this.ctx.accountId }
  private writeClient(): Promise<ImapFlow> { return this.ctx.writeClient() }
  private preflight(op: JournalRow, client: ImapFlow, targetPath?: string): ReturnType<WriteMovesContext['preflight']> {
    return this.ctx.preflight(op, client, targetPath)
  }
  private abandoned(signal: AbortSignal): OpResult | null { return this.ctx.abandoned(signal) }

  private static isConflict(r: OpResult): r is { outcome: 'conflict'; reason: string } {
    return r.outcome === 'conflict'
  }

  // ----- move / delete / archive ----------------------------------------------
  async doMoveLike(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
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
          WriteMoves.isConflict(pf.result) &&
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
  async doMoveBatch(op: JournalRow, signal: AbortSignal): Promise<OpResult> {
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
}
