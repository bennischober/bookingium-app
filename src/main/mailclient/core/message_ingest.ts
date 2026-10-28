// R1: storing one downloaded message, out of SyncEngine: the crash-safe file, the parsed row,
// the pass's move correlation and the contacts it teaches. Folder sync, IDLE and the write
// engine's appended drafts all store through here.
import { parseMessage, type ParsedMessage } from './parse.js';
import crypto from 'crypto';
import fs from 'fs';
import type { Flags, Store } from './store.js';
import { writeMessageFile } from './files.js';
import type { AccountConfig } from './sync.js';

/** What storing needs from the engine. */
export interface MessageIngestContext {
  readonly account: AccountConfig;
  readonly store: Store;
  readonly log: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void };
  /** The running pass's new Message-IDs; a new pass replaces the set, so it is read on every use. */
  passInsertedMsgIds(): Set<string>;
}

export class MessageIngest {
  constructor(
    private readonly ctx: MessageIngestContext,
    /** Testing seam: the worker sets options.faultWriteCode to exercise the disk-full path for real. */
    private readonly faultWriteCode: string | undefined,
  ) {}

  private get account(): AccountConfig { return this.ctx.account; }
  private get store(): Store { return this.ctx.store; }
  private get log(): MessageIngestContext['log'] { return this.ctx.log; }
  private get passInsertedMsgIds(): Set<string> { return this.ctx.passInsertedMsgIds(); }

  /**
   * G5: store an appended draft locally at once, using the same parse/insert path as a synced mail.
   *
   * A saved draft used to have NO local row: it only appeared after the IMAP APPEND finished AND the
   * Drafts folder had been resynced, which re-downloaded the message the client had just uploaded.
   * On a real server that is the delay the person saw - the draft was on the server but invisible
   * in the list. Storing it here is the same work the resync would do, without the round-trip.
   */
  async storeAppendedDraft(
    folderId: string,
    uidValidity: string,
    uid: number,
    source: Buffer,
    flags?: Set<string>
  ): Promise<void> {
    // I17 (write path L6): a draft the client just appended is not mail the sync pass found,
    // so it stays out of the pass's move correlation
    await this.storeMessage(folderId, uidValidity, { uid, source, flags }, { outsidePass: true });
  }

  /** Testing seam: the worker sets options.faultWriteCode to exercise the disk-full path for real. */
  private faultWrite(): void {
    if (this.faultWriteCode) throw Object.assign(new Error(`injected write failure (${this.faultWriteCode})`), { code: this.faultWriteCode });
  }

  /**
   * `msg.partSizes`: S1, `source` is the message's skeleton. The row is stored incomplete, with the
   * server size (`msg.size`) and each attachment's estimated size by `partId`.
   * `keyFolderId`: the folder the message_key is derived from, when the row is staged under
   * another folder. `existingPath`: I12, a re-linked file that is adopted instead of written;
   * it is never removed here, because the re-link entry still names it.
   */
  async storeMessage(folderId: string, uidValidity: string, msg: {
    uid: number; source: Buffer; flags?: Set<string>; internalDate?: Date | string; modseq?: bigint; size?: number;
    partSizes?: Map<string, number>;
  }, opts: { keyFolderId?: string; existingPath?: string; outsidePass?: boolean } = {}): Promise<void> {
    if (!msg.source) return;
    if (!opts.existingPath) this.faultWrite();
    const key = this.store.messageKey(this.account.id, opts.keyFolderId ?? folderId, uidValidity, msg.uid);
    // idempotency: the IDLE connection and the main sync connection may both reach the
    // same new UID (message_key is UNIQUE) — the second one must be a no-op, not an error.
    if (this.store.getByKey(key)) return;
    // A3: opaque, permanent file name, written crash-safely (tmp -> fsync -> rename).
    // The row points at a file that exists: if the rename keeps failing, the file stays
    // under its .tmp name and that name is what the row stores.
    const relPath = opts.existingPath ?? writeMessageFile(this.store.dataDirResolved, msg.source);
    const dropFile = () => { if (!opts.existingPath) this.removeFile(relPath); };
    // S1: a skeleton row keeps the server size, so the move check and the swap estimate stay right
    const partial = msg.partSizes;
    const sizeBytes = partial ? msg.size ?? msg.source.length : msg.source.length;
    const complete = partial ? 0 : 1;

    let parsed: ParsedMessage;
    try {
      parsed = await parseMessage(msg.source);
    } catch (e) {
      // insert minimal row so the message is not silently lost
      const flags = flagsFromSet(msg.flags);
      try {
        this.store.insertMessage({
          account_id: this.account.id, folder_id: folderId, uid: msg.uid, message_key: key, file_path: relPath,
          message_id: null, in_reply_to: null, references_json: '[]', thread_id: null,
          date: toIso(msg.internalDate), internal_date: toIso(msg.internalDate),
          subject: '', from_name: '', from_email: '', to_json: '[]', cc_json: '[]', bcc_json: '[]',
          flags_json: JSON.stringify(flags), modseq: msg.modseq !== undefined ? String(msg.modseq) : null,
          has_attachments: 0, attachments_json: '[]', size_bytes: sizeBytes,
          body_text: '', body_html: null, snippet: '', parsed_ok: 0, parse_error: (e as Error).message, complete,
        });
      } catch (insertError) {
        // the other connection won the UNIQUE race: our file belongs to no row
        dropFile();
        if (!/UNIQUE/i.test((insertError as Error).message)) throw insertError;
      }
      return;
    }

    const flags = flagsFromSet(msg.flags);
    const from = addrList(parsed.from)[0] || { name: '', email: '' };
    const refs = parseReferences(parsed.references);
    const threadId = computeThreadId(parsed, refs);
    const messageId = parsed.messageId || null;
    if (messageId && !opts.outsidePass) this.passInsertedMsgIds.add(messageId);

    try {
      this.store.insertMessage({
        account_id: this.account.id, folder_id: folderId, uid: msg.uid, message_key: key, file_path: relPath,
        message_id: messageId,
        in_reply_to: parsed.inReplyTo || null,
        references_json: JSON.stringify(refs),
        thread_id: threadId,
        date: parsed.date && !isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : toIso(msg.internalDate),
        internal_date: toIso(msg.internalDate),
        subject: parsed.subject || '',
        from_name: from.name, from_email: from.email,
        to_json: JSON.stringify(addrList(parsed.to)),
        cc_json: JSON.stringify(addrList(parsed.cc)),
        bcc_json: JSON.stringify(addrList(parsed.bcc)),
        flags_json: JSON.stringify(flags),
        modseq: msg.modseq !== undefined ? String(msg.modseq) : null,
        ...attachmentColumns(parsed, partial),
        size_bytes: sizeBytes,
        complete,
        body_text: (parsed.text || '').slice(0, 1_000_000),
        body_html: parsed.html ? parsed.html.slice(0, 5_000_000) : null,
        snippet: (parsed.text || '').replace(/\s+/g, ' ').slice(0, 200),
        parsed_ok: 1, parse_error: null,
      });
    } catch (insertError) {
      // the other connection won the UNIQUE race: our file belongs to no row
      dropFile();
      if (!/UNIQUE/i.test((insertError as Error).message)) throw insertError;
      return;
    }
    // G9: every stored mail teaches the compose lookup who you correspond with. Cheap (one
    // upsert per address, keyed by email) and it is what makes "ionos" find the sender.
    // I12 (MR-42): the row is committed by now, so a failed upsert must not take its file
    // away - contacts are a convenience and are not worth a row without a file.
    try {
      this.store.rememberContactsOf({
        from_email: from.email,
        from_name: from.name,
        to_json: JSON.stringify(addrList(parsed.to)),
        cc_json: JSON.stringify(addrList(parsed.cc)),
      });
    } catch (err) {
      this.log.warn?.(`contacts upsert failed: ${(err as Error).message}`);
    }
  }

  /** Best-effort removal of a message file this engine just wrote (A3 step 2). */
  private removeFile(relPath: string): void {
    try {
      fs.unlinkSync(this.store.filePath(relPath));
    } catch { /* already gone, or held by another process: the sweep retries */ }
  }
}

// ---------- helpers ----------

/**
 * A row's attachment columns from a parse. `partSizes` (S1, a skeleton): its attachment bodies are
 * empty (an attached message's cut down), so each size is BODYSTRUCTURE's estimate by `partId`.
 */
export function attachmentColumns(parsed: ParsedMessage, partSizes?: Map<string, number>): { has_attachments: number; attachments_json: string } {
  const list = parsed.attachments || [];
  return {
    has_attachments: list.length > 0 ? 1 : 0,
    attachments_json: JSON.stringify(list.map(a => ({
      partId: a.partId || '', filename: a.filename || '', contentType: a.contentType || '',
      size: (partSizes?.get(a.partId || '') ?? a.size) || 0, isInline: /inline/i.test(a.contentDisposition || '') || false,
      contentId: a.contentId || null,
    }))),
  };
}

export function flagsFromSet(set: Set<string> | undefined): Flags {
  const s = set || new Set<string>();
  return {
    seen: s.has('\\Seen'),
    flagged: s.has('\\Flagged'),
    draft: s.has('\\Draft'),
    deleted: s.has('\\Deleted'),
    answered: s.has('\\Answered'),
  };
}

export function toIso(d: Date | string | undefined | null): string | null {
  if (!d) return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d.toISOString();
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function addrList(a: unknown): { name: string; email: string }[] {
  if (!a) return [];
  const obj = a as { value?: { name?: string; address?: string }[] };
  const arr = Array.isArray(obj)
    ? obj as unknown as { name?: string; address?: string }[]
    : (obj.value || []);
  return arr
    .map(x => ({ name: x.name || '', email: (x.address || '').toLowerCase() }))
    .filter(x => x.email || x.name);
}

function parseReferences(ref: unknown): string[] {
  if (!ref) return [];
  if (Array.isArray(ref)) return ref.map(String);
  return String(ref).split(/\s+/).filter(Boolean);
}

function computeThreadId(parsed: { messageId?: string; subject?: string }, refs: string[]): string | null {
  // thread root = first reference; else own message-id; else normalized subject
  if (refs.length) return crypto.createHash('sha1').update(refs[0]).digest('hex').slice(0, 16);
  if (parsed.messageId) return crypto.createHash('sha1').update(parsed.messageId).digest('hex').slice(0, 16);
  const norm = (parsed.subject || '').replace(/^(aw|re|fwd?|wg)\s*:\s*/gi, '').trim().toLowerCase();
  return norm ? crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16) : null;
}
