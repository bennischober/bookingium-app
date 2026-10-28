// R3: how a preflight reads a failed SELECT, out of core/write_engine.ts, which still exports
// folderMissing. The engine's preflight and the batch move's preflight both answer with it.
import type { OpResult } from './write_engine.js'

/** RFC 5530 codes for a NO that will pass: the folder is there, the server cannot serve it now */
const TRANSIENT_NO_CODES = new Set(['UNAVAILABLE', 'INUSE', 'LIMIT', 'SERVERBUG', 'OVERQUOTA'])

/**
 * I15a (MR-30): did the server say the folder is not there, or did the connection fail?
 *
 * Every SELECT error used to be the conflict "folder gone", a socket reset included, and a
 * conflict is terminal. Only the server's own answer counts now: a tagged NO, with NONEXISTENT
 * or TRYCREATE or with no code at all (servers before RFC 5530 say it in text only). A NO with
 * a transient code, a BYE, a timeout or a closed socket is a failure that a retry can fix.
 */
export function folderMissing(error: unknown): boolean {
  const e = (error ?? {}) as { responseStatus?: unknown; serverResponseCode?: unknown }
  if (e.serverResponseCode === 'NONEXISTENT' || e.serverResponseCode === 'TRYCREATE') return true
  if (e.responseStatus !== 'NO') return false
  return !(typeof e.serverResponseCode === 'string' && TRANSIENT_NO_CODES.has(e.serverResponseCode))
}

/** I15a: the preflight's answer to a failed SELECT */
export function selectFailed(e: unknown): OpResult {
  const message = ((e as Error)?.message ?? String(e)).slice(0, 80)
  return folderMissing(e)
    ? { outcome: 'conflict', reason: `folder gone: ${message}` }
    : { outcome: 'failed', reason: `select failed: ${message}` }
}
