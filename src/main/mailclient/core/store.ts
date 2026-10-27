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
import { isPathOrChild, renamedPath } from './folders.js';
import fs from 'fs';
import path from 'path';
import { runMigrations } from './migrations.js';
import {
  assertIntact, clearIntegrityCheck, isCorruptStoreError, markForIntegrityCheck, needsIntegrityCheck,
  quarantineStoreFiles, salvageRelinks, watchForCorruption, type RelinkEntry,
} from './store_recovery.js';

/** The core's Logger shape, structurally - store.ts must not import index.ts (that would be a cycle). */
type StoreLogger = { warn?: (msg: string) => void };


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

/** Raw GROUP BY row of the thread aggregate query (listThreads). */
interface ThreadAggRow {
  threadId: string;
  count: number;
  newest: string | null;
  unread: number | null;
  atts: number | null;
  n: number;
}

/** Raw per-message row the thread summary is built from (listThreads). */
interface ThreadMessageRow {
  id: number;
  thread_id: string;
  subject: string | null;
  from_name: string | null;
  snippet: string | null;
  sort_date: string | null;
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
  kind: 'flag' | 'move' | 'move_batch' | 'delete' | 'expunge' | 'send' | 'draft_save' | 'draft_delete' | 'folder_create' | 'folder_rename' | 'folder_delete';
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

/** I12: staging folders of a UIDVALIDITY swap; never shown, never searched, never pruned by LIST. */
export const STAGING_PREFIX = '__staging__/';
/** I12 (MR-41): staged rows wait for the swap, so nothing that spans folders may show them. */
const NOT_STAGED = `messages.folder_id NOT IN (SELECT id FROM folders WHERE substr(imap_path, 1, ${STAGING_PREFIX.length}) = '${STAGING_PREFIX}')`;

/** MR-27: one token of a MATCH expression, a quoted prefix term or a boolean operator */
type FtsOperator = 'OR' | 'AND' | 'NOT';
type MatchToken = { op: FtsOperator } | { word: string };
const isFtsOperator = (t: string): t is FtsOperator => t === 'OR' || t === 'AND' || t === 'NOT';

/**
 * MR-27: FTS5 needs a term on both sides of an operator, or the MATCH throws. Operators at either end
 * are dropped and a run of them keeps the last. A leading NOT takes its term with it: searching for
 * that term would turn the user's meaning around.
 */
function tidyOperators(tokens: MatchToken[]): MatchToken[] {
  const out: MatchToken[] = [];
  let skipTerm = false;
  for (const t of tokens) {
    const last = out[out.length - 1];
    if ('op' in t) {
      if (!last) { if (t.op === 'NOT') skipTerm = true; continue; }
      if ('op' in last) out[out.length - 1] = t;
      else out.push(t);
    } else if (skipTerm) {
      skipTerm = false;
    } else {
      out.push(t);
    }
  }
  while (out.length && 'op' in out[out.length - 1]) out.pop();
  return out;
}

function buildMatchExpr(tokens: MatchToken[]): string {
  return tokens.map(t => 'op' in t ? t.op : `"${t.word.replace(/"/g, '""')}" *`).join(' ');
}

/** The tokens of an expression buildMatchExpr made */
function parseMatchExpr(expr: string): MatchToken[] {
  const out: MatchToken[] = [];
  for (const m of expr.matchAll(/"((?:[^"]|"")*)" \*|\b(OR|AND|NOT)\b/g)) {
    out.push(m[2] ? { op: m[2] as FtsOperator } : { word: m[1].replace(/""/g, '"') });
  }
  return out;
}

export class Store {
  readonly db: BetterSqlite3.Database;
  constructor(dataDir: string, readonly accountId: string, private clock: () => number = Date.now, private log: StoreLogger = {}) {
    // Task 5: the host passes an ABSOLUTE data dir (createMailCore resolves it);
    // the core never guesses repo-relative paths.
    if (!path.isAbsolute(dataDir)) {
      throw new Error(`Store: dataDir must be absolute (got "${dataDir}") — pass an absolute path via createMailCore`);
    }
    this.dataDirResolved = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, `${accountId}.db`);
    let db: BetterSqlite3.Database;
    try {
      db = this.openStore(dbPath);
    } catch (err) {
      // A corrupt store is the ONE failure worth recovering from: every row came from the
      // server, so the file is rebuildable - and a throw here runs inside the accounts loop
      // in index.ts, which would leave the app with NO mail, including the accounts whose
      // stores are fine. Only corruption codes qualify; a locked or unwritable store
      // rethrows untouched, because setting a good store aside is worse than failing.
      if (!isCorruptStoreError(err)) throw err;
      const quarantine = quarantineStoreFiles(dbPath, this.clock);
      this.log.warn?.(`mail store for ${accountId} was corrupt and has been set aside at ${quarantine}; rebuilding from the server`);
      // Exactly ONE retry: a second failure is not corruption-triggered recovery any more,
      // it is a broken data dir, and looping would hide that.
      db = this.openStore(dbPath);
      // I12 (MR-26): the .eml files are still on disk. Re-linking them turns the rebuild
      // into a metadata pass instead of downloading the whole mailbox again.
      const salvaged = salvageRelinks(quarantine, dataDir);
      this.addRelinks(db, salvaged);
      if (salvaged.length) this.log.warn?.(`mail store for ${accountId}: ${salvaged.length} message file(s) kept for re-linking`);
    }
    this.db = db;
  }

  /** Open, configure and migrate one store file; closes the handle on any failure. */
  private openStore(dbPath: string): BetterSqlite3.Database {
    // I12 (MR-26): a damaged page opens fine and fails only when a query reads it. After an
    // unclean shutdown, or once a query has hit corruption, the whole file is checked first.
    const check = needsIntegrityCheck(dbPath);
    const db = new DatabaseConstructor(dbPath);
    try {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('foreign_keys = ON');
      if (check) assertIntact(db);
      runMigrations(db);
      if (check) clearIntegrityCheck(dbPath);
      let reported = false;
      watchForCorruption(db, () => {
        markForIntegrityCheck(dbPath);
        if (reported) return;
        reported = true;
        this.log.warn?.(`mail store for ${this.accountId} hit corruption; it is checked, and rebuilt if needed, on the next start`);
      });
      return db;
    } catch (err) {
      // never leave a half-opened DB behind (Windows keeps the file locked)
      try { db.close(); } catch { /* the handle is unusable already; the throw below is the real failure */ }
      throw err;
    }
  }
  readonly dataDirResolved: string;

  // ----- I12: re-linking the files of a quarantined store ----------------------
  private addRelinks(db: BetterSqlite3.Database, entries: RelinkEntry[]): void {
    if (!entries.length) return;
    const at = new Date(this.clock()).toISOString();
    const insert = db.prepare(`INSERT OR IGNORE INTO relinks (imap_path, uid_validity, uid, file_path, size_bytes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`);
    db.transaction(() => {
      for (const e of entries) insert.run(e.imapPath, e.uidValidity, e.uid, e.filePath, e.sizeBytes, at);
    })();
  }

  /** The files a rebuilt store may adopt for one folder at one UIDVALIDITY, by UID. */
  relinksFor(imapPath: string, uidValidity: string): Map<number, { filePath: string; sizeBytes: number }> {
    const rows = this.db.prepare('SELECT uid, file_path, size_bytes FROM relinks WHERE imap_path = ? AND uid_validity = ?')
      .all(imapPath, uidValidity) as { uid: number; file_path: string; size_bytes: number }[];
    return new Map(rows.map(r => [r.uid, { filePath: r.file_path, sizeBytes: r.size_bytes }]));
  }

  dropRelink(imapPath: string, uidValidity: string, uid: number): void {
    this.db.prepare('DELETE FROM relinks WHERE imap_path = ? AND uid_validity = ? AND uid = ?').run(imapPath, uidValidity, uid);
  }

  /** Files the orphan sweep must leave alone; entries older than `expiresBeforeIso` are dropped first. */
  relinkFiles(expiresBeforeIso: string): Set<string> {
    this.db.prepare('DELETE FROM relinks WHERE created_at < ?').run(expiresBeforeIso);
    return new Set((this.db.prepare('SELECT file_path FROM relinks').all() as { file_path: string }[]).map(r => r.file_path));
  }

  /** A3/A4: the ONE way to turn a stored relative file name into a path. Every
   *  message file access goes through here, so the base can never drift. */
  filePath(rel: string): string {
    return path.join(this.dataDirResolved, rel);
  }

  messageKey(accountId: string, folderId: string, uidValidity: string, uid: number): string {
    // folderId is part of the key: UIDVALIDITY is per-mailbox and can coincide across
    // folders, and UIDs repeat in every folder. Without the folder this collides.
    return crypto.createHash('sha1').update(`${accountId}|${folderId}|${uidValidity}|${uid}`).digest('hex');
  }

  // ----- Task 4: operation journal -------------------------------------------
  /** Journal an operation BEFORE any server contact. Returns the op id. */
  journalEnqueue(op: {
    id?: string; accountId: string; kind: 'flag' | 'move' | 'move_batch' | 'delete' | 'expunge' | 'send' | 'draft_save' | 'draft_delete' | 'folder_create' | 'folder_rename' | 'folder_delete';
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

  /** I1: sends whose outcome is unknown; the startup replay probes them (never resends). */
  journalUnknownSends(limit = 20): JournalRow[] {
    return this.db.prepare(`SELECT * FROM op_journal WHERE kind = 'send' AND state = 'unknown'
      ORDER BY created_at LIMIT ?`).all(limit) as JournalRow[];
  }

  /** Does any pending/running op touch this message (by local row id)? */
  opInFlightForMessageKey(messageKey: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM op_journal WHERE message_key = ?
      AND state IN ('pending','running') LIMIT 1`).get(messageKey);
  }

  /** I3: the ops the user may have to look at - every one not done or cancelled, oldest first. */
  journalOpen(limit = 200): JournalRow[] {
    return this.db.prepare(`SELECT * FROM op_journal WHERE state NOT IN ('done','cancelled')
      ORDER BY created_at LIMIT ?`).all(limit) as JournalRow[];
  }

  /** I3 (MR-29): pending ops that failed at least once (they carry the error), oldest first. */
  journalFailedPending(limit = 200): JournalRow[] {
    return this.db.prepare(`SELECT * FROM op_journal WHERE state = 'pending' AND error IS NOT NULL
      ORDER BY created_at LIMIT ?`).all(limit) as JournalRow[];
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

  /**
   * B1: the local half of a RENAME, in ONE transaction: the folder and every
   * subfolder get their new path and a new id (sha1(account|newPath)), and their
   * messages get the new folder_id and message_key. Files are not touched (A3).
   *
   * With `keepUids` the messages keep their UIDs (UIDVALIDITY survived);
   * without it the rows are dropped, so the normal UIDVALIDITY swap re-downloads.
   * Returns how many folders were re-keyed.
   *
   * I4 (MR-31): the target row may exist already - a folder LIST between the server RENAME
   * and this re-key, or a crash before it, created it, and a sync may have filled it. The
   * INSERT then failed on the primary key, the op went back to `pending` and blocked every
   * folder op in the subtree. Now the re-key merges: with `keepUids` the moved rows win and
   * the target's copies are dropped (same UIDs, same message keys); without it the target
   * row is the server's current view and stays, and only the old rows go. Files are left to
   * the orphan sweep as everywhere else here.
   */
  rekeyFolder(from: string, to: string, keepUids: boolean): number {
    const affected = this.allFolders().filter((f) => isPathOrChild(f.imap_path, from, f.delimiter));
    if (affected.length === 0) return 0;
    const tx = this.db.transaction(() => {
      for (const folder of affected) {
        const newPath = renamedPath(folder.imap_path, from, to, folder.delimiter);
        const newId = crypto.createHash('sha1').update(`${this.accountId}|${newPath}`).digest('hex').slice(0, 16);
        // uid_validity is a folder column, not a message one
        const validity = folder.uid_validity ?? '';
        const existing = this.getFolderByPath(newPath);
        if (existing && !keepUids) {
          this.db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folder.id);
          this.db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
          continue;
        }
        if (existing) {
          this.db.prepare('DELETE FROM messages WHERE folder_id = ?').run(existing.id);
          this.db.prepare('DELETE FROM folders WHERE id = ?').run(existing.id);
        }
        // The new row goes in first: the messages carry a foreign key to it, so the
        // old row cannot be removed before they point at the new one.
        this.db.prepare(`INSERT INTO folders (id, account_id, imap_path, delimiter, special_use,
            uid_validity, uid_next, highest_modseq, last_sync_at, last_flag_sweep)
          SELECT @newId, account_id, @newPath, delimiter, special_use, uid_validity, uid_next,
            highest_modseq, last_sync_at, last_flag_sweep FROM folders WHERE id = @oldId`)
          .run({ newId, newPath, oldId: folder.id });
        if (keepUids) {
          // The UIDs stay valid: re-key the rows and their message keys
          const rows = this.db.prepare('SELECT id, uid FROM messages WHERE folder_id = ?')
            .all(folder.id) as { id: number; uid: number }[];
          for (const row of rows) {
            this.db.prepare('UPDATE messages SET folder_id = @fid, message_key = @key WHERE id = @id')
              .run({
                fid: newId,
                key: this.messageKey(this.accountId, newId, validity, row.uid),
                id: row.id,
              });
          }
        } else {
          // UIDVALIDITY changed: the mail is re-downloaded under the new folder
          this.db.prepare('DELETE FROM messages WHERE folder_id = ?').run(folder.id);
        }
        this.db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
      }
    });
    tx();
    return affected.length;
  }

  /** B1: drop a folder row after a DELETE (it was empty by the time it ran) */
  deleteFolderRow(id: string): void {
    this.db.prepare('DELETE FROM folders WHERE id = ?').run(id);
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
  /** Row, body and FTS entry in one transaction: every message has exactly one of each
   * (the delete trigger relies on it, see migration 2). */
  insertMessage(m: Omit<MessageRow, 'id'> & { sort_date?: string | null }): number {
    const withSort = { ...m, sort_date: m.sort_date ?? m.date ?? m.internal_date ?? null };
    const tx = this.db.transaction(() => {
      // MR-28: a row id is never handed out twice. SQLite reuses the id of a deleted newest row, and
      // the mail linker, which reads the rows after its cursor, would never see the new mail.
      const id = this.nextMessageId();
      this.db.prepare(`INSERT INTO messages (
        id, account_id, folder_id, uid, message_key, file_path, message_id, in_reply_to, references_json, thread_id,
        date, internal_date, sort_date, subject, from_name, from_email, to_json, cc_json, bcc_json, flags_json, modseq,
        has_attachments, attachments_json, size_bytes, snippet, parsed_ok, parse_error)
        VALUES (@id, @account_id, @folder_id, @uid, @message_key, @file_path, @message_id, @in_reply_to, @references_json, @thread_id,
        @date, @internal_date, @sort_date, @subject, @from_name, @from_email, @to_json, @cc_json, @bcc_json, @flags_json, @modseq,
        @has_attachments, @attachments_json, @size_bytes, @snippet, @parsed_ok, @parse_error)`)
        .run({ ...withSort, id });
      this.db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('message_id_high', ?)").run(String(id));
      const body = { id, body_text: m.body_text ?? '', body_html: m.body_html ?? null };
      this.db.prepare('INSERT INTO message_bodies (id, body_text, body_html) VALUES (@id, @body_text, @body_html)').run(body);
      this.db.prepare(`INSERT INTO fts(rowid, subject, from_name, from_email, to_json, body_text, attachments_json)
        VALUES (@id, @subject, @from_name, @from_email, @to_json, @body_text, @attachments_json)`)
        .run({ ...withSort, ...body });
      return id;
    });
    return tx();
  }

  /** The id after the highest one this store ever issued, whether or not that row still exists. */
  private nextMessageId(): number {
    const row = this.db.prepare(`SELECT MAX(COALESCE((SELECT MAX(id) FROM messages), 0),
      COALESCE((SELECT CAST(value AS INTEGER) FROM kv WHERE key = 'message_id_high'), 0)) + 1 AS id`).get() as { id: number };
    return row.id;
  }

  /**
   * MR-28: this store file's identity. A store that was rebuilt or replaced starts with a new one, so a
   * position in its row ids (the mail linker's cursor) is trusted only for the store that issued it.
   */
  generation(): string {
    const read = () => (this.db.prepare("SELECT value FROM kv WHERE key = 'store_generation'").get() as { value: string } | undefined)?.value;
    const existing = read();
    if (existing) return existing;
    this.db.prepare("INSERT OR IGNORE INTO kv (key, value) VALUES ('store_generation', ?)").run(crypto.randomUUID());
    return read()!;
  }

  /** Full row including the body; lists read the slim messages columns instead. */
  getMessage(id: number): MessageRow | undefined {
    return this.db.prepare(`${Store.FULL_ROW} WHERE m.id = ?`).get(id) as MessageRow | undefined;
  }

  getByKey(messageKey: string): MessageRow | undefined {
    return this.db.prepare(`${Store.FULL_ROW} WHERE m.message_key = ?`).get(messageKey) as MessageRow | undefined;
  }

  private static readonly FULL_ROW = `SELECT m.*, COALESCE(b.body_text, '') AS body_text, b.body_html AS body_html
    FROM messages m LEFT JOIN message_bodies b ON b.id = m.id`;

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
      snippet=@snippet, parsed_ok=@parsed_ok, parse_error=@parse_error
      WHERE id=@id`);
    const body = this.db.prepare(`INSERT INTO message_bodies (id, body_text, body_html) VALUES (@id, @body_text, @body_html)
      ON CONFLICT(id) DO UPDATE SET body_text=excluded.body_text, body_html=excluded.body_html`);
    const tx = this.db.transaction(() => {
      ftsDelete.run(row);
      update.run({ ...merged, sort_date: merged.sort_date ?? merged.date ?? merged.internal_date ?? null });
      body.run({ id, body_text: merged.body_text ?? '', body_html: merged.body_html ?? null });
      ftsInsert.run({ ...merged, body_text: merged.body_text ?? '' });
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

  /**
   * G2/L2: the list of one folder, without the mails a pending move is taking out of it.
   *
   * A move is journaled and then run against the server, which takes time on a real mailbox.
   * Until it lands, the row still points at the source folder, so the mail would appear both
   * here and - after the resync - in the target: it seems not to have moved, then to be there
   * twice. Excluding the in-flight keys is what makes the move look like it happened.
   *
   * The row itself is deliberately NOT rewritten before the server acks: a local-only move would
   * be lost on a crash and could not be undone by replaying the journal. This is a read-side
   * filter, so the journal stays the single source of truth.
   *
   * A single move stores its `message_key`; a batch stores its members in the payload, so both
   * shapes are checked - a batch delete is the common case and must not slip through.
   */
  listByFolder(folderId: string, offset: number, limit: number): MessageRow[] {
    return this.db.prepare(`SELECT * FROM messages m WHERE m.folder_id = @folderId
      AND NOT EXISTS (SELECT 1 FROM op_journal o
        WHERE o.state IN ('pending','running')
          AND (
            (o.target_folder_path IS NOT NULL
              AND (o.message_key = m.message_key
                OR (o.kind = 'move_batch' AND EXISTS (
                  SELECT 1 FROM json_each(o.payload, '$.members') mem
                  WHERE json_extract(mem.value, '$.messageKey') = m.message_key))))
            OR (o.kind = 'expunge' AND o.message_key = m.message_key)
          ))
      ORDER BY m.sort_date DESC LIMIT @limit OFFSET @offset`)
      .all({ folderId, limit, offset }) as MessageRow[];
  }

  /** G2/L2: the same exclusion for the count, so the folder's total matches its list */
  countByFolder(folderId: string): { total: number; unread: number } {
    const row = this.db.prepare(`SELECT COUNT(*) c,
        SUM(CASE WHEN m.flags_json NOT LIKE '%"seen":true%' THEN 1 ELSE 0 END) u
      FROM messages m WHERE m.folder_id = ?
      AND NOT EXISTS (SELECT 1 FROM op_journal o
        WHERE o.state IN ('pending','running')
          AND (
            (o.target_folder_path IS NOT NULL
              AND (o.message_key = m.message_key
                OR (o.kind = 'move_batch' AND EXISTS (
                  SELECT 1 FROM json_each(o.payload, '$.members') mem
                  WHERE json_extract(mem.value, '$.messageKey') = m.message_key))))
            OR (o.kind = 'expunge' AND o.message_key = m.message_key)
          ))`)
      .get(folderId) as { c: number; u: number | null };
    return { total: row.c, unread: row.u ?? 0 };
  }

  // contacts -----------------------------------------------------------------
  upsertContact(email: string, name: string): void {
    // an address is only useful with an @; records with an empty email column must not pollute this
    if (!email || !email.includes('@')) return
    // G9: this used @name in the SQL but passed positional parameters, so EVERY call threw
    // "Missing named parameters" - which is why the contacts table stayed empty even once a caller
    // existed. Named parameters throughout now.
    this.db.prepare(`INSERT INTO contacts (email, name, last_seen) VALUES (@email, @name, datetime('now'))
      ON CONFLICT(email) DO UPDATE SET name = CASE WHEN @name != '' THEN @name ELSE contacts.name END, last_seen = datetime('now')`)
      .run({ email: email.toLowerCase(), name });
  }

  /**
   * G9: remember every address a stored message mentions, so the compose lookup finds people you have
   * corresponded with.
   *
   * This table was NEVER populated: rebuildContactsFromMessages() existed but had no caller, and
   * upsertContact() was only called from inside it. So "Aus E-Mails" was permanently empty and typing a
   * sender's name or domain found nothing - the mail-history half of the lookup never worked at all.
   *
   * Both directions matter: the From is who you would reply to, the To/Cc are people the sender already
   * considers relevant (the ionos sender in the reported case is a From).
   */
  rememberContactsOf(row: {
    from_email: string
    from_name: string
    to_json: string
    cc_json: string
  }): void {
    this.upsertContact(row.from_email, row.from_name)
    for (const json of [row.to_json, row.cc_json]) {
      let parsed: unknown
      try {
        parsed = JSON.parse(json || '[]')
      } catch {
        continue
      }
      if (!Array.isArray(parsed)) continue
      for (const entry of parsed) {
        const address = entry as { email?: unknown; name?: unknown }
        if (typeof address.email === 'string') {
          this.upsertContact(address.email, typeof address.name === 'string' ? address.name : '')
        }
      }
    }
  }

  searchContacts(partial: string, limit = 8): { name: string; email: string }[] {
    const p = `%${partial.toLowerCase()}%`;
    return this.db.prepare(`SELECT name, email FROM contacts WHERE email LIKE ? OR lower(name) LIKE ? ORDER BY last_seen DESC LIMIT ?`)
      .all(p, p, limit) as { name: string; email: string }[];
  }

  rebuildContactsFromMessages(): number {
    const rows = this.db.prepare(`SELECT from_email, from_name, to_json, cc_json FROM messages WHERE from_email != ''
      UNION SELECT json_extract(j.value, '$.email') AS from_email, json_extract(j.value, '$.name') AS from_name, '[]' AS to_json, '[]' AS cc_json
      FROM messages m, json_each(m.to_json) j`).all() as { from_email: string; from_name: string; to_json: string; cc_json: string }[];
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

  /**
   * G9: populate the contacts table from the mail already stored, exactly once.
   *
   * The table was never filled (its only writer, rebuildContactsFromMessages, had no caller), so a mailbox
   * synced before this build would still find nothing by sender name. The kv row makes it a one-time job:
   * new mail teaches the table as it arrives, so a second pass would only cost startup time.
   */
  backfillContactsOnce(): number {
    const done = this.db.prepare("SELECT value FROM kv WHERE key = 'contacts_backfilled'").get() as
      | { value: string }
      | undefined
    if (done) return 0
    const rows = this.db.prepare(`SELECT from_email, from_name, to_json, cc_json FROM messages`).all() as {
      from_email: string
      from_name: string
      to_json: string
      cc_json: string
    }[]
    const tx = this.db.transaction(() => {
      for (const row of rows) this.rememberContactsOf(row)
      this.db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('contacts_backfilled', '1')").run()
    })
    tx()
    return rows.length
  }

  // threads ------------------------------------------------------------------
  /** Newest-first thread summaries (for the conversation list). */
  listThreads(folderId: string | null, offset: number, limit: number): ThreadRow[] {
    const folderSql = folderId ? 'WHERE messages.folder_id = @folderId' : `WHERE ${NOT_STAGED}`;
    const rows = this.db.prepare(`
      SELECT messages.thread_id AS threadId, COUNT(*) AS count, MAX(messages.sort_date) AS newest,
        SUM(CASE WHEN json_extract(messages.flags_json, '$.seen') IS NOT 1 THEN 1 ELSE 0 END) AS unread,
        SUM(messages.has_attachments) AS atts,
        COUNT(DISTINCT messages.id) AS n
      FROM messages ${folderSql}
      GROUP BY messages.thread_id
      HAVING messages.thread_id IS NOT NULL
      ORDER BY newest DESC
      LIMIT @limit OFFSET @offset`).all({ folderId, limit, offset }) as ThreadAggRow[];
    if (!rows.length) return [];
    // fetch newest message per thread (subject/from/snippet/ids) in one query
    const ids = new Set<string>(rows.map(r => r.threadId));
    const placeholders = [...ids].map(() => '?').join(',');
    const msgs = this.db.prepare(`
      SELECT id, thread_id, subject, from_name, snippet, sort_date FROM messages
      WHERE thread_id IN (${placeholders}) AND ${NOT_STAGED}
      ORDER BY sort_date DESC`).all(...ids) as ThreadMessageRow[];
    const byThread = new Map<string, ThreadMessageRow[]>();
    for (const m of msgs) {
      const arr = byThread.get(m.thread_id) || [];
      arr.push(m);
      byThread.set(m.thread_id, arr);
    }
    return rows.map(r => {
      const list = (byThread.get(r.threadId) || []).sort((a, b) => (b.sort_date || '').localeCompare(a.sort_date || ''));
      const newest = list[0];
      return {
        threadId: r.threadId,
        count: r.count,
        subject: newest?.subject || '(no subject)',
        fromName: newest?.from_name || '',
        date: newest?.sort_date || r.newest || null,
        unread: r.unread || 0,
        hasAttachments: (r.atts || 0) > 0,
        snippet: newest?.snippet || '',
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
    where.push(NOT_STAGED);
    const whereSql = 'WHERE ' + where.join(' AND ');
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

  /** MR-27: the folding of the FTS tokenizer (unicode61 remove_diacritics 2), lower case without
   * diacritics. fts_vocab holds folded terms, so a probe has to be folded the same way. */
  static foldFtsTerm(word: string): string {
    return word.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  }

  ftsEscapeUserQuery(q: string): string {
    const tokens: MatchToken[] = q.split(/\s+/)
      .map(t => t.replace(/[*(){}:^-]/g, ' ').trim())
      .filter(t => t.length >= Store.MIN_FTS_TERM_LEN || isFtsOperator(t))
      // A boolean keyword stays an operator: quoting it would search for the
      // literal word "OR" and silently return nothing
      .map(t => isFtsOperator(t) ? { op: t } : { word: t });
    return buildMatchExpr(tidyOperators(tokens));
  }

  /** Prefix-cost guard: estimate how many rows a prefix term would match via the
   * fts5vocab table (cheap B-tree range scan) BEFORE running the MATCH. A 3-char
   * German prefix like "ver" expands to ~100k+ doclist entries and blocked the loop
   * 5–9 s per query (measured 2026-10-23). Returns a replacement expression with
   * pathological prefixes dropped (keeping safe terms so the search still answers). */
  capPathologicalPrefixes(matchExpr: string): string {
    const MAX_PREFIX_DOCS = 20_000;   // ~doclist size the loop can chew in <200 ms
    const kept: MatchToken[] = [];
    for (const token of parseMatchExpr(matchExpr)) {
      if ('op' in token) { kept.push(token); continue; }
      // MR-27: the vocabulary is folded, so an unfolded probe ("Ver") counted nothing and was never capped
      const word = Store.foldFtsTerm(token.word);
      if (!word) { kept.push(token); continue; }
      // exact-cost probe: count vocab entries with this prefix
      const row = this.db.prepare(
        `SELECT COUNT(*) c, SUM(doc) docs FROM fts_vocab WHERE term >= ? AND term < ?`
      ).get(word, word.slice(0, -1) + String.fromCharCode(word.charCodeAt(word.length - 1) + 1)) as { c: number; docs: number | null };
      const docs = row?.docs ?? 0;
      if (docs > MAX_PREFIX_DOCS) {
        console.log(`[search] prefix "${word}*" capped: ~${docs} docs (limit ${MAX_PREFIX_DOCS}) — term dropped`);
        // a NOT goes with its term; left behind it would negate the next one
        const last = kept[kept.length - 1];
        if (last && 'op' in last && last.op === 'NOT') kept.pop();
        continue;
      }
      kept.push(token);
    }
    return buildMatchExpr(tidyOperators(kept));
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
    if (opts.folderId) { where.push('messages.folder_id = @folderId'); params.folderId = opts.folderId; } else where.push(NOT_STAGED);
    if (opts.from) { where.push('(messages.from_name LIKE @from OR messages.from_email LIKE @from)'); params.from = `%${opts.from.toLowerCase()}%`; }
    if (opts.to) { where.push('messages.to_json LIKE @to'); params.to = `%${opts.to.toLowerCase()}%`; }
    if (opts.subject) { where.push('messages.subject LIKE @subject'); params.subject = `%${opts.subject.toLowerCase()}%`; }
    if (opts.hasAttachment) where.push('messages.has_attachments = 1');
    if (opts.after) { where.push('COALESCE(messages.date, messages.internal_date) >= @after'); params.after = opts.after; }
    if (opts.before) { where.push('COALESCE(messages.date, messages.internal_date) <= @before'); params.before = opts.before; }
    const whereSql = 'WHERE ' + where.join(' AND ');
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
      if (opts.folderId) { cond.push('messages.folder_id = @folderId'); rp.folderId = opts.folderId; } else cond.push(NOT_STAGED);
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
