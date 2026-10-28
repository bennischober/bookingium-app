// Versioned migrations of the per-account mail DB (PRAGMA user_version): fresh stores,
// stores from before versioning, stores from a newer build and failing migrations
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MIGRATIONS,
  runMigrations,
  SCHEMA_VERSION,
  schemaVersion,
  StoreVersionError,
  type Migration
} from '../src/main/mailclient/core/migrations'
import { Store, type MessageRow } from '../src/main/mailclient/core/store'
import { createMailCore } from '../src/main/mailclient/core/index'

const ACCOUNT = 'acc'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookingum-mail-migrations-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function open(dir: string): Store {
  const store = new Store(dir, ACCOUNT)
  cleanups.push(() => store.db.open && store.close())
  return store
}

const dbFile = (dir: string): string => path.join(dir, `${ACCOUNT}.db`)

const columns = (db: Database.Database, table: string): string[] =>
  (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[]).map(
    (r) => r.name
  )

const tables = (db: Database.Database): string[] =>
  (
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
  ).map((r) => r.name)

/**
 * The oldest schema the prototype shipped: no sort_date, no flag sweep or prune
 * columns, no op journal, no vocabulary table; user_version never set
 */
function writeLegacyDb(dir: string): void {
  const db = new Database(dbFile(dir))
  db.exec(`
CREATE TABLE folders (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL, imap_path TEXT NOT NULL,
  delimiter TEXT NOT NULL DEFAULT '/', special_use TEXT, uid_validity TEXT, uid_next INTEGER,
  highest_modseq TEXT, last_sync_at TEXT, UNIQUE(account_id, imap_path)
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY, account_id TEXT NOT NULL, folder_id TEXT NOT NULL REFERENCES folders(id),
  uid INTEGER NOT NULL, message_key TEXT NOT NULL UNIQUE, file_path TEXT NOT NULL,
  message_id TEXT, in_reply_to TEXT, references_json TEXT NOT NULL DEFAULT '[]', thread_id TEXT,
  date TEXT, internal_date TEXT, subject TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '', to_json TEXT NOT NULL DEFAULT '[]', cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]', flags_json TEXT NOT NULL DEFAULT '{}', modseq TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0, attachments_json TEXT NOT NULL DEFAULT '[]',
  size_bytes INTEGER NOT NULL DEFAULT 0, body_text TEXT NOT NULL DEFAULT '', body_html TEXT,
  snippet TEXT NOT NULL DEFAULT '', parsed_ok INTEGER NOT NULL DEFAULT 1, parse_error TEXT
);
CREATE VIRTUAL TABLE fts USING fts5(
  subject, from_name, from_email, to_json, body_text, attachments_json,
  content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
);
CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO fts(rowid, subject, from_name, from_email, to_json, body_text, attachments_json)
  VALUES (new.id, new.subject, new.from_name, new.from_email, new.to_json, new.body_text, new.attachments_json);
END;
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE contacts (email TEXT PRIMARY KEY, name TEXT, last_seen TEXT);
INSERT INTO folders (id, account_id, imap_path) VALUES ('f1', '${ACCOUNT}', 'INBOX');
INSERT INTO messages (account_id, folder_id, uid, message_key, file_path, internal_date, subject, body_text)
  VALUES ('${ACCOUNT}', 'f1', 7, 'k7', '${ACCOUNT}/k7.eml', '2026-01-02T03:04:05.000Z', 'Testbetreff', 'Platzhalter');
`)
  db.close()
}

describe('mail store migrations', () => {
  it('builds a fresh store at the latest version', () => {
    const store = open(tempDir())
    expect(schemaVersion(store.db)).toBe(SCHEMA_VERSION)
    expect(tables(store.db)).toEqual(
      expect.arrayContaining([
        'folders',
        'messages',
        'kv',
        'contacts',
        'op_journal',
        'fts',
        'fts_vocab'
      ])
    )
    expect(columns(store.db, 'messages')).toContain('sort_date')
  })

  it('does nothing when a current store is opened again', () => {
    const dir = tempDir()
    open(dir).close()
    const store = open(dir)
    expect(runMigrations(store.db)).toEqual([])
    expect(schemaVersion(store.db)).toBe(SCHEMA_VERSION)
  })

  it('adopts a store from before versioning and keeps its data', () => {
    const dir = tempDir()
    writeLegacyDb(dir)
    const store = open(dir)

    expect(schemaVersion(store.db)).toBe(SCHEMA_VERSION)
    expect(columns(store.db, 'messages')).toContain('sort_date')
    expect(columns(store.db, 'folders')).toEqual(
      expect.arrayContaining(['last_flag_sweep', 'list_absent_since'])
    )
    expect(tables(store.db)).toEqual(expect.arrayContaining(['op_journal', 'fts_vocab']))

    const row = store.db.prepare('SELECT uid, sort_date FROM messages').get() as {
      uid: number
      sort_date: string
    }
    expect(row).toEqual({ uid: 7, sort_date: '2026-01-02T03:04:05.000Z' })
    // the search index survived and stays consistent
    expect(() => store.db.exec(`INSERT INTO fts(fts) VALUES('integrity-check')`)).not.toThrow()
    expect(
      store.db.prepare(`SELECT rowid FROM fts WHERE fts MATCH 'testbetreff'`).all()
    ).toHaveLength(1)

    // migration 2: the body left the messages table and is still found
    expect(columns(store.db, 'messages')).not.toContain('body_text')
    expect(store.getByKey('k7')).toMatchObject({ body_text: 'Platzhalter', body_html: null })
    expect(
      store.db.prepare(`SELECT rowid FROM fts WHERE fts MATCH 'platzhalter'`).all()
    ).toHaveLength(1)
  })

  it('adopts an unversioned store that already has the whole schema', () => {
    const dir = tempDir()
    // the newest schema from before versioning is what migration 1 builds
    const first = new Database(dbFile(dir))
    runMigrations(first, MIGRATIONS.slice(0, 1))
    first.prepare(`INSERT INTO kv (key, value) VALUES ('marker', 'kept')`).run()
    first.pragma('user_version = 0')
    first.close()

    const store = open(dir)
    expect(schemaVersion(store.db)).toBe(SCHEMA_VERSION)
    expect(store.db.prepare(`SELECT value FROM kv WHERE key = 'marker'`).get()).toEqual({
      value: 'kept'
    })
  })

  it('refuses a store from a newer build and leaves it untouched', () => {
    const dir = tempDir()
    const first = open(dir)
    first.db.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    first.close()

    let error: unknown
    try {
      open(dir)
    } catch (err) {
      error = err
    }
    expect(error).toBeInstanceOf(StoreVersionError)
    expect(error).toMatchObject({
      code: 'MAIL_STORE_TOO_NEW',
      found: SCHEMA_VERSION + 1,
      known: SCHEMA_VERSION
    })

    // the refused store let go of the file and was not changed
    const db = new Database(dbFile(dir))
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION + 1)
    db.close()
  })
})

describe('runMigrations', () => {
  const memoryDb = (): Database.Database => {
    const db = new Database(':memory:')
    cleanups.push(() => db.close())
    return db
  }

  const first: Migration = {
    version: 1,
    name: 'first',
    up: (db) => db.exec('CREATE TABLE a (x INTEGER)')
  }

  it('rolls back a failing migration and keeps the version before it', () => {
    const db = memoryDb()
    const broken: Migration = {
      version: 2,
      name: 'broken',
      up: (d) => {
        d.exec('CREATE TABLE b (y INTEGER)')
        d.exec('INSERT INTO a (x) VALUES (1)')
        throw new Error('boom')
      }
    }
    expect(() => runMigrations(db, [first, broken])).toThrow(/migration 2 \(broken\) failed: boom/)
    expect(schemaVersion(db)).toBe(1)
    expect(tables(db)).toEqual(['a'])
    expect(db.prepare('SELECT COUNT(*) AS n FROM a').get()).toEqual({ n: 0 })

    // a fixed build picks up where the failed one stopped
    const fixed: Migration = { ...broken, up: (d) => d.exec('CREATE TABLE b (y INTEGER)') }
    expect(runMigrations(db, [first, fixed])).toEqual([2])
    expect(schemaVersion(db)).toBe(2)
  })

  it('rejects a list with gaps or out of order', () => {
    const db = memoryDb()
    expect(() => runMigrations(db, [{ ...first, version: 2 }])).toThrow(/numbered 1\.\.n/)
    expect(schemaVersion(db)).toBe(0)
  })

  it('numbers the shipped migrations 1..n', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1))
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length)
  })
})

let n = 0
function message(folderId: string, subject: string, body: string): Omit<MessageRow, 'id'> {
  n++
  return {
    account_id: ACCOUNT,
    folder_id: folderId,
    uid: n,
    message_key: `key-${n}`,
    file_path: `key-${n}.eml`,
    message_id: null,
    in_reply_to: null,
    references_json: '[]',
    thread_id: null,
    date: '2026-03-04T05:06:07.000Z',
    internal_date: null,
    subject,
    from_name: '',
    from_email: '',
    to_json: '[]',
    cc_json: '[]',
    bcc_json: '[]',
    flags_json: '{}',
    modseq: null,
    has_attachments: 0,
    attachments_json: '[]',
    size_bytes: 0,
    body_text: body,
    body_html: `<p>${body}</p>`,
    snippet: '',
    parsed_ok: 1,
    parse_error: null
  }
}

function storeWithFolder(): { store: Store; folderId: string } {
  const store = open(tempDir())
  const folder = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
  return { store, folderId: folder.id }
}

describe('message bodies (migration 2)', () => {
  const hits = (store: Store, word: string): number[] =>
    store
      .search({ matchExpr: store.ftsEscapeUserQuery(word), limit: 50, offset: 0 })
      .rows.map((r) => r.id)

  it('stores the body apart and finds it through search and snippets', () => {
    const { store, folderId } = storeWithFolder()
    const id = store.insertMessage(message(folderId, 'Betreff eins', 'Zitronenkuchen am Freitag'))

    expect(
      store.db.prepare('SELECT body_text, body_html FROM message_bodies WHERE id = ?').get(id)
    ).toEqual({
      body_text: 'Zitronenkuchen am Freitag',
      body_html: '<p>Zitronenkuchen am Freitag</p>'
    })
    expect(store.getMessage(id)).toMatchObject({
      subject: 'Betreff eins',
      body_text: 'Zitronenkuchen am Freitag'
    })
    expect(hits(store, 'zitronen')).toEqual([id])
    expect(store.searchSnippets(store.ftsEscapeUserQuery('zitronen'), [id])[id]).toContain(
      '[Zitronenkuchen]'
    )
    // lists stay slim
    expect(store.listByFolder(folderId, 0, 10)[0]).not.toHaveProperty('body_text')
    expect(store.ftsIntegrityCheck()).toBe(true)
  })

  it('reindexes a changed body', () => {
    const { store, folderId } = storeWithFolder()
    const id = store.insertMessage(message(folderId, 'Betreff zwei', 'Apfelstrudel'))
    store.updateMessage(id, { body_text: 'Kirschtorte', body_html: null })

    expect(store.getMessage(id)).toMatchObject({ body_text: 'Kirschtorte', body_html: null })
    expect(hits(store, 'apfelstrudel')).toEqual([])
    expect(hits(store, 'kirschtorte')).toEqual([id])
    expect(store.ftsIntegrityCheck()).toBe(true)
  })

  it('removes body and index entry with the message, also on a plain DELETE', () => {
    const { store, folderId } = storeWithFolder()
    const a = store.insertMessage(message(folderId, 'Betreff drei', 'Pflaumenmus'))
    const b = store.insertMessage(message(folderId, 'Betreff vier', 'Pflaumenmus'))

    store.deleteMessages([a])
    // the sync's folder swap deletes rows with raw SQL
    store.db.prepare('DELETE FROM messages WHERE id = ?').run(b)

    expect(store.db.prepare('SELECT COUNT(*) AS n FROM message_bodies').get()).toEqual({ n: 0 })
    expect(hits(store, 'pflaumenmus')).toEqual([])
    expect(store.ftsIntegrityCheck()).toBe(true)
  })
})

describe('complete flag (migration 5)', () => {
  it('marks every row of an adopted store complete', () => {
    const dir = tempDir()
    writeLegacyDb(dir)
    const store = open(dir)
    expect(columns(store.db, 'messages')).toContain('complete')
    expect(store.getByKey('k7')).toMatchObject({ complete: 1 })
  })

  it('stores a row complete unless told otherwise, and keeps the flag through updates', () => {
    const { store, folderId } = storeWithFolder()
    const whole = store.insertMessage(message(folderId, 'Ganz', 'Text'))
    const skeleton = store.insertMessage({ ...message(folderId, 'Skelett', 'Text'), complete: 0 })
    expect(store.getMessage(whole)?.complete).toBe(1)
    expect(store.getMessage(skeleton)?.complete).toBe(0)

    // an update that does not mention the flag keeps it
    store.updateMessage(skeleton, { subject: 'Skelett neu' })
    expect(store.getMessage(skeleton)).toMatchObject({ subject: 'Skelett neu', complete: 0 })
    // completion sets it
    store.updateMessage(skeleton, { complete: 1 })
    expect(store.getMessage(skeleton)?.complete).toBe(1)
  })

  it('reaches MessageDetail as a boolean', async () => {
    // the core keeps each account in <dataDir>/<accountId>/
    const dataDir = tempDir()
    const dir = path.join(dataDir, ACCOUNT)
    fs.mkdirSync(dir)
    const store = new Store(dir, ACCOUNT)
    const folder = store.upsertFolder({ imapPath: 'INBOX', delimiter: '/' })
    const whole = store.insertMessage(message(folder.id, 'Ganz', 'Text'))
    const skeleton = store.insertMessage({ ...message(folder.id, 'Skelett', 'Text'), complete: 0 })
    store.close()

    // nothing here talks to a server: the endpoint is unreachable on purpose
    const api = createMailCore({
      dataDir,
      accounts: [
        {
          id: ACCOUNT,
          kind: 'sandbox',
          host: '127.0.0.1',
          port: 1,
          security: 'none',
          credentials: async () => ({ user: 'a@example.test', pass: 'x' })
        }
      ]
    })
    try {
      expect((await api.getMessage(whole, ACCOUNT)).complete).toBe(true)
      expect((await api.getMessage(skeleton, ACCOUNT)).complete).toBe(false)
    } finally {
      api.close()
    }
  })
})
