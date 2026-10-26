// Corrupt-store recovery: what to do when the local SQLite file cannot be read.
//
// The store is REBUILDABLE - every row came from the server - so a corrupt file is
// never data the user cannot get back. What it must not do is kill the core: the
// constructor runs inside `for (const a of options.accounts)` in index.ts, so a throw
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
// So ONLY the two corruption codes may ever set a store aside. Quarantining on a
// transient error would throw away a perfectly good store, which is the opposite of
// the bug this fixes.
import fs from 'fs';

/** The only two codes that mean the file itself is unreadable. */
const CORRUPT_CODES = new Set(['SQLITE_CORRUPT', 'SQLITE_NOTADB']);

/** A store may be set aside for exactly one reason: its file is corrupt. */
export function isCorruptStoreError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && CORRUPT_CODES.has(code);
}

/** WAL and shared-memory sidecars: they belong to the db and must travel with it. */
const SIDECARS = ['-wal', '-shm'];

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
