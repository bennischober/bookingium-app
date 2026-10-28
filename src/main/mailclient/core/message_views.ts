// R2: the read side of MailCore, out of core/index.ts: folders, lists, threads, a message with
// its raw source, attachments and remote images, search, the headers and lookups mail linking
// reads, contacts, and the row-to-DTO mapping they share. MailCore keeps one-line delegations.
import fs from 'fs';
import { STAGING_PREFIX } from './store.js';
import { sanitizeEmailHtml } from './sanitize.js';
import { fetchRemoteImagesAsDataUris } from './remote_images.js';
import { parseStoredMessage } from './parse.js';
import { messageFallbackKey, normalizeMessageId } from './message_keys.js';
import type { MessageHeader, HeaderPage, FolderNode, MessageListItem, MessageDetail, SearchFilters, SearchResult, RemoteImageRef, AttachmentInfo, ThreadSummary } from './types.js';
import type { AccountEntry, MailCoreEvent, MailCoreOptions } from './index.js';

/** What the read calls need from the core. */
export interface MessageViewsContext {
  readonly options: MailCoreOptions;
  entry(id?: string): AccountEntry;
  emitEvent(e: MailCoreEvent): void;
}

export class MessageViews {
  constructor(private readonly ctx: MessageViewsContext) {}

  private get options(): MailCoreOptions { return this.ctx.options; }
  private entry(id?: string): AccountEntry { return this.ctx.entry(id); }
  private emitEvent(e: MailCoreEvent): void { this.ctx.emitEvent(e); }

  async listThreads(folderId: string | null, opts: { offset: number; limit: number }, accountId?: string): Promise<ThreadSummary[]> {
    const e = this.entry(accountId);
    return e.store.listThreads(folderId, opts.offset, opts.limit).map(t => ({
      threadId: t.threadId, count: t.count, subject: t.subject, fromName: t.fromName,
      date: t.date, unread: t.unread, hasAttachments: t.hasAttachments,
      snippet: t.snippet, messageIds: t.messageIds,
    }));
  }

  async getFolders(accountId?: string): Promise<FolderNode[]> {
    const e = this.entry(accountId);
    const store = e.store;
    // I12: a UIDVALIDITY swap's staging folder is internal until it is swapped in
    const flat = store.allFolders().filter(f => !f.imap_path.startsWith(STAGING_PREFIX)).map(f => {
      const counts = store.countByFolder(f.id);
      return {
        id: f.id,
        path: f.imap_path,
        name: f.imap_path.split(f.delimiter).pop() || f.imap_path,
        delimiter: f.delimiter,
        specialUse: f.special_use,
        unreadCount: counts.unread,
        totalCount: counts.total,
        children: [] as FolderNode[],
      };
    });
    const byPath = new Map(flat.map(f => [f.path, f]));
    const roots: FolderNode[] = [];
    for (const f of flat) {
      const sep = f.path.lastIndexOf(f.delimiter);
      if (sep > 0) {
        const parentPath = f.path.slice(0, sep);
        const parent = byPath.get(parentPath);
        if (parent) { parent.children.push(f); continue; }
      }
      roots.push(f);
    }
    const order = (n: FolderNode) => {
      if (n.specialUse?.includes('Inbox')) return 0;
      if (n.specialUse?.includes('Drafts')) return 1;
      if (n.specialUse?.includes('Sent')) return 2;
      if (n.specialUse?.includes('Archive')) return 3;
      if (n.specialUse?.includes('Junk')) return 4;
      if (n.specialUse?.includes('Trash')) return 5;
      return 10;
    };
    const sortRec = (nodes: FolderNode[]) => {
      nodes.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
      for (const n of nodes) sortRec(n.children);
    };
    sortRec(roots);
    return roots;
  }

  async listMessages(folderId: string, opts: { offset: number; limit: number }, accountId?: string): Promise<MessageListItem[]> {
    return this.entry(accountId).store.listByFolder(folderId, opts.offset, opts.limit).map(r => this.toListItem(r));
  }

  async getMessage(id: number, accountId?: string): Promise<MessageDetail> {
    const e = this.entry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    return this.toDetail(e, row, null);
  }

  async getRawEml(id: number, accountId?: string): Promise<Uint8Array> {
    const e = this.entry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    return new Uint8Array(fs.readFileSync(e.store.filePath(row.file_path)));
  }

  async getAttachment(id: number, partId: string, accountId?: string): Promise<Uint8Array> {
    const e = this.entry(accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    const parsed = await parseStoredMessage(e.store, row.file_path);
    const att = (parsed.attachments || []).find(a => a.partId === partId);
    if (!att) throw new Error(`attachment ${partId} not found in message ${id}`);
    return new Uint8Array(att.content);
  }

  async loadRemoteImages(id: number, remoteImages: RemoteImageRef[], accountId?: string): Promise<MessageDetail> {
    const e = this.entry(accountId);
    if (!this.options.remoteImages?.enabled) return this.getMessage(id, accountId);
    const row = e.store.getMessage(id);
    if (!row) throw new Error(`message ${id} not found`);
    const { enabled: _enabled, ...fetchOpts } = this.options.remoteImages;
    void _enabled;   // destructured only to drop it from fetchOpts
    // I11 (MR-22): only URLs the stored mail itself references. The caller's list narrows that
    // set, it never extends it - a renderer cannot point this fetcher at an address of its choice.
    const stored = new Set(row.body_html ? sanitizeEmailHtml(row.body_html).remoteImages.map(r => r.url) : []);
    const requested = remoteImages.filter(r => stored.has(r.url));
    const fetched = await fetchRemoteImagesAsDataUris(requested.map(r => r.url), {
      ...fetchOpts,
      // G10: report progress through the same event channel the UI already subscribes to,
      // so a 72-image mail shows how far it has got instead of an opaque spinner
      onProgress: (done, total) => this.emitEvent({
        type: 'image-progress', accountId: e.config.id, messageId: id, done, total,
      }),
    });
    const loaded: RemoteImageRef[] = requested
      .filter(r => fetched.has(r.url))
      .map(r => ({ url: r.url, placeholder: fetched.get(r.url)! }));
    return this.toDetail(e, row, loaded.length ? loaded : null);
  }

  async search(filters: SearchFilters, accountId?: string): Promise<SearchResult> {
    const e = this.entry(accountId);
    const store = e.store;
    const t0 = performance.now();
    const matchExpr = filters.query?.trim()
      ? store.capPathologicalPrefixes(store.ftsEscapeUserQuery(filters.query))
      : null;
    // MR-27: a query whose terms were all dropped (too short, capped, or operators alone) finds
    // nothing. An empty MATCH would mean "no text filter" and list every mail.
    if (matchExpr === '') {
      const none: SearchResult = { items: [], total: 0, elapsedMs: 0, snippetMap: {} };
      if (filters.wantFacets) none.facets = [];
      none.elapsedMs = Math.round(performance.now() - t0);
      return none;
    }
    const limit = filters.limit ?? 50;
    const { rows, total, elapsedMs } = store.search({
      matchExpr, folderId: filters.folderId, from: filters.from, to: filters.to,
      subject: filters.subject, hasAttachment: filters.hasAttachment,
      after: filters.after, before: filters.before, limit,
      offset: filters.offset ?? 0,
      sortBy: filters.sortBy ?? 'date',
    });
    const result: SearchResult = { items: rows.map(r => this.toListItem(r)), total, elapsedMs, snippetMap: {} };
    if (filters.wantFacets) {
      result.facets = store.searchFacets({
        matchExpr, from: filters.from, to: filters.to, subject: filters.subject,
        hasAttachment: filters.hasAttachment, after: filters.after, before: filters.before,
      });
    }
    if (filters.wantSnippets && matchExpr) {
      result.snippetMap = store.searchSnippets(matchExpr, result.items.map(i => i.id));
    }
    result.elapsedMs = Math.round(performance.now() - t0);
    return result;
  }

  /**
   * Headers of the mails with a row id above `cursor`, oldest first. Addresses and
   * ids only: the subject never leaves the worker in clear text for this purpose, it
   * only enters the fallback hash. The page names the store it was read from (MR-28),
   * so a cursor from a rebuilt or replaced store is recognised as such.
   */
  async listHeadersSince(cursor: number, limit: number, accountId?: string): Promise<HeaderPage> {
    const store = this.entry(accountId).store;
    const generation = store.generation();
    const rows = store.db.prepare(
      `SELECT id, message_id, in_reply_to, references_json, from_email, to_json, cc_json,
              date, internal_date, subject, size_bytes
       FROM messages WHERE id > ? ORDER BY id LIMIT ?`)
      .all(cursor, Math.max(1, Math.min(limit, 500))) as Array<{
        id: number; message_id: string | null; in_reply_to: string | null;
        references_json: string | null; from_email: string; to_json: string | null;
        cc_json: string | null; date: string | null; internal_date: string | null;
        subject: string | null; size_bytes: number | null;
      }>;
    const headers = rows.map((r): MessageHeader => ({
      id: r.id,
      messageId: r.message_id,
      fallbackKey: messageFallbackKey({
        date: r.date ?? r.internal_date,
        fromEmail: r.from_email,
        sizeBytes: r.size_bytes,
        subject: r.subject,
      }),
      inReplyTo: r.in_reply_to,
      references: parseJsonArray(r.references_json),
      fromEmail: r.from_email,
      toEmails: parseAddressList(r.to_json),
      ccEmails: parseAddressList(r.cc_json),
      date: r.date,
    }));
    return { generation, headers };
  }

  async findByMessageIds(ids: string[], accountId?: string): Promise<MessageListItem[]> {
    // Callers may pass a Message-ID with or without its angle brackets (the app DB
    // stores it without, the store keeps what the server sent), so both forms match.
    const wanted = new Set<string>();
    for (const raw of ids) {
      const bare = normalizeMessageId(raw);
      if (!bare) continue;
      wanted.add(bare);
      wanted.add(`<${bare}>`);
    }
    if (wanted.size === 0) return [];
    const store = this.entry(accountId).store;
    const all = [...wanted];
    // chunked: SQLite's variable limit is well above this, but a caller may pass many
    const out: MessageListItem[] = [];
    for (let i = 0; i < all.length; i += 200) {
      const chunk = all.slice(i, i + 200);
      const rows = store.db.prepare(
        `SELECT * FROM messages WHERE message_id IN (${chunk.map(() => '?').join(',')})`)
        .all(...chunk) as import('./store.js').MessageRow[];
      out.push(...rows.map(r => this.toListItem(r)));
    }
    return out;
  }

  /**
   * C4: the mails that answer one of `parentIds` - their `In-Reply-To` names it, or it
   * appears in their `References`. A Message-ID matches with or without angle brackets.
   * Newest first, because a thread's last mail is what the invoice page cares about.
   */
  async findReplies(parentIds: string[], accountId?: string): Promise<MessageListItem[]> {
    const wanted = parentIds.map((raw) => normalizeMessageId(raw)).filter(Boolean)
    if (wanted.length === 0) return []
    // The parent is stored as the server sent it; the reply may quote it either way
    const forms = wanted.flatMap((id) => [id, `<${id}>`])
    const store = this.entry(accountId).store
    const found = new Map<number, import('./store.js').MessageRow>()
    for (let i = 0; i < forms.length; i += 200) {
      const chunk = forms.slice(i, i + 200)
      const rows = store.db
        .prepare(
          `SELECT * FROM messages
           WHERE in_reply_to IN (${chunk.map(() => '?').join(',')})
              OR references_json LIKE '%' || ? || '%'`
        )
        .all(...chunk, chunk[0]) as import('./store.js').MessageRow[]
      for (const row of rows) {
        if (row.in_reply_to && chunk.includes(row.in_reply_to)) {
          found.set(row.id, row)
          continue
        }
        // the LIKE is only a prefilter; References is a JSON array of Message-IDs
        const refs = parseJsonArray(row.references_json)
        if (refs.some((ref) => chunk.includes(ref))) found.set(row.id, row)
      }
    }
    return [...found.values()]
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.id - a.id)
      .map((row) => this.toListItem(row))
  }

  async getContacts(partial: string, accountId?: string): Promise<{ name: string; email: string }[]> {
    return this.entry(accountId).store.searchContacts(partial);
  }

  parseFlags(row: { flags_json: string }): { seen: boolean; flagged: boolean; draft: boolean; deleted: boolean; answered: boolean } {
    return JSON.parse(row.flags_json);
  }

  private toListItem(row: import('./store.js').MessageRow): MessageListItem {
    const flags = this.parseFlags(row);
    const attachments = this.parseAttachments(row);
    return {
      id: row.id,
      messageId: row.message_id,
      folderId: row.folder_id,
      uid: row.uid,
      subject: row.subject || '(no subject)',
      fromName: row.from_name,
      fromEmail: row.from_email,
      date: row.date,
      internalDate: row.internal_date,
      hasAttachments: row.has_attachments === 1,
      attachmentNames: attachments.filter(a => !a.isInline).map(a => a.filename),
      isRead: flags.seen,
      isFlagged: flags.flagged,
      isDraft: flags.draft,
      snippet: row.snippet,
      threadId: row.thread_id,
      threadCount: 1,
    };
  }

  private parseAttachments(row: { attachments_json: string }): AttachmentMeta[] {
    try { return JSON.parse(row.attachments_json); } catch { return []; }
  }

  private toDetail(_e: AccountEntry, row: import('./store.js').MessageRow, loadedImages: RemoteImageRef[] | null): MessageDetail {
    const base = this.toListItem(row);
    const attachments: AttachmentInfo[] = this.parseAttachments(row).map(a => ({
      partId: a.partId, filename: a.filename, contentType: a.contentType,
      sizeBytes: a.size, isInline: a.isInline, contentId: a.contentId,
    }));
    let html: string | null = null;
    let links: MessageDetail['links'] = [];
    let remoteImages: RemoteImageRef[] = [];
    if (row.body_html) {
      let raw = row.body_html;
      if (loadedImages && loadedImages.length) {
        const map = new Map(loadedImages.map(r => [r.url, r.placeholder]));
        raw = raw.replace(/(src\s*=\s*")(https?:\/\/[^"]+)(")/gi, (m, pre, url: string, post) =>
          map.has(url) ? `${pre}${map.get(url)}${post}` : m);
        raw = raw.replace(/(url\(\s*['"]?)(https?:\/\/[^)'"]+)(['"]?\s*\))/gi, (m, pre, url: string, post) =>
          map.has(url) ? `${pre}${map.get(url)}${post}` : m);
      }
      const s = sanitizeEmailHtml(raw);
      html = s.html;
      links = s.links;
      remoteImages = s.remoteImages;
    }
    return {
      ...base,
      to: this.safeJson(row.to_json, []),
      cc: this.safeJson(row.cc_json, []),
      messageId: row.message_id,
      inReplyTo: row.in_reply_to,
      references: this.safeJson(row.references_json, []),
      sizeBytes: row.size_bytes,
      complete: row.complete !== 0,
      bodyKind: row.body_html ? 'html' : 'text',
      html,
      text: row.body_text,
      attachments,
      emlPath: row.file_path,
      links,
      remoteImages,
      remoteImageCount: remoteImages.length,
    };
  }

  private safeJson<T>(s: string, fallback: T): T {
    try { return JSON.parse(s) as T; } catch { return fallback; }
  }
}

interface AttachmentMeta { partId: string; filename: string; contentType: string; size: number; isInline: boolean; contentId: string | null }

/** A JSON address array from the store, tolerating NULL and junk */
function parseAddressList(raw: string | null): string[] {
  return parseJsonArray(raw)
    .map(a => (typeof a === 'string' ? a : (a as { email?: string })?.email ?? ''))
    .map(a => a.trim().toLowerCase())
    .filter(Boolean);
}

/** A JSON array column, tolerating NULL and junk */
function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
