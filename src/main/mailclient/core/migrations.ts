// Versioned schema migrations for the per-account mail DB, counted in PRAGMA user_version.
// Rules:
//  - Append only. A migration that has shipped is never edited; fix forward with a new one.
//  - Each migration runs in its own IMMEDIATE transaction together with the user_version
//    bump: it lands completely or not at all, and a crash in between leaves the old schema.
//  - A DB from a newer build (user_version above the last migration here) is refused, never
//    "repaired": an older build must not write to a schema it does not know.
//  - foreign_keys cannot change inside a transaction. A migration that rebuilds a table has
//    to work with them on (create new, copy, drop old) and check PRAGMA foreign_key_check.
import type BetterSqlite3 from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up(db: BetterSqlite3.Database): void;
}

/** The DB was written by a newer build; opening it here could lose data. */
export class StoreVersionError extends Error {
  readonly code = 'MAIL_STORE_TOO_NEW';
  constructor(readonly found: number, readonly known: number) {
    super(`Mail store has schema version ${found}, this build knows up to ${known}: `
      + 'it was written by a newer version of the app. Not opened, so nothing is changed.');
    this.name = 'StoreVersionError';
  }
}

export function schemaVersion(db: BetterSqlite3.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Bring `db` up to the last migration. Returns the versions applied by this call
 * (empty when the DB was current). Throws StoreVersionError for a DB that is newer
 * than `migrations`; a failing migration throws and leaves the DB at the version before it.
 */
export function runMigrations(db: BetterSqlite3.Database, migrations: readonly Migration[] = MIGRATIONS): number[] {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`migrations must be numbered 1..n in order (found ${m.version} at ${i + 1})`);
  });
  const latest = migrations.length;
  const current = schemaVersion(db);
  if (current > latest) throw new StoreVersionError(current, latest);

  const applied: number[] = [];
  for (const m of migrations.slice(current)) {
    const step = db.transaction(() => {
      // re-read under the write lock: another connection may have migrated meanwhile
      if (schemaVersion(db) >= m.version) return false;
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
      return true;
    });
    try {
      if (step.immediate()) applied.push(m.version);
    } catch (err) {
      throw new Error(`mail store migration ${m.version} (${m.name}) failed: ${(err as Error).message}`, { cause: err });
    }
  }
  return applied;
}

/**
 * 1: the schema as it was before versioning. DBs from that time are at user_version 0
 * and already have some or all of it, so this one stays idempotent (IF NOT EXISTS,
 * column checks) and adopts them. Every later migration can assume version 1 exactly.
 */
function baseline(db: BetterSqlite3.Database): void {
  db.exec(`
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
  const hasSort = db.prepare("SELECT COUNT(*) c FROM pragma_table_info('messages') WHERE name = 'sort_date'").get() as { c: number };
  if (!hasSort.c) {
    db.exec(`ALTER TABLE messages ADD COLUMN sort_date TEXT;
      UPDATE messages SET sort_date = COALESCE(date, internal_date);`);
  }
  // needs the column (created above for old DBs; present from CREATE for new ones)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sort ON messages(folder_id, sort_date DESC)`);
  // Task 3: vocabulary table for prefix-cost pre-checks. A slow typist fires one
  // search per prefix ("v"*, "ve"*, "ver"*…); German prefixes over 32k mails build
  // doclists in the hundreds of thousands and block the single thread for 10s+ per
  // query (measured 2026-10-23). fts5vocab lets us estimate the doclist size with a
  // cheap B-tree range scan BEFORE running the pathological MATCH.
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS fts_vocab USING fts5vocab('fts', 'row')`);
  // global search sorts across ALL folders by sort_date; without this index SQLite
  // materializes every matching row (each ~75 KB with overflow pages) into a temp
  // B-tree before sorting — measured 1.2-2.1 s on 20k hits. With it, the planner can
  // walk rows already in sort order and test the FTS predicate per row, stopping after
  // LIMIT rows (measured <10 ms for the first page).
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sort_date ON messages(sort_date DESC)`);
  // migration for DBs created before last_flag_sweep existed (Task 3, flag tiers)
  const hasSweep = db.prepare("SELECT COUNT(*) c FROM pragma_table_info('folders') WHERE name = 'last_flag_sweep'").get() as { c: number };
  if (!hasSweep.c) {
    db.exec(`ALTER TABLE folders ADD COLUMN last_flag_sweep TEXT`);
  }
  // Task 4: prune debounce column
  const hasAbsent = db.prepare("SELECT COUNT(*) c FROM pragma_table_info('folders') WHERE name = 'list_absent_since'").get() as { c: number };
  if (!hasAbsent.c) {
    db.exec(`ALTER TABLE folders ADD COLUMN list_absent_since TEXT`);
  }
  // Task 4: operation journal (write path). Journal-first: every user action is
  // committed here BEFORE any server contact; crash-safe via WAL. See
  // docs/WRITE_PATH.md §1 for the state machine and rationale.
  db.exec(`CREATE TABLE IF NOT EXISTS op_journal (
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

/**
 * 2: bodies leave the messages table. A row was ~75 KB with its text and HTML on overflow
 * pages, so every list query, sort and flag sweep dragged them along. Now
 * message_bodies holds them (same id, one row per message, deleted with it), and
 * messages keeps only what lists and search filters need.
 *
 * The FTS index is external-content and reads column values back (snippet(),
 * integrity-check, rebuild), so it now reads them through the fts_source view. Index
 * writes stay explicit in Store (insert, update) apart from the delete trigger, which
 * runs BEFORE the delete so the body is still there to take out of the index. Every
 * message is indexed with COALESCE(body, ''), in the view and in the trigger alike.
 */
function splitBodies(db: BetterSqlite3.Database): void {
  db.exec(`
CREATE TABLE message_bodies (
  id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT
);
INSERT INTO message_bodies (id, body_text, body_html) SELECT id, body_text, body_html FROM messages;

-- the index and its triggers name the old columns; they go first and are rebuilt below
DROP TRIGGER IF EXISTS messages_ai;
DROP TRIGGER IF EXISTS messages_ad;
DROP TABLE IF EXISTS fts_vocab;
DROP TABLE IF EXISTS fts;
ALTER TABLE messages DROP COLUMN body_text;
ALTER TABLE messages DROP COLUMN body_html;

CREATE VIEW fts_source AS
  SELECT m.id AS id, m.subject AS subject, m.from_name AS from_name, m.from_email AS from_email,
    m.to_json AS to_json, COALESCE(b.body_text, '') AS body_text, m.attachments_json AS attachments_json
  FROM messages m LEFT JOIN message_bodies b ON b.id = m.id;
CREATE VIRTUAL TABLE fts USING fts5(
  subject, from_name, from_email, to_json, body_text, attachments_json,
  content='fts_source', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);
INSERT INTO fts(fts) VALUES('rebuild');
CREATE VIRTUAL TABLE fts_vocab USING fts5vocab('fts', 'row');
CREATE TRIGGER messages_bd BEFORE DELETE ON messages BEGIN
  INSERT INTO fts(fts, rowid, subject, from_name, from_email, to_json, body_text, attachments_json)
  VALUES ('delete', old.id, old.subject, old.from_name, old.from_email, old.to_json,
    COALESCE((SELECT body_text FROM message_bodies WHERE id = old.id), ''), old.attachments_json);
END;
`);
}

/**
 * 3 (I12, MR-26): the file map salvaged from a quarantined store. Folder path, UIDVALIDITY and
 * UID name a message on the server for good, so a rebuilt store adopts the `.eml` already on
 * disk instead of downloading it again. A row goes when its message is stored, or after the
 * orphan TTL; until then the orphan sweep leaves its file alone.
 */
function relinks(db: BetterSqlite3.Database): void {
  db.exec(`
CREATE TABLE relinks (
  imap_path TEXT NOT NULL,
  uid_validity TEXT NOT NULL,
  uid INTEGER NOT NULL,
  file_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (imap_path, uid_validity, uid)
) WITHOUT ROWID;
`);
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'baseline', up: baseline },
  { version: 2, name: 'split bodies', up: splitBodies },
  { version: 3, name: 'relinks', up: relinks },
];

export const SCHEMA_VERSION = MIGRATIONS.length;
