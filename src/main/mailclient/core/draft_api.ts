// R2: the draft and send calls of MailCore, out of core/index.ts: save, send, delete, discard
// and read back a draft, building the MIME (with a forwarded mail's attachments) and finding
// the Drafts folder. MailCore keeps one-line delegations, and a send runs through its runOp.
import type { JournalRow } from './store.js';
import type { OpResult } from './write_engine.js';
import type { DraftInput, SavedDraft } from './types.js';
import { composeMime, ComposeError, SEND_KEY, type ComposedMime } from './compose.js';
import { parseStoredMessage } from './parse.js';
import { sendPhase } from './op_retry.js';
import type { AccountEntry } from './index.js';

/** What the draft calls need from the core. */
export interface DraftApiContext {
  readonly clock: () => number;
  entry(id?: string): AccountEntry;
  writableEntry(id?: string): AccountEntry;
  /** The core's runOp: a test replaces it on the instance, so every run goes through it. */
  runOp(e: AccountEntry, op: JournalRow): Promise<OpResult>;
  replayOps(e: AccountEntry, opIds: string[]): Promise<void>;
  planFlagOp(e: AccountEntry, ids: number[], delta: { add?: string[]; remove?: string[] }): string[];
  resyncMovedFolders(e: AccountEntry, opIds: string[]): void;
}

export class DraftApi {
  constructor(private readonly ctx: DraftApiContext) {}

  private get clock(): () => number { return this.ctx.clock; }
  private entry(id?: string): AccountEntry { return this.ctx.entry(id); }
  private writableEntry(id?: string): AccountEntry { return this.ctx.writableEntry(id); }
  private runOp(e: AccountEntry, op: JournalRow): Promise<OpResult> { return this.ctx.runOp(e, op); }
  private replayOps(e: AccountEntry, opIds: string[]): Promise<void> { return this.ctx.replayOps(e, opIds); }
  private planFlagOp(e: AccountEntry, ids: number[], delta: { add?: string[]; remove?: string[] }): string[] { return this.ctx.planFlagOp(e, ids, delta); }
  private resyncMovedFolders(e: AccountEntry, opIds: string[]): void { this.ctx.resyncMovedFolders(e, opIds); }

  async saveDraft(draft: DraftInput, replaceUid?: number | null, accountId?: string): Promise<number> {
    const e = this.writableEntry(accountId);
    const draftsFolder = this.draftsFolder(e);
    const { raw, messageId } = await this.buildMimeMessage(e, draft, { draft: true });
    const oldUid = replaceUid ?? undefined;
    // I17 (write path L7): the editor's session key ties its saves together, so a replayed older
    // save does not come back over a newer one (see doDraftSave). It never becomes a Message-ID here.
    const composeKey = draft.sendKey && SEND_KEY.test(draft.sendKey) ? draft.sendKey : undefined;
    const opId = e.store.journalEnqueue({
      // I1 (MR-15): the Message-ID lets a replay find a copy the APPEND already left
      accountId: e.config.id, kind: 'draft_save', messageId, composeKey,
      folderPath: draftsFolder.imap_path, folderUidValidity: draftsFolder.uid_validity ?? undefined,
      uid: oldUid,
      payload: { mime: raw.toString('base64'), oldUid },
    });
    e.store.journalUpdate(opId, { state: 'running' });
    const op = e.store.journalGet(opId)!;
    const result = await this.runOp(e, op);
    const updated = e.store.journalGet(opId);
    const appendedUid = updated ? (JSON.parse(updated.payload || '{}') as { appendedUid?: number }).appendedUid : undefined;
    if (!appendedUid) {
      // the editor still holds the draft and saves it again; a queued copy would come back later
      e.store.journalUpdate(opId, { state: 'cancelled' });
      throw new Error(`draft not saved: ${'reason' in result ? result.reason : result.outcome}`);
    }
    e.writes.requestResync(draftsFolder.imap_path);
    return appendedUid;
  }

  async sendMail(mail: DraftInput, draftUid?: number | null, accountId?: string): Promise<{ messageId: string }> {
    const e = this.writableEntry(accountId);
    if (!mail.to.length && !mail.cc.length && !mail.bcc.length) throw new ComposeError('Kein Empfänger angegeben');
    const { raw, messageId } = await this.buildMimeMessage(e, mail, { draft: false });
    const head = raw.subarray(0, raw.indexOf('\r\n\r\n')).toString('latin1');
    if (/^Bcc:/im.test(head)) throw new Error('internal: Bcc header in a mail to send');
    const envelope = {
      from: e.options.email ?? e.config.user,
      to: mail.to.map(a => a.email),
      cc: mail.cc.map(a => a.email),
      bcc: mail.bcc.map(a => a.email),
    };
    const sentFolder = e.store.allFolders().find(f => f.special_use === '\\Sent')
      ?? e.store.getFolderByPath('Gesendete Objekte');
    const draftsFolder = draftUid != null ? this.draftsFolder(e) : null;
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'send', messageId,
      payload: {
        mime: raw.toString('base64'), messageId, envelope,
        sentFolderPath: sentFolder?.imap_path ?? null,
        draft: draftsFolder && { path: draftsFolder.imap_path, uid: draftUid, uidValidity: draftsFolder.uid_validity },
      },
    });
    e.store.journalUpdate(opId, { state: 'running' });
    const op = e.store.journalGet(opId)!;
    // the 'running' event is emitted by runOp, so a send and a move look the same to the UI
    const result = await this.runOp(e, op);
    const after = e.store.journalGet(opId);
    // I1 (MR-43): phase 'sent' means the server took the mail and only filing into Sent
    // failed. That op stays pending, the next replay files it; for the user it is sent.
    const delivered = !!after && sendPhase(after) === 'sent';
    if (result.outcome === 'failed' && after?.state !== 'done' && !delivered) {
      // refused before the server took it: nothing went out, the editor stays open with
      // the mail, and sending again is a new op (a queued one would go out unasked later)
      e.store.journalUpdate(opId, { state: 'cancelled' });
      throw new Error(`Senden fehlgeschlagen: ${result.reason}`);
    }
    if (result.outcome === 'conflict' || result.outcome === 'unknown') {
      throw new Error(`Versand unklar, bitte im Ordner Gesendet prüfen: ${result.reason}`);
    }
    if (sentFolder) e.writes.requestResync(sentFolder.imap_path);
    if (draftsFolder) e.writes.requestResync(draftsFolder.imap_path);
    if (mail.repliesTo != null) {
      // best effort: the reply is out either way
      await this.replayOps(e, this.planFlagOp(e, [mail.repliesTo], { add: ['\\Answered'] })).catch(() => { });
    }
    return { messageId };
  }

  private draftsFolder(e: AccountEntry) {
    const folder = e.store.allFolders().find(f => f.special_use === '\\Drafts')
      ?? e.store.getFolderByPath('Entwürfe');
    if (!folder) throw new Error('no Drafts folder found');
    return folder;
  }

  async deleteDraft(id: number, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`draft ${id} not found`);
    const folder = e.store.getFolder(row.folder_id);
    if (!folder) throw new Error('draft folder not found');
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'draft_delete',
      folderPath: folder.imap_path, folderUidValidity: folder.uid_validity ?? undefined,
      uid: row.uid, messageKey: row.message_key, messageId: row.message_id ?? undefined,
      targetFolderPath: e.store.allFolders().find(f => f.special_use === '\\Trash')?.imap_path ?? 'Trash',
    });
    await this.replayOps(e, [opId]);
  }

  async discardDraft(uid: number, accountId?: string): Promise<void> {
    const e = this.writableEntry(accountId);
    const folder = this.draftsFolder(e);
    // G4: the message key is what the read-side exclusion matches on (L2), so a discarded draft
    // leaves the Drafts list at once instead of after the server answered. Without it the op was
    // invisible to that filter and the draft lingered - the same lag as before, only in the list.
    const row = e.store.db
      .prepare('SELECT message_key, message_id FROM messages WHERE folder_id = ? AND uid = ?')
      .get(folder.id, uid) as { message_key: string; message_id: string | null } | undefined;
    const opId = e.store.journalEnqueue({
      accountId: e.config.id, kind: 'draft_delete',
      folderPath: folder.imap_path, folderUidValidity: folder.uid_validity ?? undefined, uid,
      messageKey: row?.message_key, messageId: row?.message_id ?? undefined,
      targetFolderPath: e.store.allFolders().find(f => f.special_use === '\\Trash')?.imap_path ?? 'Trash',
    });
    await this.replayOps(e, [opId]);
    // G4: the draft moved, so the two folders it touched need a resync - not the whole mailbox
    this.resyncMovedFolders(e, [opId]);
  }

  async getDraft(id: number, accountId?: string): Promise<SavedDraft> {
    const e = this.entry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`draft ${id} not found`);
    // from the stored source, not the row: the row has no Bcc and no attachment content
    const parsed = await parseStoredMessage(e.store, row.file_path);
    const list = (field: typeof parsed.to) => (Array.isArray(field) ? field : field ? [field] : [])
      .flatMap(a => a.value)
      .filter(a => a.address)
      .map(a => ({ name: a.name || '', email: a.address! }));
    const refs = parsed.references;
    return {
      id,
      uid: row.uid,
      to: list(parsed.to),
      cc: list(parsed.cc),
      bcc: list(parsed.bcc),
      subject: parsed.subject ?? '',
      bodyText: parsed.text ?? '',
      bodyHtml: parsed.html || null,
      inReplyTo: parsed.inReplyTo ?? null,
      references: Array.isArray(refs) ? refs : refs ? refs.split(/\s+/).filter(Boolean) : [],
      attachments: (parsed.attachments || [])
        .filter(a => a.contentDisposition !== 'inline' || !a.contentId)
        .map(a => ({ filename: a.filename || 'Anhang', contentType: a.contentType, base64: a.content.toString('base64') })),
    };
  }

  private async buildMimeMessage(e: AccountEntry, mail: DraftInput, opts: { draft: boolean }): Promise<ComposedMime> {
    const extraAttachments = mail.forwardsFrom != null ? await this.attachmentsOf(e, mail.forwardsFrom) : [];
    return composeMime(mail, {
      from: { name: '', email: e.options.email ?? e.config.user },
      date: new Date(this.clock()),
      draft: opts.draft,
      extraAttachments,
    });
  }

  /** The attachments of a stored message as files, inline images (part of its HTML) left out */
  private async attachmentsOf(e: AccountEntry, id: number): Promise<{ filename: string; contentType: string; content: Buffer }[]> {
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    const parsed = await parseStoredMessage(e.store, row.file_path);
    return (parsed.attachments || [])
      .filter(a => a.contentDisposition !== 'inline' || !a.contentId)
      .map(a => ({ filename: a.filename || 'Anhang', contentType: a.contentType, content: a.content }));
  }
}
