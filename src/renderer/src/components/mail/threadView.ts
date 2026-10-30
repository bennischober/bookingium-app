// The pure half of the thread view, so the grouping is testable without a DOM
// (vitest runs in a node environment here).
import type { ThreadSummary } from '../../../../main/mailclient/core/types'

/** A row the thread list shows: the summary plus what the row says about it */
export type ThreadRow = ThreadSummary & {
  /** "3 Nachrichten" / "1 Nachricht" - only when the thread has more than one */
  countLabel: string | null
}

/** "3 Nachrichten" / "1 Nachricht"; null for a single mail, which needs no count */
export function threadCountLabel(count: number): string | null {
  if (count <= 1) return null
  return `${count.toLocaleString('de-DE')} ${count === 1 ? 'Nachricht' : 'Nachrichten'}`
}

/** Adds the count label the row shows; the summaries themselves stay as delivered */
export function threadRows(threads: ThreadSummary[]): ThreadRow[] {
  return threads.map((thread) => ({ ...thread, countLabel: threadCountLabel(thread.count) }))
}

/**
 * The mail to open for a thread: the newest one, which the core puts first. A
 * thread whose newest mail is gone from the store has no row to open, so the click
 * does nothing rather than opening a wrong mail.
 */
export function newestMessageId(thread: ThreadSummary): number | null {
  return thread.messageIds[0] ?? null
}

/** "Betreff (3)" - the subject with the thread's size, for the reading pane */
export function threadSubject(thread: ThreadSummary): string {
  const subject = thread.subject || '(kein Betreff)'
  return thread.count > 1 ? `${subject} (${thread.count})` : subject
}
