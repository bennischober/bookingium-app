import { Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatListDate } from './format'
import { newestMessageId, threadRows } from './threadView'
import type { ThreadSummary } from '../../../../main/mailclient/core/types'

/**
 * The mails of one folder grouped into threads, newest first, as the core's
 * `listThreads` delivers them. One row per thread: its newest mail's sender,
 * date, subject and snippet, plus how many mails it holds.
 *
 * Read-only: the thread list is a way to read a folder, not a second place to
 * select and move mails (that stays the /mail list).
 */
export function ThreadList({
  threads,
  onOpen
}: {
  threads: ThreadSummary[]
  /** Opens one mail; the newest of the thread for a collapsed row */
  onOpen: (id: number) => void
}) {
  return (
    <ul className="divide-y" aria-label="Unterhaltungen">
      {threadRows(threads).map((thread) => (
        <li key={thread.threadId} className="px-3 py-2 text-sm">
          <button
            type="button"
            className="flex w-full items-baseline gap-2 text-left"
            onClick={() => {
              const id = newestMessageId(thread)
              if (id !== null) onOpen(id)
            }}
            disabled={newestMessageId(thread) === null}
          >
            <span className="flex size-4 shrink-0 items-center justify-center self-center">
              {thread.unread > 0 && (
                <span className="size-2 rounded-full bg-primary" aria-label="Ungelesen" />
              )}
            </span>
            <span className={cn('min-w-0 flex-1 truncate', thread.unread > 0 && 'font-semibold')}>
              {thread.fromName || '(Unbekannt)'}
            </span>
            {thread.hasAttachments && (
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-label="Anhang" />
            )}
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {formatListDate(thread.date)}
            </span>
          </button>
          <div className={cn('truncate', thread.unread > 0 && 'font-medium', 'pl-6')}>
            {thread.subject || '(Kein Betreff)'}
          </div>
          <div className="flex items-center gap-2 pl-6">
            {thread.countLabel && (
              <span className="rounded-full border px-1.5 py-0.5 text-xs text-muted-foreground">
                {thread.countLabel}
              </span>
            )}
            <span className="line-clamp-1 text-xs text-muted-foreground">{thread.snippet}</span>
          </div>
        </li>
      ))}
    </ul>
  )
}
