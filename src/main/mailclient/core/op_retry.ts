/**
 * I3 (MR-29): the automatic retry of failed ops.
 *
 * A failed op goes back to `pending` with its error, and its optimistic effect stays: a moved
 * mail stays hidden, a flag keeps its local value. Before this the only retry was at the next
 * start, so that could last for hours and the replay then ran against a mailbox that had changed
 * since. The core now retries such ops while the account is online, with a growing pause.
 *
 * Kept pure because the rules decide what may reach the server again without the user asking.
 */

/** Pause before the next round: 1 minute, doubling each round that left ops waiting, at most 15 */
export function retryDelay(round: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, round), 15 * 60_000)
}

/** I1: the phase a send op's payload records ('smtp' or 'sent'), see WriteSend.doSend */
export function sendPhase(op: { payload: string | null }): string | undefined {
  try {
    return (JSON.parse(op.payload || '{}') as { phase?: string }).phase
  } catch {
    return undefined
  }
}

// The kinds whose effect the user already sees. A draft save belongs to the editor (it saves
// again), and a folder op reports its failure to the user, who decides.
const RETRIED_KINDS = new Set(['flag', 'move', 'move_batch', 'delete', 'expunge', 'draft_delete'])

// The write path keeps only the message of a failure. A refused login must never be tried
// again unasked (a provider may lock the account), so anything that reads like one stops here.
const LOGIN_REFUSED = /authenticat|login|credential|password|\b535\b/i

/**
 * May the core run this op again on its own? Only a `pending` op that already failed once,
 * and not after a refused login. A send only when the server has it and filing into Sent is
 * all that is left: anything earlier was either refused (sendMail cancels it) or may have
 * gone out (never sent again).
 */
export function autoRetryable(op: {
  kind: string
  state: string
  error: string | null
  payload: string | null
}): boolean {
  if (op.state !== 'pending' || !op.error || LOGIN_REFUSED.test(op.error)) return false
  if (op.kind === 'send') return sendPhase(op) === 'sent'
  return RETRIED_KINDS.has(op.kind)
}
