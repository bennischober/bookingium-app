// ========================================
// Sync bookkeeping inside the app database
// ========================================
// The sync_* tables and triggers exist only while sync is set up; they are created here, not by
// a migration, so a database without sync has none of them. The triggers are generated from the
// live schema at every start (after the migrations), so they always list the current columns,
// and dropped before migrations run, so a migration's own data changes are not sent around.
import type Database from 'better-sqlite3'
import { LOCAL_TABLES, TEXT_KEY_TABLES, sharedSettingCondition } from './tables'

export type Sqlite = Database.Database

const BOOKKEEPING = `
CREATE TABLE IF NOT EXISTS sync_control (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  applying INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO sync_control (id, applying) VALUES (1, 0);
-- Local changes not yet packed into an outgoing batch
CREATE TABLE IF NOT EXISTS sync_change (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  op TEXT NOT NULL,
  old TEXT,
  new TEXT
);
-- Packed batches waiting to be written to the shared folder
CREATE TABLE IF NOT EXISTS sync_outbox (
  seq INTEGER PRIMARY KEY,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- How far the batches of each other computer are applied here
CREATE TABLE IF NOT EXISTS sync_peer (
  device TEXT PRIMARY KEY,
  imported_seq INTEGER NOT NULL DEFAULT 0
);
-- Last change per field (col '*' = the whole row, from its insert)
CREATE TABLE IF NOT EXISTS sync_clock (
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  col TEXT NOT NULL,
  hlc TEXT NOT NULL,
  PRIMARY KEY (tbl, pk, col)
) WITHOUT ROWID;
-- Deleted rows: a delete wins over changes to the row from elsewhere
CREATE TABLE IF NOT EXISTS sync_tomb (
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  hlc TEXT NOT NULL,
  PRIMARY KEY (tbl, pk)
) WITHOUT ROWID;
-- A row another computer created that is the same as a local one (ALIAS_KEYS)
CREATE TABLE IF NOT EXISTS sync_alias (
  tbl TEXT NOT NULL,
  remote_pk TEXT NOT NULL,
  local_pk TEXT NOT NULL,
  PRIMARY KEY (tbl, remote_pk)
) WITHOUT ROWID;
-- Changes from elsewhere that could not be applied, for the settings page
CREATE TABLE IF NOT EXISTS sync_conflict (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  device TEXT NOT NULL,
  tbl TEXT NOT NULL,
  pk TEXT NOT NULL,
  message TEXT NOT NULL,
  data TEXT
);
-- Files under storage/ as last seen or written by the sync
CREATE TABLE IF NOT EXISTS sync_file (
  path TEXT PRIMARY KEY,
  sha TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,
  hlc TEXT NOT NULL
) WITHOUT ROWID;
-- File changes waiting for the next outgoing batch
CREATE TABLE IF NOT EXISTS sync_file_change (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  sha TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  hlc TEXT NOT NULL
);
-- Files from elsewhere whose content has not arrived in the shared folder yet
CREATE TABLE IF NOT EXISTS sync_file_pending (
  path TEXT PRIMARY KEY,
  sha TEXT NOT NULL,
  hlc TEXT NOT NULL
) WITHOUT ROWID;
`

export function createBookkeeping(sqlite: Sqlite): void {
  sqlite.exec(BOOKKEEPING)
}

export function hasBookkeeping(sqlite: Sqlite): boolean {
  return !!sqlite
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_meta'")
    .get()
}

// ---------- meta ----------

export function getMeta(sqlite: Sqlite, key: string): string | null {
  const row = sqlite.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setMeta(sqlite: Sqlite, key: string, value: string | number): void {
  sqlite
    .prepare(
      'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    )
    .run(key, String(value))
}

export function getPeers(sqlite: Sqlite): Map<string, number> {
  const rows = sqlite.prepare('SELECT device, imported_seq FROM sync_peer').all() as Array<{
    device: string
    imported_seq: number
  }>
  return new Map(rows.map((row) => [row.device, row.imported_seq]))
}

export function setPeer(sqlite: Sqlite, device: string, seq: number): void {
  sqlite
    .prepare(
      'INSERT INTO sync_peer (device, imported_seq) VALUES (?, ?) ON CONFLICT(device) DO UPDATE SET imported_seq = excluded.imported_seq'
    )
    .run(device, seq)
}

/** Runs `work` with the triggers silenced: changes from elsewhere are not sent back out */
export function whileApplying<T>(sqlite: Sqlite, work: () => T): T {
  sqlite.prepare('UPDATE sync_control SET applying = 1 WHERE id = 1').run()
  try {
    return work()
  } finally {
    sqlite.prepare('UPDATE sync_control SET applying = 0 WHERE id = 1').run()
  }
}

// ---------- schema ----------

export type ColumnInfo = { name: string; notnull: number; dflt_value: string | null; pk: number }
export type ForeignKey = { from: string; table: string }

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`
export { quote as quoteIdent }

/** The app's tables the sync carries: everything but SQLite's, drizzle's, sync's and LOCAL_TABLES */
export function syncedTables(sqlite: Sqlite): string[] {
  const rows = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_\\_%' ESCAPE '\\' AND name NOT LIKE 'sync\\_%' ESCAPE '\\' ORDER BY name"
    )
    .all() as Array<{ name: string }>
  return rows.map((row) => row.name).filter((name) => !LOCAL_TABLES.has(name))
}

export function tableColumns(sqlite: Sqlite, table: string): ColumnInfo[] {
  return sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all() as ColumnInfo[]
}

export function foreignKeys(sqlite: Sqlite, table: string): ForeignKey[] {
  return (
    sqlite.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all() as Array<{
      from: string
      table: string
    }>
  ).map(({ from, table }) => ({ from, table }))
}

/** The column that identifies a row: `id`, or the text key of TEXT_KEY_TABLES */
export function keyColumn(table: string): string {
  return TEXT_KEY_TABLES[table] ?? 'id'
}

/** Cached schema facts of one database; built once per sync run */
export class SchemaInfo {
  readonly tables: string[]
  private columns = new Map<string, ColumnInfo[]>()
  private fks = new Map<string, ForeignKey[]>()

  constructor(private sqlite: Sqlite) {
    this.tables = syncedTables(sqlite)
  }

  has(table: string): boolean {
    return this.tables.includes(table)
  }

  columnsOf(table: string): ColumnInfo[] {
    let columns = this.columns.get(table)
    if (!columns) {
      columns = tableColumns(this.sqlite, table)
      this.columns.set(table, columns)
    }
    return columns
  }

  columnNames(table: string): Set<string> {
    return new Set(this.columnsOf(table).map((c) => c.name))
  }

  foreignKeysOf(table: string): ForeignKey[] {
    let fks = this.fks.get(table)
    if (!fks) {
      fks = foreignKeys(this.sqlite, table)
      this.fks.set(table, fks)
    }
    return fks
  }
}

// ---------- triggers ----------

const TRIGGER_PREFIX = 'sync_trg_'

export function dropSyncTriggers(sqlite: Sqlite): void {
  const triggers = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'sync\\_trg\\_%' ESCAPE '\\'"
    )
    .all() as Array<{ name: string }>
  for (const { name } of triggers) sqlite.exec(`DROP TRIGGER IF EXISTS ${quote(name)}`)
}

/** (Re)creates the change triggers of every synced table from its current columns */
export function installSyncTriggers(sqlite: Sqlite): void {
  sqlite.transaction(() => {
    dropSyncTriggers(sqlite)
    for (const table of syncedTables(sqlite)) {
      const columns = tableColumns(sqlite, table).map((c) => c.name)
      const key = keyColumn(table)
      if (!columns.includes(key)) continue
      const json = (ref: 'NEW' | 'OLD') =>
        `json_object(${columns.map((c) => `'${c}', ${ref}.${quote(c)}`).join(', ')})`
      const pk = (ref: 'NEW' | 'OLD') => `CAST(${ref}.${quote(key)} AS TEXT)`
      const active = '(SELECT applying FROM sync_control WHERE id = 1) = 0'
      const when = (ref: 'NEW' | 'OLD') =>
        table === 'app_setting' ? `${active} AND ${sharedSettingCondition(ref)}` : active
      const t = quote(table)
      const name = (op: string) => quote(`${TRIGGER_PREFIX}${op}_${table}`)
      sqlite.exec(`CREATE TRIGGER ${name('ins')} AFTER INSERT ON ${t} WHEN ${when('NEW')} BEGIN
  INSERT INTO sync_change (tbl, pk, op, old, new) VALUES ('${table}', ${pk('NEW')}, 'i', NULL, ${json('NEW')});
END`)
      sqlite.exec(`CREATE TRIGGER ${name('upd')} AFTER UPDATE ON ${t} WHEN ${when('NEW')} BEGIN
  INSERT INTO sync_change (tbl, pk, op, old, new) VALUES ('${table}', ${pk('NEW')}, 'u', ${json('OLD')}, ${json('NEW')});
END`)
      sqlite.exec(`CREATE TRIGGER ${name('del')} AFTER DELETE ON ${t} WHEN ${when('OLD')} BEGIN
  INSERT INTO sync_change (tbl, pk, op, old, new) VALUES ('${table}', ${pk('OLD')}, 'd', ${json('OLD')}, NULL);
END`)
    }
  })()
}

/** The largest id of the range [first, last] used by any synced table or tombstone */
export function highestIdInRange(sqlite: Sqlite, first: number, last: number): number {
  let highest = 0
  for (const table of syncedTables(sqlite)) {
    if (keyColumn(table) !== 'id') continue
    const row = sqlite
      .prepare(`SELECT MAX(id) AS m FROM ${quote(table)} WHERE id BETWEEN ? AND ?`)
      .get(first, last) as { m: number | null }
    if (row.m !== null && row.m > highest) highest = row.m
  }
  if (hasBookkeeping(sqlite)) {
    const tomb = sqlite
      .prepare(
        "SELECT MAX(CAST(pk AS INTEGER)) AS m FROM sync_tomb WHERE pk GLOB '[0-9]*' AND CAST(pk AS INTEGER) BETWEEN ? AND ?"
      )
      .get(first, last) as { m: number | null }
    if (tomb.m !== null && tomb.m > highest) highest = tomb.m
  }
  return highest
}
