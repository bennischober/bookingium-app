// Disk-full handling: the one write failure that needs a different answer than "retry".
//
// A local-first mail client writes every message body to disk and every row to SQLite, so a full
// disk is not an edge case - it is a matter of time. Before this module nothing distinguished it:
// a failed write inside a folder sync was swallowed by the per-folder catch in `syncAll`, which only
// consulted the circuit breaker and the connection state. So a full disk either retried the same
// failing download forever or was reported as "offline", which tells the user to check their network
// when the actual problem is their hard drive.
//
// Measured (probe, this session): SQLite raises SQLITE_FULL (simulated portably with
// `PRAGMA max_page_count`), and Node raises ENOSPC / EDQUOT from the filesystem side.
//
// The rule is deliberately narrow. A full disk is not a transient network error and must not be
// retried in a loop, but a BUSY, CORRUPT or EACCES failure is NOT disk-full and must keep its own
// handling - treating them alike would pause sync for reasons a retry could fix.

/** The only codes that mean "there is no room left". */
const DISK_FULL_CODES = new Set(['SQLITE_FULL', 'ENOSPC', 'EDQUOT']);

/** True when this failure is the disk being full (SQLite, or the filesystem itself). */
export function isDiskFullError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && DISK_FULL_CODES.has(code);
}

/**
 * The reason shown to the user. It names the CAUSE and the way out, because "sync failed" on a full
 * disk sends people looking at their mail server.
 */
export function diskFullMessage(): string {
  return 'Speicherplatz voll: der lokale Speicher ist voll, neue E-Mails können nicht gespeichert werden. '
    + 'Platz freigeben und erneut versuchen.';
}
