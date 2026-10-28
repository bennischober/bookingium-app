// H2: what a running mail write op says in the sync bar.
//
// The mail core emits an op-event when an op starts and again when it finishes. Two kinds
// must not reach the bar:
//   - draft_save fires on every autosave (1.5 s while typing), so it would blink nonstop;
//   - flag fires for every read/unread toggle, same problem.
// Only ops the user consciously started are shown, and only while they run.
export const VISIBLE_OPS = new Set(['send', 'move', 'move_batch', 'expunge', 'draft_delete'])

/** The German label for a running op, or null when nothing should be shown */
export function runningOpLabel(kind: string | null | undefined): string | null {
  if (!kind || !VISIBLE_OPS.has(kind)) return null
  if (kind === 'send') return 'Sendet…'
  if (kind === 'move' || kind === 'move_batch') return 'Verschiebt…'
  return 'Löscht…' // expunge, draft_delete
}
