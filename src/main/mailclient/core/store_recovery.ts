// Corrupt-store recovery: what to do when the local SQLite file cannot be read.
//
// The store is REBUILDABLE - every row came from the server - so a corrupt file is
// never data the user cannot get back. What it must not do is kill the core: the
// constructor runs inside `for (const a of options.accounts)` in account_entries.ts, so a throw
// here means EVERY account fails to load and the app has no mail at all, including the
// accounts whose stores are perfectly fine.
//
// Measured (probe, this session) - which error codes mean "this file is corrupt":
//   random bytes        -> SQLITE_NOTADB  (file is not a database)
//   truncated header    -> SQLITE_NOTADB
//   corrupted mid-file  -> SQLITE_CORRUPT (database disk image is malformed)
// and which do NOT:
//   a locked DB         -> opens fine (another connection holding BEGIN EXCLUSIVE)
//   a zero-byte file    -> opens fine (SQLite initialises it)
// So ONLY corruption codes may ever set a store aside. Quarantining on a transient error
// would throw away a perfectly good store, which is the opposite of the bug this fixes.
//
// I12 (MR-26), measured again on better-sqlite3 13 with a store-shaped file:
//   a damaged data page   -> OPENS FINE; quick_check reports it, the first query that
//                            reads the page throws SQLITE_CORRUPT
//   truncated on a page   -> SQLITE_CORRUPT at open
//   truncated mid-page    -> opens fine; quick_check reports "fts5: corruption found"
//   a damaged FTS page    -> the FTS integrity-check throws SQLITE_CORRUPT_VTAB
// So detection at open is not enough: the open checks the file when the last run did not
// close it cleanly or a query hit corruption, and extended codes count.
import DatabaseConstructor from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { isStoredMessagePath } from './files.js';

/**
 * A store may be set aside for exactly one reason: its file is corrupt. The extended codes
 * (SQLITE_CORRUPT_VTAB from FTS5, SQLITE_CORRUPT_INDEX, ...) start with the base code; a short
 * read means the file ends where its header says it does not. The cause chain is walked
 * because runMigrations wraps the driver's error.
 */
export function isCorruptStoreError(err: unknown): boolean {
  let current = err;
  for (let depth = 0; depth < 5 && current && typeof current === 'object'; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string'
      && (code.startsWith('SQLITE_CORRUPT') || code === 'SQLITE_NOTADB' || code === 'SQLITE_IOERR_SHORT_READ')) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** I12: written when a query hits corruption at runtime; the next open checks the file. */
export const CHECK_MARKER = '.check';

/**
 * Whether opening `dbPath` must check the whole file first. A `-wal` that is still there means
 * the last process did not close the store (close() checkpoints it away); the marker means a
 * query hit corruption. Both are rare, so the check never runs on a normal start.
 */
export function needsIntegrityCheck(dbPath: string): boolean {
  if (!fs.existsSync(dbPath)) return false;
  return fs.existsSync(`${dbPath}-wal`) || fs.existsSync(`${dbPath}${CHECK_MARKER}`);
}

/** Throws an error coded SQLITE_CORRUPT when quick_check finds anything, so the caller quarantines. */
export function assertIntact(db: BetterSqlite3.Database): void {
  const rows = db.pragma('quick_check') as { quick_check: string }[];
  const first = rows[0]?.quick_check ?? 'no result';
  if (rows.length === 1 && first === 'ok') return;
  throw Object.assign(new Error(`quick_check failed: ${first}`), { code: 'SQLITE_CORRUPT' });
}

/** I12: mark the store for a check on the next open. Best effort: a failed write only loses the hint. */
export function markForIntegrityCheck(dbPath: string): void {
  try { fs.writeFileSync(`${dbPath}${CHECK_MARKER}`, ''); } catch { /* the next unclean start still checks */ }
}

export function clearIntegrityCheck(dbPath: string): void {
  try { fs.rmSync(`${dbPath}${CHECK_MARKER}`, { force: true }); } catch { /* checked again next time, which is harmless */ }
}

/**
 * I12: report every statement that hits corruption. better-sqlite3 has no error hook, so the
 * handle's prepare/exec/pragma and each prepared statement's run/get/all/iterate are wrapped;
 * the error is rethrown unchanged.
 */
export function watchForCorruption(db: BetterSqlite3.Database, onCorrupt: (err: unknown) => void): void {
  const guard = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
    try {
      return fn(...args);
    } catch (err) {
      if (isCorruptStoreError(err)) onCorrupt(err);
      throw err;
    }
  };
  const prepare = db.prepare.bind(db);
  db.prepare = ((source: string) => {
    const stmt = guard(prepare)(source) as unknown as Record<string, (...args: unknown[]) => unknown>;
    for (const name of ['run', 'get', 'all'] as const) stmt[name] = guard(stmt[name].bind(stmt));
    const iterate = stmt.iterate.bind(stmt) as (...args: unknown[]) => Iterable<unknown>;
    stmt.iterate = function* (...args: unknown[]) {
      try {
        yield* iterate(...args);
      } catch (err) {
        if (isCorruptStoreError(err)) onCorrupt(err);
        throw err;
      }
    };
    return stmt;
  }) as unknown as typeof db.prepare;
  db.exec = guard(db.exec.bind(db)) as typeof db.exec;
  db.pragma = guard(db.pragma.bind(db)) as typeof db.pragma;
}

/** WAL and shared-memory sidecars and the check marker: they belong to the db and travel with it. */
const SIDECARS = ['-wal', '-shm', CHECK_MARKER];

/**
 * Move a corrupt store aside and return the path it was moved to.
 *
 * The files are RENAMED, never deleted: a corrupt store still holds every message
 * body the user has, and a bug in this recovery must never be the thing that destroys
 * the only copy. The `.db-wal` and `.db-shm` move with it - a fresh store that
 * adopted the old WAL would replay the corrupt file's pages into it.
 *
 * Throws when the rename fails (an unwritable data dir). The caller does not swallow
 * that: a store that cannot be set aside is a store that cannot be recovered, and
 * pretending otherwise would reopen the same corrupt file.
 */
export function quarantineStoreFiles(dbPath: string, now: () => number = Date.now): string {
  const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
  const target = `${dbPath}.corrupt-${stamp}`;
  fs.renameSync(dbPath, target);
  for (const suffix of SIDECARS) {
    const sidecar = `${dbPath}${suffix}`;
    if (!fs.existsSync(sidecar)) continue;
    fs.renameSync(sidecar, `${target}${suffix}`);
  }
  return target;
}

/** I12: where a message file of the quarantined store lived, so a rebuild can re-link it. */
export interface RelinkEntry {
  imapPath: string;
  uidValidity: string;
  uid: number;
  filePath: string;
  sizeBytes: number;
}

/**
 * I12 (MR-26): read the file map out of a quarantined store - folder path, UIDVALIDITY and UID
 * name a message on the server for good, so the rebuilt store can adopt the `.eml` that is
 * already on disk instead of downloading it again. Read-only, and every failure ends the read
 * with what was salvaged so far: a page the damage hit loses only its rows. Only entries whose
 * file is still there with the recorded size are kept.
 */
export function salvageRelinks(quarantinedPath: string, accountDir: string): RelinkEntry[] {
  const found: RelinkEntry[] = [];
  // a read-only open of a WAL database creates -wal and -shm; the ones this read created go again
  const created = ['-wal', '-shm'].filter(suffix => !fs.existsSync(`${quarantinedPath}${suffix}`));
  let db: BetterSqlite3.Database | undefined;
  try {
    db = new DatabaseConstructor(quarantinedPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`SELECT f.imap_path AS imapPath, f.uid_validity AS uidValidity, m.uid AS uid,
      m.file_path AS filePath, m.size_bytes AS sizeBytes
      FROM messages m JOIN folders f ON f.id = m.folder_id`).iterate() as Iterable<RelinkEntry>;
    for (const row of rows) {
      if (typeof row.filePath !== 'string' || !isStoredMessagePath(row.filePath)) continue;
      if (typeof row.imapPath !== 'string' || !row.uidValidity || !Number.isInteger(row.uid)) continue;
      try {
        if (fs.statSync(path.join(accountDir, row.filePath)).size !== row.sizeBytes) continue;
      } catch {
        continue;
      }
      found.push({ ...row, uidValidity: String(row.uidValidity) });
    }
  } catch {
    // the damage ends the read; what came before it is still good
  } finally {
    try { db?.close(); } catch { /* read-only handle; nothing to lose */ }
    for (const suffix of created) {
      const sidecar = `${quarantinedPath}${suffix}`;
      try {
        // a reader cannot write a WAL frame, so a -wal it created is empty; anything else is left alone
        if (suffix === '-wal' && fs.statSync(sidecar).size > 0) continue;
        fs.rmSync(sidecar, { force: true });
      } catch { /* not there, or still locked: an empty sidecar next to the quarantined copy is harmless */ }
    }
  }
  return found;
}
