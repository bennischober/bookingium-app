// Storage layer: SQLite schema + data access.
// LESSONS FROM REPORT.md applied here:
//  - Problem #1 (case collision): folder NAMES never touch the filesystem. Files live under
//    data/<account>/<messageKey>.eml where messageKey = sha1(account|uidValidity|uid) —
//    collision-proof by construction. The DB row owns the path (file_path column).
//  - Problem #4 (FTS corruption): no UPDATE trigger. All modifications go through
//    explicit functions that keep fts in sync with correct old/new values, plus
//    a `fts_integrity` test that runs `INSERT INTO fts(fts) VALUES('integrity-check')`.
import DatabaseConstructor from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';


export type Flags = { seen: boolean; flagged: boolean; draft: boolean; deleted: boolean; answered: boolean };

/** Task 3: thread summary row (see Store.listThreads). */
export interface ThreadRow {
  threadId: string;
  count: number;
  subject: string;
  fromName: string;
  date: string | null;
  unread: number;
  hasAttachments: boolean;
  snippet: string;
  messageIds: number[];
}

export interface FolderRow {
  id: string;
  account_id: string;
  imap_path: string;          // original IMAP path (display only)
  delimiter: string;
  special_use: string | null;
  uid_validity: string | null;
  uid_next: number | null;
  highest_modseq: string | null;
  last_sync_at: string | null;
  last_flag_sweep: string | null;
  list_absent_since: string | null;   // Task 4: first LIST pass where this folder was absent (prune debounce)
}

/** Task 4: one pending/finished write operation (see docs/WRITE_PATH.md §1). */
export interface JournalRow {
  id: string;
  account_id: string;
  kind: 'flag' | 'move' | 'delete' | 'expunge' | 'send' | 'draft_save' | 'draft_delete';
  state: 'pending' | 'running' | 'done' | 'failed' | 'conflict' | 'cancelled' | 'unknown';
  folder_path: string | null;
  folder_uidvalidity: string | null;
  uid: number | null;
  message_key: string | null;
  message_id: string | null;
  payload: string | null;
  target_folder_path: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export interface MessageRow {
  id: number;
  account_id: string;
  folder_id: string;
  uid: number;
  message_key: string;        // sha1(account|uidValidity|uid) — file name
  file_path: string;          // DB-OWNED relative path (source of truth)
  message_id: string | null;
  in_reply_to: string | null;
  references_json: string;
  thread_id: string | null;
  date: string | null;
  internal_date: string | null;
  subject: string;
  from_name: string;
  from_email: string;
  to_json: string;
  cc_json: string;
  bcc_json: string;
  flags_json: string;
  modseq: string | null;
  has_attachments: number;
  attachments_json: string;
  size_bytes: number;
  body_text: string;
  body_html: string | null;   // raw original HTML (sanitization happens at render time)
  snippet: string;
  parsed_ok: number;
  parse_error: string | null;
  sort_date?: string | null;   // materialized COALESCE(date, internal_date); derived on insert if absent
}

export class Store {
  readonly db: BetterSqlite3.Database;
  constructor(dataDir: string, readonly accountId: string, private clock: () => number = Date.now) {
    // Task 5: the host passes an ABSOLUTE data dir (createMailCore resolves it);
    // the core never guesses repo-relative paths.
    if (!path.isAbsolute(dataDir)) {
      throw new Error(`Store: dataDir must be absolute (got "${dataDir}") — pass an absolute path via createMailCore`);
    }
    this.dataDirResolved = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseConstructor(path.join(dataDir, `${accountId}.db`));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }
  readonly dataDirResolved: string;

  private migrate() {
    this.db.exec(`
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  imap_path TEXT NOT NULL,
  delimiter TEXT NOT NULL DEFAULT '/',
  special_use TEXT,
  uid_validity TEXT,
  uid_next INTEGER,
  highest_modseq TEXT,
  last_sync_at TEXT,
  -- Task 3 (no-CONDSTORE servers): tiered flag refresh — when this folder last had
  -- ALL of its flags fetched (FETCH 1:* FLAGS). NULL = never.
  last_flag_sweep TEXT,
  UNIQUE(account_id, imap_path)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  account_id TEXT NOT NULL,
  folder_id TEXT NOT NULL REFERENCES folders(id),
  uid INTEGER NOT NULL,
  message_key TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  message_id TEXT,
  in_reply_to TEXT,
  references_json TEXT NOT NULL DEFAULT '[]',
  thread_id TEXT,
  date TEXT,
  internal_date TEXT,
  subject TEXT NOT NULL DEFAULT '',
  from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  flags_json TEXT NOT NULL DEFAULT '{}',
  modseq TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT,
  snippet TEXT NOT NULL DEFAULT '',
  parsed_ok INTEGER NOT NULL DEFAULT 1,
  parse_error TEXT,
  sort_date TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_folder ON messages(folder_id, uid);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_email);
CREATE INDEX IF NOT EXISTS idx_messages_msgid ON messages(message_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
-- NOTE: idx_messages_sort (folder_id, sort_date DESC) is created AFTER the sort_date
-- migration below, because existing DBs get the column via ALTER TABLE there.

CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(
  subject, from_name, from_email, to_json, body_text, attachments_json,
  content='messages', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO fts(rowid, subject, from_name, from_email, to_json, body_text, attachments_json)
  VALUES (new.id, new.subject, new.from_name, new.from_email, new.to_json, new.body_text, new.attachments_json);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO fts(fts, rowid, subject, from_name, from_email, to_json, body_text, attachments_json)
  VALUES ('delete', old.id, old.subject, old.from_name, old.from_email, old.to_json, old.body_text, old.attachments_json);
END;
-- deliberately NO update trigger (see Store.updateMessage: DELETE+INSERT pattern)

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS contacts (
  email TEXT PRIMARY KEY,
  name TEXT,
  last_seen TEXT
);
`);
    // migration for DBs created before sort_date existed
    const hasSort = this.db.prepare("SELECT COUNT(*) c FROM pragma_table_info('messages') WHERE name = 'sort_date'").get() as { c: number };
    if (!hasSort.c) {
      this.db.exec(`ALTER TABLE messages ADD COLUMN sort_date TEXT;
        UPDATE messages SET sort_date = COALESCE(date, internal_date);`);
    }
    // needs the column (created above for old DBs; present from CREATE for new ones)
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sort ON messages(folder_id, sort_date DESC)`);
    // Task 3: vocabulary table for prefix-cost pre-checks. A slow typist fires one
    // search per prefix ("v"*, "ve"*, "ver"*…); German prefixes over 32k mails build
    // doclists in the hundreds of thousands and block the single thread for 10s+ per
    // query (measured 2026-10-23). fts5vocab lets us estimate the doclist size with a
    // cheap B-tree range scan BEFORE running the pathological MATCH.
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS fts_vocab USING fts5vocab('fts', 'row')`);
    // global search sorts across ALL folders by sort_date; without this index SQLite
    // materializes every matching row (each ~75 KB with overflow pages) into a temp
    // B-tree before sorting — measured 1.2-2.1 s on 20k hits. With it, the planner can
    // walk rows already in sort order and test the FTS predicate per row, stopping after
    // LIMIT rows (measured <10 ms for the first page).
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sort_date ON messages(sort_date DESC)`);
    // migration for DBs created before last_flag_sweep existed (Task 3, flag tiers)
    const hasSweep = this.db.prepare("SELECT COUNT(*) c FROM pragma_table_info('folders') WHERE name = 'last_flag_sweep'").get() as { c: number };
    if (!hasSweep.c) {
      this.db.exec(`ALTER TABLE folders ADD COLUMN last_flag_sweep TEXT`);
    }
    // Task 4: prune debounce column
    const hasAbsent = this.db.prepare("SELECT COUNT(*) c FROM pragma_table_info('folders') WHERE name = 'list_absent_since'").get() as { c: number };
    if (!hasAbsent.c) {
      this.db.exec(`ALTER TABLE folders ADD COLUMN list_absent_since TEXT`);
    }
    // Task 4: operation journal (write path). Journal-first: every user action is
    // committed here BEFORE any server contact; crash-safe via WAL. See
    // docs/WRITE_PATH.md §1 for the state machine and rationale.
    this.db.exec(`CREATE TABLE IF NOT EXISTS op_journal (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending',
      folder_path TEXT,
      folder_uidvalidity TEXT,
      uid INTEGER,
      message_key TEXT,
      message_id TEXT,
      payload TEXT,
      target_folder_path TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ops_state ON op_journal(state, created_at);
    CREATE INDEX IF NOT EXISTS idx_ops_folder ON op_journal(account_id, folder_path, state);`);
  }

  messageKey(accountId: string, folderId: string, uidValidity: string, uid: number): string {
    // folderId is part of the key: UIDVALIDITY is per-mailbox and can coincide across
    // folders, and UIDs repeat in every folder. Without the folder this collides.
    return crypto.createHash('sha1').update(`${accountId}|${folderId}|${uidValidity}|${uid}`).digest('hex');
  }

  // ----- Task 4: operation journal -------------------------------------------
  /** Journal an operation BEFORE any server contact. Returns the op id. */
  journalEnqueue(op: {
    id?: string; accountId: string; kind: 'flag' | 'move' | 'delete' | 'expunge' | 'send' | 'draft_save' | 'draft_delete';
    folderPath?: string; folderUidValidity?: string; uid?: number; messageKey?: string;
    messageId?: string; payload?: unknown; targetFolderPath?: string;
  }): string {
    const id = op.id ?? crypto.randomUUID();
    const now = new Date(this.clock()).toISOString();
    this.db.prepare(`INSERT INTO op_journal
      (id, account_id, kind, state, folder_path, folder_uidvalidity, uid, message_key,
       message_id, payload, target_folder_path, attempts, created_at, updated_at)
      VALUES (@id, @accountId, @kind, 'pending', @folderPath, @folderUidValidity, @uid,
       @messageKey, @messageId, @payload, @targetFolderPath, 0, @now, @now)`)
      .run({
        id, accountId: op.accountId, kind: op.kind,
        folderPath: op.folderPath ?? null, folderUidValidity: op.folderUidValidity ?? null,
        uid: op.uid ?? null, messageKey: op.messageKey ?? null, messageId: op.messageId ?? null,
        payload: op.payload !== undefined ? JSON.stringify(op.payload) : null,
        targetFolderPath: op.targetFolderPath ?? null, now,
      });
    return id;
  }

  journalGet(id: string): JournalRow | undefined {
    return this.db.prepare('SELECT * FROM op_journal WHERE id = ?').get(id) as JournalRow | undefined;
  }

  journalUpdate(id: string, patch: { state?: string; error?: string; payload?: unknown; targetFolderPath?: string }): void {
    const sets: string[] = ['updated_at=@now'];
    const p: Record<string, unknown> = { id, now: new Date(this.clock()).toISOString() };
    if (patch.state !== undefined) { sets.push('state=@state'); p.state = patch.state; }
    if (patch.error !== undefined) { sets.push('error=@error'); p.error = patch.error; }
    if (patch.payload !== undefined) { sets.push('payload=@payload'); p.payload = JSON.stringify(patch.payload); }
    if (patch.targetFolderPath !== undefined) { sets.push('target_folder_path=@tfp'); p.tfp = patch.targetFolderPath; }
    this.db.prepare(`UPDATE op_journal SET ${sets.join(', ')} WHERE id = @id`).run(p);
  }

  journalBumpAttempts(id: string): number {
    this.db.prepare('UPDATE op_journal SET attempts = attempts + 1, updated_at = @now WHERE id = @id')
      .run({ id, now: new Date(this.clock()).toISOString() });
    const row = this.journalGet(id);
    return row?.attempts ?? 0;
  }

  /** Ops to replay at startup / on demand, oldest first. */
  journalPending(limit = 50): JournalRow[] {
    return this.db.prepare(`SELECT * FROM op_journal WHERE state IN ('pending','running')
      ORDER BY created_at LIMIT ?`).all(limit) as JournalRow[];
  }

  /** Does any pending/running op touch this message (by local row id)? */
  opInFlightForMessageKey(messageKey: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM op_journal WHERE message_key = ?
      AND state IN ('pending','running') LIMIT 1`).get(messageKey);
  }

  journalListRecent(limit = 50): JournalRow[] {
    return this.db.prepare('SELECT * FROM op_journal ORDER BY updated_at DESC, created_at DESC LIMIT ?')
      .all(limit) as JournalRow[];
  }

  journalCountByState(): Record<string, number> {
    const rows = this.db.prepare('SELECT state, COUNT(*) c FROM op_journal GROUP BY state').all() as { state: string; c: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.state] = r.c;
    return out;
  }

  // folder helpers -----------------------------------------------------------
  upsertFolder(f: { imapPath: string; delimiter: string; specialUse?: string | null; uidValidity?: string | null; uidNext?: number | null; highestModseq?: string | null }): FolderRow {
    const id = crypto.createHash('sha1').update(`${this.accountId}|${f.imapPath}`).digest('hex').slice(0, 16);
    const existing = this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined;
    if (existing) {
      this.db.prepare(`UPDATE folders SET delimiter=@delimiter, special_use=@specialUse, uid_validity=COALESCE(@uidValidity, uid_validity),
        uid_next=COALESCE(@uidNext, uid_next), highest_modseq=COALESCE(@highestModseq, highest_modseq) WHERE id=@id`)
        .run({ id, delimiter: f.delimiter, specialUse: f.specialUse ?? null, uidValidity: f.uidValidity ?? null, uidNext: f.uidNext ?? null, highestModseq: f.highestModseq ?? null });
    } else {
      this.db.prepare(`INSERT INTO folders (id, account_id, imap_path, delimiter, special_use, uid_validity, uid_next, highest_modseq)
        VALUES (@id, @accountId, @imapPath, @delimiter, @specialUse, @uidValidity, @uidNext, @highestModseq)`)
        .run({ id, accountId: this.accountId, imapPath: f.imapPath, delimiter: f.delimiter, specialUse: f.specialUse ?? null, uidValidity: f.uidValidity ?? null, uidNext: f.uidNext ?? null, highestModseq: f.highestModseq ?? null });
    }
    return this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow;
  }

  getFolder(id: string): FolderRow | undefined {
    return this.db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined;
  }

  getFolderByPath(imapPath: string): FolderRow | undefined {
    return this.db.prepare('SELECT * FROM folders WHERE account_id = ? AND imap_path = ?').get(this.accountId, imapPath) as FolderRow | undefined;
  }

  allFolders(): FolderRow[] {
    return this.db.prepare('SELECT * FROM folders WHERE account_id = ? ORDER BY imap_path').all(this.accountId) as FolderRow[];
  }

  setFlagSwept(id: string, atIso: string | null): void {
    this.db.prepare('UPDATE folders SET last_flag_sweep = ? WHERE id = ?').run(atIso, id);
  }

  // message helpers ----------------------------------------------------------
  insertMessage(m: Omit<MessageRow, 'id'> & { sort_date?: string | null }): number {
    const withSort = { ...m, sort_date: m.sort_date ?? m.date ?? m.internal_date ?? null };
    const info = this.db.prepare(`INSERT INTO messages (
      account_id, folder_id, uid, message_key, file_path, message_id, in_reply_to, references_json, thread_id,
      date, internal_date, sort_date, subject, from_name, from_email, to_json, cc_json, bcc_json, flags_json, modseq,
      has_attachments, attachments_json, size_bytes, body_text, body_html, snippet, parsed_ok, parse_error)
      VALUES (@account_id, @folder_id, @uid, @message_key, @file_path, @message_id, @in_reply_to, @references_json, @thread_id,
      @date, @internal_date, @sort_date, @subject, @from_name, @from_email, @to_json, @cc_json, @bcc_json, @flags_json, @modseq,
      @has_attachments, @attachments_json, @size_bytes, @body_text, @body_html, @snippet, @parsed_ok, @parse_error)`)
      .run(withSort);
    return Number(info.lastInsertRowid);
  }

  getMessage(id: number): MessageRow | undefined {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as MessageRow | undefined;
  }

  getByKey(messageKey: string): MessageRow | undefined {
    return this.db.prepare('SELECT * FROM messages WHERE message_key = ?').get(messageKey) as MessageRow | undefined;
  }

  /**
   * Update a message row while keeping its stable row id and keeping the external-content
   * FTS index consistent: manually 'delete' the old FTS entry, UPDATE the row in place,
   * then insert the new values into FTS. (No UPDATE trigger by design — the automatic
   * UPDATE-trigger approach was the source of FTS corruption in Task 1, problem #4.)
   */
  updateMessage(id: number, patch: Partial<MessageRow>): void {
    const row = this.getMessage(id);
    if (!row) throw new Error(`updateMessage: no row ${id}`);
    const merged = { ...row, ...patch } as MessageRow;
    const ftsDelete = this.db.prepare(`INSERT INTO fts(fts, rowid, subject, from_name, from_email, to_json, body_text, attachments_json)
      VALUES ('delete', @id, @subject, @from_name, @from_email, @to_json, @body_text, @attachments_json)`);
    const ftsInsert = this.db.prepare(`INSERT INTO fts(rowid, subject, from_name, from_email, to_json, body_text, attachments_json)
      VALUES (@id, @subject, @from_name, @from_email, @to_json, @body_text, @attachments_json)`);
    const update = this.db.prepare(`UPDATE messages SET
      folder_id=@folder_id, uid=@uid, message_key=@message_key, file_path=@file_path,
      message_id=@message_id, in_reply_to=@in_reply_to, references_json=@references_json, thread_id=@thread_id,
      date=@date, internal_date=@internal_date, sort_date=@sort_date, subject=@subject, from_name=@from_name, from_email=@from_email,
      to_json=@to_json, cc_json=@cc_json, bcc_json=@bcc_json, flags_json=@flags_json, modseq=@modseq,
      has_attachments=@has_attachments, attachments_json=@attachments_json, size_bytes=@size_bytes,
      body_text=@body_text, body_html=@body_html, snippet=@snippet, parsed_ok=@parsed_ok, parse_error=@parse_error
      WHERE id=@id`);
    const tx = this.db.transaction(() => {
      ftsDelete.run(row);
      update.run({ ...merged, sort_date: merged.sort_date ?? merged.date ?? merged.internal_date ?? null });
      ftsInsert.run(merged);
    });
    tx();
  }

  /**
   * Flags-only update: a minimal `UPDATE messages SET flags_json/modseq/internal_date`.
   * Flag sweeps and IDLE flag events touch thousands of rows; the generic
   * updateMessage() path rewrites the whole ~75 KB row (incl. body overflow pages)
   * and churns the FTS index per row, which blocked the event loop for seconds
   * during sweeps (search latency spike to 9.7 s observed 2026-10-23). Flags are
   * not FTS-indexed, so skipping the FTS delete/reinsert is also correct.
   */
  updateMessageFlags(id: number, flags_json: string, modseq?: string | null, internal_date?: string | null): void {
    this.db.prepare(`UPDATE messages SET flags_json=@flags
      ${modseq !== undefined ? ', modseq=@modseq' : ''}
      ${internal_date !== undefined ? ', internal_date=@internalDate' : ''}
      WHERE id=@id`).run({
      flags: flags_json,
      ...(modseq !== undefined ? { modseq: modseq } : {}),
      ...(internal_date !== undefined ? { internalDate: internal_date } : {}),
      id,
    });
  }

  deleteMessages(ids: number[]): void {
    const tx = this.db.transaction(() => {
      for (const id of ids) this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
    });
    tx();
  }

  listByFolder(folderId: string, offset: number, limit: number): MessageRow[] {
    return this.db.prepare(`SELECT * FROM messages WHERE folder_id = @folderId
      ORDER BY sort_date DESC LIMIT @limit OFFSET @offset`)
      .all({ folderId, limit, offset }) as MessageRow[];
  }

  countByFolder(folderId: string): { total: number; unread: number } {
    const total = (this.db.prepare('SELECT COUNT(*) c FROM messages WHERE folder_id = ?').get(folderId) as { c: number }).c;
    const unread = (this.db.prepare(`SELECT COUNT(*) c FROM messages WHERE folder_id = ? AND flags_json NOT LIKE '%"seen":true%'`).get(folderId) as { c: number }).c;
    return { total, unread };
  }

  // contacts -----------------------------------------------------------------
  upsertContact(email: string, name: string): void {
    this.db.prepare(`INSERT INTO contacts (email, name, last_seen) VALUES (?, ?, datetime('now'))
      ON CONFLICT(email) DO UPDATE SET name = CASE WHEN @name != '' THEN @name ELSE contacts.name END, last_seen = datetime('now')`)
      .run(email.toLowerCase(), name);
  }

  searchContacts(partial: string, limit = 8): { name: string; email: string }[] {
    const p = `%${partial.toLowerCase()}%`;
    return this.db.prepare(`SELECT name, email FROM contacts WHERE email LIKE ? OR lower(name) LIKE ? ORDER BY last_seen DESC LIMIT ?`)
      .all(p, p, limit) as { name: string; email: string }[];
  }

  rebuildContactsFromMessages(): number {
    const rows = this.db.prepare(`SELECT from_email, from_name FROM messages WHERE from_email != ''
      UNION SELECT json_extract(j.value, '$.email') AS from_email, json_extract(j.value, '$.name') AS from_name
      FROM messages m, json_each(m.to_json) j`).all() as { from_email: string; from_name: string }[];
    let n = 0;
    const tx = this.db.transaction(() => {
      for (const r of rows) {
        if (!r.from_email) continue;
        this.upsertContact(r.from_email, r.from_name || '');
        n++;
      }
    });
    tx();
    return n;
  }

  // threads ------------------------------------------------------------------
  /** Newest-first thread summaries (for the conversation list). */
  listThreads(folderId: string | null, offset: number, limit: number): ThreadRow[] {
    const folderSql = folderId ? 'WHERE m.folder_id = @folderId' : '';
    const rows = this.db.prepare(`
      SELECT m.thread_id AS threadId, COUNT(*) AS count, MAX(m.sort_date) AS newest,
        SUM(CASE WHEN json_extract(m.flags_json, '$.seen') IS NOT 1 THEN 1 ELSE 0 END) AS unread,
        SUM(m.has_attachments) AS atts,
        COUNT(DISTINCT m.id) AS n
      FROM messages m ${folderSql}
      GROUP BY m.thread_id
      HAVING m.thread_id IS NOT NULL
      ORDER BY newest DESC
      LIMIT @limit OFFSET @offset`).all({ folderId, limit, offset }) as any[];
    if (!rows.length) return [];
    // fetch newest message per thread (subject/from/snippet/ids) in one query
    const ids = new Set<string>(rows.map(r => r.threadId));
    const placeholders = [...ids].map(() => '?').join(',');
    const msgs = this.db.prepare(`
      SELECT id, thread_id, subject, from_name, snippet, sort_date FROM messages
      WHERE thread_id IN (${placeholders})
      ORDER BY sort_date DESC`).all(...ids) as any[];
    const byThread = new Map<string, any[]>();
    for (const m of msgs) {
      const arr = byThread.get(m.thread_id) || [];
      arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    return rows.map(r => {
      const list = (byThread.get(r.threadId) || []).sort((a, b) => (b.sort_date || '').localeCompare(a.sort_date || ''));
      const newest = list[0] || {};
      return {
        threadId: r.threadId,
        count: r.count,
        subject: newest.subject || '(no subject)',
        fromName: newest.from_name || '',
        date: newest.sort_date || r.newest || null,
        unread: r.unread || 0,
        hasAttachments: (r.atts || 0) > 0,
        snippet: newest.snippet || '',
        messageIds: list.map(x => x.id),
      } as ThreadRow;
    });
  }

  // search facets ------------------------------------------------------------
  /** Per-folder hit counts for a search (GROUP BY over the FTS id set). */
  searchFacets(opts: { matchExpr: string | null; from?: string; to?: string; subject?: string; hasAttachment?: boolean; after?: string; before?: string }): { folderId: string; count: number }[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.matchExpr) { where.push('messages.id IN (SELECT rowid FROM fts WHERE fts MATCH @match)'); params.match = opts.matchExpr; }
    if (opts.from) { where.push('(messages.from_name LIKE @from OR messages.from_email LIKE @from)'); params.from = `%${opts.from.toLowerCase()}%`; }
    if (opts.to) { where.push('messages.to_json LIKE @to'); params.to = `%${opts.to.toLowerCase()}%`; }
    if (opts.subject) { where.push('messages.subject LIKE @subject'); params.subject = `%${opts.subject.toLowerCase()}%`; }
    if (opts.hasAttachment) where.push('messages.has_attachments = 1');
    if (opts.after) { where.push('COALESCE(messages.date, messages.internal_date) >= @after'); params.after = opts.after; }
    if (opts.before) { where.push('COALESCE(messages.date, messages.internal_date) <= @before'); params.before = opts.before; }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    return this.db.prepare(`SELECT folder_id AS folderId, COUNT(*) AS count FROM messages ${whereSql}
      GROUP BY folder_id ORDER BY count DESC`).all(params) as { folderId: string; count: number }[];
  }

  /** Highlighted snippets for a page of rows — ONE FTS query for the whole page.
   * Column 4 = body_text (0 subject, 1 from_name, 2 from_email, 3 to_json, 4 body_text,
   * 5 attachments_json). Rows whose match lives in another column get no marker here;
   * the caller falls back to the plain row snippet for those. */
  searchSnippets(matchExpr: string, ids: number[]): Record<number, string> {
    if (!ids.length) return {};
    const out: Record<number, string> = {};
    const sel = this.db.prepare(`SELECT rowid AS id, snippet(fts, 4, '[', ']', '…', 12) AS snip
      FROM fts WHERE rowid IN (${ids.map(() => '?').join(',')}) AND fts MATCH ?`);
    try {
      const rows = sel.all(...ids, matchExpr) as { id: number; snip: string }[];
      for (const r of rows) {
        if (r.snip && r.snip.includes('[')) out[r.id] = r.snip;
      }
    } catch { /* match syntax edge case — snippets stay empty */ }
    return out;
  }

  // FTS ----------------------------------------------------------------------
  /** Guard against pathological MATCH expressions ("v" * expands to a large share of
   * the German vocabulary over 32k mails and blocks the single thread for seconds).
   * Terms shorter than 3 characters are rejected outright; the UI additionally
   * never sends them (min-length gate). */
  static readonly MIN_FTS_TERM_LEN = 3;

  ftsEscapeUserQuery(q: string): string {
    const terms = q.split(/\s+/).map(t => t.trim()).filter(Boolean)
      .map(t => t.replace(/[*(){}:^\-]/g, ' ').trim())
      .filter(Boolean)
      .filter(t => t.length >= Store.MIN_FTS_TERM_LEN || t === 'OR' || t === 'AND' || t === 'NOT')
      .map(t => `"${t.replace(/"/g, '""')}" *`);
    return terms.join(' ');
  }

  /** Prefix-cost guard: estimate how many rows a prefix term would match via the
   * fts5vocab table (cheap B-tree range scan) BEFORE running the MATCH. A 3-char
   * German prefix like "ver" expands to ~100k+ doclist entries and blocked the loop
   * 5–9 s per query (measured 2026-10-23). Returns a replacement expression with
   * pathological prefixes dropped (keeping safe terms so the search still answers). */
  capPathologicalPrefixes(matchExpr: string): string {
    const MAX_PREFIX_DOCS = 20_000;   // ~doclist size the loop can chew in <200 ms
    const terms = matchExpr.split(/(?<=\*)\s+/); // quoted phrase + star per term
    const kept: string[] = [];
    for (const term of terms) {
      const m = term.match(/^"([^"]+)" \*$/);
      if (!m) { kept.push(term); continue; }
      const word = m[1];
      // exact-cost probe: count vocab entries with this prefix
      const row = this.db.prepare(
        `SELECT COUNT(*) c, SUM(doc) docs FROM fts_vocab WHERE term >= ? AND term < ?`
      ).get(word, word.slice(0, -1) + String.fromCharCode(word.charCodeAt(word.length - 1) + 1)) as { c: number; docs: number | null };
      const docs = row?.docs ?? 0;
      if (docs > MAX_PREFIX_DOCS) {
        console.log(`[search] prefix "${word}*" capped: ~${docs} docs (limit ${MAX_PREFIX_DOCS}) — term dropped`);
        continue;
      }
      kept.push(term);
    }
    return kept.join(' ');
  }

  /** Slim fetch of display rows for a page of ids, preserving the given order.
   * Reads only list-visible columns (~80 KB per 200-row page) instead of full fat
   * rows (~23 MB for the same page incl. body_text/body_html overflow pages —
   * measured 2026-10-23; that read was the first-search cold-start, 7.5 s).
   * Bodies are loaded separately by getMessage() when a mail is opened. */
  private fetchListRows(ids: number[]): MessageRow[] {
    if (!ids.length) return [];
    const cols = `id, folder_id, uid, thread_id, subject, from_name, from_email,
      date, internal_date, sort_date, flags_json, has_attachments, attachments_json,
      size_bytes, snippet, parsed_ok, message_key`;
    const rows = this.db.prepare(`SELECT ${cols} FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids) as MessageRow[];
    const byId = new Map(rows.map(r => [r.id, r]));
    return ids.map(i => byId.get(i)!).filter(Boolean);
  }

  search(opts: { matchExpr: string | null; folderId?: string; from?: string; to?: string; subject?: string; hasAttachment?: boolean; after?: string; before?: string; limit: number; offset: number; sortBy?: 'date' | 'relevance' }): { rows: MessageRow[]; total: number; elapsedMs: number } {
    const t0 = performance.now();
    // NOTE: matchExpr arrives already prefix-capped from the API layer
    // (capPathologicalPrefixes in index.ts) so core search, facets and snippets share it.
    const matchExpr = opts.matchExpr;
    const where: string[] = [];
    const params: Record<string, unknown> = { limit: opts.limit, offset: opts.offset };
    if (matchExpr) { where.push('messages.id IN (SELECT rowid FROM fts WHERE fts MATCH @match)'); params.match = matchExpr; }
    if (opts.folderId) { where.push('messages.folder_id = @folderId'); params.folderId = opts.folderId; }
    if (opts.from) { where.push('(messages.from_name LIKE @from OR messages.from_email LIKE @from)'); params.from = `%${opts.from.toLowerCase()}%`; }
    if (opts.to) { where.push('messages.to_json LIKE @to'); params.to = `%${opts.to.toLowerCase()}%`; }
    if (opts.subject) { where.push('messages.subject LIKE @subject'); params.subject = `%${opts.subject.toLowerCase()}%`; }
    if (opts.hasAttachment) where.push('messages.has_attachments = 1');
    if (opts.after) { where.push('COALESCE(messages.date, messages.internal_date) >= @after'); params.after = opts.after; }
    if (opts.before) { where.push('COALESCE(messages.date, messages.internal_date) <= @before'); params.before = opts.before; }
    const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = (this.db.prepare(`SELECT COUNT(*) c FROM messages ${whereSql}`).get(params) as { c: number }).c;
    // sortBy 'relevance': FTS5 rank (bm25) is only meaningful WITH a match expression;
    // without one, relevance == date fallback.
    const useRelevance = opts.sortBy === 'relevance' && matchExpr;
    let rows: MessageRow[];
    if (useRelevance) {
      // relevance path: order by FTS5 rank. The MATCH constraint MUST be part of the
      // ranked subquery itself — dropping it (as a previous version did when no other
      // filters were set) makes `SELECT rowid FROM fts ORDER BY rank` return the
      // lowest rowids of the whole corpus with rank 0: the list showed the 200 oldest
      // mails while the header correctly counted the real hits (found 2026-10-23 via
      // user report: "full metal cruise" listed 2022 mail, target missing). All
      // non-FTS filters (folderId, from/to/subject, hasAttachment, after/before) MUST
      // also be applied inside the ranked subquery — they run in SQL outside FTS, so
      // a bare `SELECT rowid FROM fts` would silently ignore them.
      const cond: string[] = ['fts MATCH @match'];
      const rp: Record<string, unknown> = { match: params.match };
      if (opts.folderId) { cond.push('messages.folder_id = @folderId'); rp.folderId = opts.folderId; }
      if (opts.from) { cond.push('(messages.from_name LIKE @from OR messages.from_email LIKE @from)'); rp.from = params.from; }
      if (opts.to) { cond.push('messages.to_json LIKE @to'); rp.to = params.to; }
      if (opts.subject) { cond.push('messages.subject LIKE @subject'); rp.subject = params.subject; }
      if (opts.hasAttachment) cond.push('messages.has_attachments = 1');
      if (opts.after) { cond.push('COALESCE(messages.date, messages.internal_date) >= @after'); rp.after = params.after; }
      if (opts.before) { cond.push('COALESCE(messages.date, messages.internal_date) <= @before'); rp.before = params.before; }
      // Column-weighted BM25 (lower = better): subject hits should outrank a one-off
      // body mention of the same words; sender names weigh lightly. Columns:
      // 0 subject, 1 from_name, 2 from_email, 3 to_json, 4 body_text, 5 attachments.
      // Weights are static per-query args, so they apply identically to core search
      // and any later re-query with the same expression.
      const top = this.db.prepare(`SELECT fts.rowid AS id FROM fts
        JOIN messages ON messages.id = fts.rowid WHERE ${cond.join(' AND ')}
        ORDER BY bm25(fts, 10.0, 3.0, 1.0, 1.0, 1.0, 1.0) LIMIT @limit OFFSET @offset`)
        .all({ ...params, ...rp }) as { id: number }[];
      rows = this.fetchListRows(top.map(t => t.id));
      const byId = new Map(rows.map(r => [r.id, r]));
      rows = top.map(t => byId.get(t.id)!);
    } else if (opts.folderId) {
      rows = this.db.prepare(`SELECT * FROM messages ${whereSql}
        ORDER BY sort_date DESC LIMIT @limit OFFSET @offset`).all(params) as MessageRow[];
    } else {
      // Global search: without a folder filter the planner scans the FTS id-set and sorts
      // every hit (each row ~75 KB incl. body overflow pages) in a temp B-tree — measured
      // 1.2-2.1 s for 20k hits. Forcing the sort-date covering index lets SQLite walk rows
      // already in order, test the predicate per tiny index entry, and stop after LIMIT
      // rows: measured ~5 ms for the same first page. Two-step fetch keeps full fat rows
      // to the 50 ids actually displayed.
      const top = this.db.prepare(`SELECT id FROM messages INDEXED BY idx_messages_sort_date ${whereSql}
        ORDER BY sort_date DESC LIMIT @limit OFFSET @offset`).all(params) as { id: number }[];
      rows = this.fetchListRows(top.map(t => t.id));
    }
    return { rows, total, elapsedMs: performance.now() - t0 };
  }

  ftsIntegrityCheck(): boolean {
    try {
      this.db.exec(`INSERT INTO fts(fts) VALUES('integrity-check')`);
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.db.close();
  }
}
