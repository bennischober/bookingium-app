// R2: the op journal side of MailCore, out of core/index.ts: flags, moves (trash, archive),
// expunge, running a journaled op and applying its result, replay at start, the automatic
// retry schedule, the op panel's list, retry, resolve, cancel and undo. MailCore keeps one-line
// delegations, and every run goes through its runOp.
import type { Store, JournalRow } from './store.js';
import type { OpResult, BatchMember, BatchMoved } from './write_engine.js';
import type { OpSummary } from './types.js';
import { foldersToResync } from './resync_scope.js';
import { autoRetryable, retryDelay, sendPhase } from './op_retry.js';
import type { AccountEntry, Logger, MailCoreEvent } from './index.js';

/** A7: a single UID MOVE covers at most this many mails; above that the group is split */
export const MOVE_BATCH_LIMIT = 500;

/** What the ops need from the core. */
export interface OpApiContext {
  readonly log: Logger;
  isClosed(): boolean;
  entry(id?: string): AccountEntry;
  writableEntry(id?: string): AccountEntry;
  emitEvent(e: MailCoreEvent): void;
  /** The core's runOp: a test replaces it on the instance, so every run goes through it. */
  runOp(e: AccountEntry, op: JournalRow): Promise<OpResult>;
  parseFlags(row: { flags_json: string }): { seen: boolean; flagged: boolean; draft: boolean; deleted: boolean; answered: boolean };
  refuseFolderDelete(e: AccountEntry, path: string): void;
  throwIfServerRefusedDelete(e: AccountEntry, opId: string): void;
}

export class OpApi {
  // I3 (MR-29): one automatic retry timer per account, and how many rounds left ops waiting
  readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private retryRounds = new Map<string, number>();

  constructor(private readonly ctx: OpApiContext) {}

  private get log(): Logger { return this.ctx.log; }
  private get closed(): boolean { return this.ctx.isClosed(); }
  private entry(id?: string): AccountEntry { return this.ctx.entry(id); }
  private writableEntry(id?: string): AccountEntry { return this.ctx.writableEntry(id); }
  private emitEvent(e: MailCoreEvent): void { this.ctx.emitEvent(e); }
  private parseFlags(row: { flags_json: string }): ReturnType<OpApiContext['parseFlags']> { return this.ctx.parseFlags(row); }
  private refuseFolderDelete(e: AccountEntry, path: string): void { this.ctx.refuseFolderDelete(e, path); }
  private throwIfServerRefusedDelete(e: AccountEntry, opId: string): void { this.ctx.throwIfServerRefusedDelete(e, opId); }

  async markRead(ids: number[], read: boolean, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const ids2 = this.planFlagOp(e, ids, read ? { add: ['\\Seen'] } : { remove: ['\\Seen'] });
    await this.replayOps(e, ids2);
  }

  async markFlagged(ids: number[], flagged: boolean, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const ids2 = this.planFlagOp(e, ids, flagged ? { add: ['\\Flagged'] } : { remove: ['\\Flagged'] });
    await this.replayOps(e, ids2);
  }

  planFlagOp(e: AccountEntry, ids: number[], delta: { add?: string[]; remove?: string[] }): string[] {
    const opIds: string[] = [];
    for (const id of ids) {
      const row = e.store.getMessage(id);
      if (!row) continue;
      const folder = e.store.getFolder(row.folder_id);
      if (!folder) continue;
      const flags = this.parseFlags(row);
      const flip: Record<string, boolean | undefined> = {};
      for (const f of delta.add || []) flip[f.replace(/^\\/, '').toLowerCase()] = true;
      for (const f of delta.remove || []) flip[f.replace(/^\\/, '').toLowerCase()] = false;
      const next = {
        seen: flip.seen !== undefined ? flip.seen : flags.seen,
        flagged: flip.flagged !== undefined ? flip.flagged : flags.flagged,
        draft: flip.draft !== undefined ? flip.draft : flags.draft,
        deleted: flip.deleted !== undefined ? flip.deleted : flags.deleted,
        answered: flip.answered !== undefined ? flip.answered : flags.answered,
      };
      e.store.updateMessageFlags(row.id, JSON.stringify(next));
      const opId = e.store.journalEnqueue({
        accountId: e.config.id, kind: 'flag',
        folderPath: folder.imap_path, folderUidValidity: folder.uid_validity ?? undefined,
        uid: row.uid, messageKey: row.message_key, messageId: row.message_id ?? undefined,
        payload: { add: delta.add || [], remove: delta.remove || [] },
      });
      opIds.push(opId);
    }
    return opIds;
  }

  async moveToFolder(ids: number[], targetFolderId: string, accountId?: string): Promise<OpSummary[]> {
    const e = this.writableEntry(accountId);
    const target = e.store.getFolder(targetFolderId);
    if (!target) throw new Error(`target folder ${targetFolderId} not found`);

    // B4: group by source folder - one op (and one UID MOVE) per (source, target)
    const groups = new Map<string, BatchMember[]>();
    for (const id of ids) {
      const row = e.store.getMessage(id);
      if (!row) continue;
      const folder = e.store.getFolder(row.folder_id);
      // A2c: a mail already in the target is skipped before any journal insert,
      // so a self-move never reaches the write engine (which refuses it too)
      if (!folder || folder.imap_path === target.imap_path) continue;
      const list = groups.get(folder.imap_path) ?? [];
      list.push({ uid: row.uid, messageKey: row.message_key, messageId: row.message_id ?? null });
      groups.set(folder.imap_path, list);
    }

    const opIds: string[] = [];
    for (const [sourcePath, members] of groups) {
      const source = e.store.getFolderByPath(sourcePath);
      // B4: cap a batch at 500 UIDs and split above that
      for (let i = 0; i < members.length; i += MOVE_BATCH_LIMIT) {
        const chunk = members.slice(i, i + MOVE_BATCH_LIMIT);
        // One mail keeps the plain move op: its crash and resume semantics are the
        // well-tested single-message path, and a "batch" of one buys nothing.
        if (chunk.length === 1) {
          const only = chunk[0];
          opIds.push(e.store.journalEnqueue({
            accountId: e.config.id, kind: 'move',
            folderPath: sourcePath, folderUidValidity: source?.uid_validity ?? undefined,
            uid: only.uid, messageKey: only.messageKey, messageId: only.messageId ?? undefined,
            targetFolderPath: target.imap_path,
          }));
          continue;
        }
        opIds.push(e.store.journalEnqueue({
          accountId: e.config.id, kind: 'move_batch',
          folderPath: sourcePath, folderUidValidity: source?.uid_validity ?? undefined,
          targetFolderPath: target.imap_path,
          payload: { members: chunk },
        }));
      }
    }
    await this.replayOps(e, opIds);
    // G2/L3b: only the folders this move touched need a resync. A full syncAll() does
    // detectCapabilities + a STATUS per folder with a 150 ms pause between each, so a ten-folder
    // mailbox paid ~1.5 s of sleeping after every single click.
    this.resyncMovedFolders(e, opIds);
    return opIds.map(id => e.store.journalGet(id)).filter((op): op is JournalRow => Boolean(op)).map(op => this.opToSummary(op));
  }

  /** G2/L3b: resync just the source and target folders of the ops that were run */
  resyncMovedFolders(e: AccountEntry, opIds: string[]): void {
    const ops = opIds
      .map(opId => e.store.journalGet(opId))
      .filter((op): op is JournalRow => Boolean(op));
    for (const path of foldersToResync(ops)) e.writes.requestResync(path);
  }

  async deleteToTrash(ids: number[], accountId?: string): Promise<OpSummary[]> {
    const e = this.writableEntry(accountId);
    const trash = e.store.allFolders().find(f => f.special_use === '\\Trash');
    if (!trash) throw new Error('no Trash folder found');
    return this.moveToFolder(ids, trash.id, accountId);
  }

  async archive(ids: number[], accountId?: string): Promise<OpSummary[]> {
    const e = this.writableEntry(accountId);
    const archive = e.store.allFolders().find(f => f.special_use === '\\Archive');
    if (!archive) throw new Error('no Archive folder found');
    return this.moveToFolder(ids, archive.id, accountId);
  }

  async replayOps(e: AccountEntry, opIds: string[]): Promise<void> {
    for (const opId of opIds) {
      const op = e.store.journalGet(opId);
      if (!op) continue;
      await this.ctx.runOp(e, op);
    }
  }

  /**
   * G2: the one place a journaled op is executed, so every op announces itself.
   *
   * Before this, only sendMail emitted the 'running' event, so a move or a delete was
   * silent until it finished - the UI had nothing to show while the server was working.
   * Every caller now goes through here, which is also why the announcement cannot be
   * forgotten by the next op kind.
   */
  async runOp(e: AccountEntry, op: JournalRow): Promise<OpResult> {
    this.emitEvent({
      type: 'op-event', accountId: e.config.id, opId: op.id,
      kind: op.kind, outcome: 'running',
    });
    const result = await e.writes.execute(op);
    await this.applyOpResult(e, op.id, result);
    return result;
  }

  private async applyOpResult(e: AccountEntry, opId: string, result: OpResult): Promise<void> {
    const op = e.store.journalGet(opId);
    if (!op) return;
    this.emitEvent({
      type: 'op-event', accountId: e.config.id, opId,
      kind: op.kind, outcome: result.outcome,
      reason: ('reason' in result ? result.reason : undefined),
    });
    switch (result.outcome) {
      case 'done':
      case 'noop':
        e.store.journalUpdate(opId, {
          state: 'done',
          error: (result.outcome === 'done' ? result.detail : result.reason) ?? undefined,
        });
        break;
      case 'conflict':
        e.store.journalUpdate(opId, { state: 'conflict', error: result.reason });
        if (op.folder_path) e.writes.requestResync(op.folder_path);
        break;
      case 'unknown':
        e.store.journalUpdate(opId, { state: 'unknown', error: result.reason });
        break;
      case 'failed':
        // back to pending, for the next replay. A send is safe here: its phase says what is
        // left (I1) - none: nothing went out; 'sent': only filing into Sent, never SMTP again
        if (op.state === 'done') break;
        e.store.journalUpdate(opId, { state: 'pending', error: result.reason });
        // I3 (MR-29): its effect is on screen already, so it is tried again soon, not at the next start
        if (autoRetryable(e.store.journalGet(opId)!)) this.scheduleRetry(e.config.id);
        break;
    }
  }

  async replayPendingOps(accountId?: string): Promise<{ replayed: number; results: Record<string, string> }> {
    const e = this.writableEntry(accountId);
    // I1 (MR-03): an unknown send is probed too - by Message-ID, it is never sent again
    const ops = [...e.store.journalPending(100), ...e.store.journalUnknownSends(20)];
    const results: Record<string, string> = {};
    for (const listed of ops) {
      // re-read: an earlier op of this loop may have taken long enough for this one to
      // be settled by now (execute() itself shares an op that is still queued)
      const op = e.store.journalGet(listed.id);
      if (!op) continue;
      const unknownSend = op.kind === 'send' && op.state === 'unknown';
      if (!unknownSend && op.state !== 'pending' && op.state !== 'running') continue;
      // I1 (MR-02): one op that throws must not stop the others
      try {
        const result = await this.ctx.runOp(e, op);
        results[op.id] = result.outcome;
      } catch (error) {
        results[op.id] = 'failed';
        this.log.warn?.(`replay of op ${op.id} (${op.kind}) threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { replayed: ops.length, results };
  }

  async listOps(accountId?: string): Promise<OpSummary[]> {
    const e = this.entry(accountId);
    return e.store.journalListRecent(100).map(op => this.opToSummary(op));
  }

  /** I3: every op not done or cancelled, however old, for the op panel. */
  async listOpenOps(accountId?: string): Promise<OpSummary[]> {
    return this.entry(accountId).store.journalOpen(200).map(op => this.opToSummary(op));
  }

  /**
   * I3 (MR-29): run the failed ops again, so a hidden mail or a local flag does not wait for
   * the next start. Only while the sync reports the account online: offline, the sync's own
   * retry finds out when the server is back, and a refused login is final. Returns how many
   * ops are still waiting.
   */
  async retryFailedOps(accountId?: string): Promise<number> {
    const e = this.writableEntry(accountId);
    const waiting = () => e.store.journalFailedPending(200).filter(autoRetryable);
    for (const listed of waiting()) {
      if (e.engine.getStatus().connection !== 'online') break;
      // re-read: the user may have retried or cancelled it while an earlier op ran
      const op = e.store.journalGet(listed.id);
      if (!op || !autoRetryable(op) || e.writes.isInFlight(op.id)) continue;
      try {
        await this.ctx.runOp(e, op);
      } catch (error) {
        this.log.warn?.(`retry of op ${op.id} (${op.kind}) threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return waiting().length;
  }

  /** I3 (MR-29): the next automatic retry; every round that leaves ops waiting doubles the pause. */
  private scheduleRetry(accountId: string): void {
    if (this.closed || this.retryTimers.has(accountId)) return;
    const round = this.retryRounds.get(accountId) ?? 0;
    const timer = setTimeout(() => {
      this.retryTimers.delete(accountId);
      // counted before the run: an op failing in it schedules the next round already
      this.retryRounds.set(accountId, round + 1);
      void this.retryFailedOps(accountId).then(left => {
        if (left) this.scheduleRetry(accountId);
        else this.retryRounds.delete(accountId);
      }).catch(err => this.log.warn?.(`automatic retry (${accountId}) failed: ${(err as Error).message}`));
    }, retryDelay(round));
    timer.unref?.();
    this.retryTimers.set(accountId, timer);
  }

  async getOpCounts(accountId?: string): Promise<Record<string, number>> {
    return this.entry(accountId).store.journalCountByState();
  }

  async retryOp(opId: string, accountId?: string): Promise<OpResult> {
    const e = this.writableEntry(accountId);
    const op = e.store.journalGet(opId);
    if (!op) throw new Error(`op ${opId} not found`);
    if (op.state !== 'failed' && op.state !== 'conflict' && op.state !== 'pending' && op.state !== 'unknown') {
      throw new Error(`op ${opId} is ${op.state}; only failed/conflict/pending/unknown ops can be retried`);
    }
    // I1 (MR-05): a send the server may already have is checked, never retried. Sending it
    // again is an explicit new mail.
    if (op.kind === 'send' && (op.state === 'unknown' || sendPhase(op) === 'smtp')) {
      throw new Error(`op ${opId} is a send with an unclear outcome; use resolveOp to check it`);
    }
    e.store.journalUpdate(opId, { state: 'pending', error: undefined });
    return this.ctx.runOp(e, e.store.journalGet(opId)!);
  }

  async resolveOp(opId: string, accountId?: string): Promise<OpResult> {
    const e = this.writableEntry(accountId);
    const op = e.store.journalGet(opId);
    if (!op) throw new Error(`op ${opId} not found`);
    const unresolved = op.state === 'unknown' || (op.state === 'conflict' && sendPhase(op) === 'smtp');
    if (op.kind !== 'send' || !unresolved) throw new Error(`op ${opId} is not an unresolved send`);
    return this.ctx.runOp(e, op);
  }

  /**
   * Take an op out of the journal: a pending one before it runs, or (I3) one the user gives
   * up on - a conflict, a failed one waiting for its retry, an unclear send (the panel asks
   * first; the server may have it). Never one that is running. Its folders are resynced, so
   * an optimistic effect (a hidden mail, a local flag) gives way to what the server has.
   */
  async cancelOp(opId: string, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const op = e.store.journalGet(opId);
    if (!op) throw new Error(`op ${opId} not found`);
    if (op.state !== 'pending' && op.state !== 'conflict' && op.state !== 'failed' && op.state !== 'unknown') {
      throw new Error(`op ${opId} is ${op.state}; only pending, conflict, failed or unknown ops can be cancelled`);
    }
    if (e.writes.isInFlight(opId)) throw new Error(`op ${opId} is running; cancel it once it has settled`);
    e.store.journalUpdate(opId, { state: 'cancelled' });
    for (const path of foldersToResync([op])) e.writes.requestResync(path);
  }

  async undoOp(opId: string, accountId?: string): Promise<string> {
    const e = this.writableEntry(accountId);
    const op = e.store.journalGet(opId);
    if (!op) throw new Error(`op ${opId} not found`);
    if (op.state !== 'done') throw new Error(`op ${opId} is ${op.state}; only done ops can be undone`);
    let inverse: Parameters<Store['journalEnqueue']>[0];
    if (op.kind === 'flag') {
      const payload = JSON.parse(op.payload || '{}') as { add: string[]; remove: string[] };
      inverse = {
        accountId: e.config.id, kind: 'flag',
        folderPath: op.folder_path ?? undefined, folderUidValidity: op.folder_uidvalidity ?? undefined,
        uid: op.uid ?? undefined, messageKey: op.message_key ?? undefined, messageId: op.message_id ?? undefined,
        payload: { add: payload.remove, remove: payload.add },
      };
    } else if (op.kind === 'move' || op.kind === 'delete') {
      // a move re-keys the row for its destination and records the new key
      // (ops from before that only have the old one)
      const moved = (JSON.parse(op.payload || '{}') as { movedTo?: { messageKey?: string } }).movedTo;
      const key = moved?.messageKey ?? op.message_key;
      const current = key ? e.store.db.prepare(
        'SELECT uid, folder_id FROM messages WHERE message_key = ?').get(key) as
        { uid: number; folder_id: string } | undefined : undefined;
      if (!current) throw new Error('undo: message no longer in local store (resync needed)');
      const currentFolder = e.store.getFolder(current.folder_id);
      if (!currentFolder) throw new Error('undo: current folder not found');
      inverse = {
        accountId: e.config.id, kind: 'move',
        folderPath: currentFolder.imap_path, folderUidValidity: currentFolder.uid_validity ?? undefined,
        uid: current.uid, messageKey: key ?? undefined, messageId: op.message_id ?? undefined,
        targetFolderPath: op.folder_path ?? undefined,
      };
    } else if (op.kind === 'move_batch') {
      // B4: the whole group goes back in one op, the same way it came.
      // The rows are keyed by the uid the MOVE gave them, which is `destUid`.
      const payload = JSON.parse(op.payload || '{}') as { movedTo?: BatchMoved[] };
      const members: BatchMember[] = (payload.movedTo ?? [])
        .map(m => {
          // the row is keyed by the uid the MOVE gave it, not the source key
          const key = m.newKey ?? m.messageKey;
          const row = e.store.db.prepare(
            'SELECT uid FROM messages WHERE message_key = ?').get(key) as
            { uid: number } | undefined;
          return row ? { uid: row.uid, messageKey: key, messageId: null as string | null } : null;
        })
        .filter((m): m is BatchMember => m !== null);
      if (members.length === 0) throw new Error('undo: none of the moved mails is in the local store (resync needed)');
      const backFolder = e.store.getFolderByPath(op.target_folder_path ?? '');
      inverse = {
        accountId: e.config.id, kind: 'move_batch',
        folderPath: op.target_folder_path ?? undefined,
        folderUidValidity: backFolder?.uid_validity ?? undefined,
        targetFolderPath: op.folder_path ?? undefined,
        payload: { members },
      };
    } else if (op.kind === 'folder_create') {
      // B1: undo a create by deleting the folder again (only while it is empty). I8 (MR-06):
      // the same checks as deleteFolder - mail moved in since would go with the folder.
      const payload = JSON.parse(op.payload || '{}') as { path?: string; delimiter?: string };
      if (!payload.path) throw new Error('undo: folder_create without path');
      this.refuseFolderDelete(e, payload.path);
      inverse = {
        accountId: e.config.id, kind: 'folder_delete',
        folderPath: payload.path,
        payload: { path: payload.path },
      };
    } else if (op.kind === 'folder_rename') {
      // B1: undo a rename by renaming it back
      const payload = JSON.parse(op.payload || '{}') as { from?: string; to?: string; delimiter?: string };
      if (!payload.from || !payload.to) throw new Error('undo: folder_rename without from/to');
      inverse = {
        accountId: e.config.id, kind: 'folder_rename',
        folderPath: payload.to,
        payload: { from: payload.to, to: payload.from, delimiter: payload.delimiter },
      };
    } else if (op.kind === 'folder_delete') {
      // B1: undo a delete by creating the folder again (empty)
      const payload = JSON.parse(op.payload || '{}') as { path?: string };
      if (!payload.path) throw new Error('undo: folder_delete without path');
      inverse = {
        accountId: e.config.id, kind: 'folder_create',
        folderPath: payload.path,
        payload: { path: payload.path },
      };
    } else {
      throw new Error(`undo not supported for ${op.kind}`);
    }
    const newId = e.store.journalEnqueue(inverse);
    await this.replayOps(e, [newId]);
    if (inverse.kind === 'folder_delete') this.throwIfServerRefusedDelete(e, newId);
    return newId;
  }

  async expungeFromTrash(ids: number[], accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const trash = e.store.allFolders().find(f => f.special_use === '\\Trash');
    if (!trash) throw new Error('no Trash folder found');
    const opIds: string[] = [];
    for (const id of ids) {
      const row = e.store.getMessage(id);
      if (!row) continue;
      if (row.folder_id !== trash.id) throw new Error('expunge refused: message not in Trash');
      opIds.push(e.store.journalEnqueue({
        accountId: e.config.id, kind: 'expunge',
        folderPath: trash.imap_path, folderUidValidity: trash.uid_validity ?? undefined,
        uid: row.uid, messageKey: row.message_key, messageId: row.message_id ?? undefined,
      }));
    }
    await this.replayOps(e, opIds);
  }

  opToSummary(op: JournalRow): OpSummary {
    return {
      id: op.id, kind: op.kind, state: op.state,
      folderPath: op.folder_path, targetFolderPath: op.target_folder_path,
      uid: op.uid, messageId: op.message_id, attempts: op.attempts,
      createdAt: op.created_at, updatedAt: op.updated_at, error: op.error,
      // I3: the panel tells an unclear send from a refused one; the payload itself never leaves
      ...(op.kind === 'send' ? { sendPhase: sendPhase(op) ?? null } : {}),
    };
  }
}
