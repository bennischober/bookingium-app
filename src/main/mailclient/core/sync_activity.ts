// #159: what the sync did lately, for the activity panel behind the sync bar: the last passes
// (counts and times only) and the sync errors still standing. Errors outlive the pass that hit
// them: a folder's error stays until that folder syncs again without one, an error of the whole
// pass (or of the poll) until a pass ends without such an error, or until the user hides it.
// In memory only; a restart starts empty.
import type { PassSummary, SyncErrorEntry } from './types.js';

/** passes kept, newest first */
export const PASS_HISTORY_MAX = 10;
/** errors kept; past this the one seen longest ago goes */
export const SYNC_ERRORS_MAX = 50;

/** The key of an error: its folder, or for an error of the whole pass its message with the
 *  numbers left out ("circuit open: waiting 23s" and "... 41s" are the same error). */
export function syncErrorKey(path: string | null, message: string): string {
  return path !== null ? `folder:${path}` : `pass:${message.replace(/\d+/g, '#')}`;
}

export class SyncActivity {
  private readonly passes: PassSummary[] = [];
  private readonly errorsByKey = new Map<string, SyncErrorEntry>();

  notePass(p: PassSummary): void {
    this.passes.unshift(p);
    if (this.passes.length > PASS_HISTORY_MAX) this.passes.length = PASS_HISTORY_MAX;
  }

  noteError(path: string | null, message: string, at = new Date().toISOString()): void {
    const key = syncErrorKey(path, message);
    const known = this.errorsByKey.get(key);
    // re-inserted, so the map's order is the order last seen
    this.errorsByKey.delete(key);
    this.errorsByKey.set(key, known
      ? { ...known, message, lastAt: at, count: known.count + 1 }
      : { key, path, message, firstAt: at, lastAt: at, count: 1 });
    if (this.errorsByKey.size > SYNC_ERRORS_MAX) {
      const oldest = this.errorsByKey.keys().next().value;
      if (oldest !== undefined) this.errorsByKey.delete(oldest);
    }
  }

  /** The folder synced without an error: its error is over. */
  noteFolderDone(path: string): void {
    this.errorsByKey.delete(syncErrorKey(path, ''));
  }

  /** A pass ended without an error of its own: the errors of earlier passes and polls are over. */
  clearPassErrors(): void {
    for (const [key, e] of this.errorsByKey) if (e.path === null) this.errorsByKey.delete(key);
  }

  /** Hidden by the user; all of them without keys. */
  dismiss(keys?: readonly string[] | null): void {
    if (!keys) { this.errorsByKey.clear(); return; }
    for (const k of keys) this.errorsByKey.delete(k);
  }

  /** Newest first, copies (they cross IPC as plain objects). */
  history(): PassSummary[] {
    return this.passes.map(p => ({ ...p }));
  }

  /** Last seen first, copies. */
  errors(): SyncErrorEntry[] {
    return [...this.errorsByKey.values()].reverse().map(e => ({ ...e }));
  }
}
