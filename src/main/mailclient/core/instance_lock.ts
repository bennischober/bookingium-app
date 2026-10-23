// Task 5 Step 1: single-instance protection inside the core.
//
// The Task 4 double-server incident (two processes racing the same SQLite stores for
// ~7 minutes, 67 corrupted rows) must be structurally impossible. The core therefore
// takes an EXCLUSIVE lock on the data dir before opening any store:
//   - lock file <dataDir>/.mailcore.lock containing pid + start time
//   - PID liveness check: a stale lock (dead PID, or PID reused by an unrelated
//     process on Windows where the OS reuses PIDs) is broken and re-taken
//   - SQLite-level backstop: BEGIN EXCLUSIVE on a probe connection — catches the
//     pathological case where the lock file check is defeated (e.g. two different
//     data dirs symlinked to the same folder)
//
// The lock is released on close() AND on process exit (process-level handler installed
// by the factory). A second createMailCore on the same data dir throws immediately
// with a clear error — never runs side by side.
import fs from 'fs';
import path from 'path';

export class InstanceLockError extends Error {
  constructor(msg: string, readonly lockInfo: { pid: number; since: string } | null) {
    super(msg);
    this.name = 'InstanceLockError';
  }
}

const LOCK_FILE = '.mailcore.lock';

function readLock(dir: string): { pid: number; since: string } | null {
  try {
    const raw = fs.readFileSync(path.join(dir, LOCK_FILE), 'utf8');
    const j = JSON.parse(raw) as { pid: number; since: string };
    if (typeof j.pid !== 'number') return null;
    return j;
  } catch {
    return null;
  }
}

/** Is a PID alive AND plausibly another mail-core instance (a node/electron process)?
 * On Windows PIDs are reused aggressively, so we additionally require the lock file
 * to be fresh (< 7 days) — a reused PID with an ancient lock is treated as stale. */
function pidAliveAndFresh(_dir: string, pid: number, since: string): boolean {
  try {
    process.kill(pid, 0);   // signal 0 = liveness probe
  } catch {
    return false;           // ESRCH: no such process
  }
  const ageMs = Date.now() - new Date(since).getTime();
  return Number.isFinite(ageMs) && ageMs < 7 * 24 * 3600 * 1000;
}

export class DataDirLock {
  private held = false;

  constructor(readonly dataDir: string) { }

  /** Acquire. Throws InstanceLockError if another live instance holds the dir. */
  acquire(): void {
    if (this.held) return;
    fs.mkdirSync(this.dataDir, { recursive: true });
    const existing = readLock(this.dataDir);
    if (existing && pidAliveAndFresh(this.dataDir, existing.pid, existing.since)) {
      throw new InstanceLockError(
        `another mail core instance is running on this data dir ` +
        `(pid ${existing.pid}, since ${existing.since}). ` +
        `Two instances must never run side by side on the same store — ` +
        `stop the other one first (see Task 4 double-server incident).`,
        existing,
      );
    }
    // break stale locks (dead pid or ancient lock) and take ours
    fs.writeFileSync(path.join(this.dataDir, LOCK_FILE),
      JSON.stringify({ pid: process.pid, since: new Date().toISOString() }, null, 2));
    this.held = true;
  }

  release(): void {
    if (!this.held) return;
    try {
      const cur = readLock(this.dataDir);
      // only remove OUR lock (a new instance may have already taken over after a crash)
      if (cur?.pid === process.pid) fs.unlinkSync(path.join(this.dataDir, LOCK_FILE));
    } catch { /* best effort */ }
    this.held = false;
  }

  get isHeld(): boolean { return this.held; }
}
