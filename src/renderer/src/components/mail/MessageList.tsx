import { useEffect, useRef } from 'react'
import { Flag, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { MessageListItem } from '../../../../main/mailclient/core/types'
import { formatListDate, snippetParts } from './format'

function Snippet({ text }: { text: string }) {
  return (
    <>
      {snippetParts(text).map((part, i) =>
        part.hit ? (
          <mark key={i} className="rounded-sm bg-primary/20 text-foreground">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
    </>
  )
}

/**
 * Message list with arrow-key navigation. Selection is by row id; the
 * parent decides what opening a message does.
 */
export function MessageList({
  items,
  selectedId,
  onSelect,
  onDelete,
  snippets,
  hasMore,
  loadingMore,
  onLoadMore,
  emptyText
}: {
  items: MessageListItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  /** Delete key; absent for read-only accounts */
  onDelete?: (id: number) => void
  snippets?: Record<number, string>
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  emptyText: string
}) {
  const listRef = useRef<HTMLUListElement>(null)

  // Keep the selected row visible when moving with the keyboard
  useEffect(() => {
    if (selectedId === null) return
    listRef.current
      ?.querySelector(`[data-message-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = items.findIndex((m) => m.id === selectedId)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next =
        event.key === 'ArrowDown' ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0)
      if (items[next]) onSelect(items[next].id)
    } else if (event.key === 'Delete' && onDelete && selectedId !== null) {
      event.preventDefault()
      onDelete(selectedId)
    }
  }

  if (items.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>
  }

  return (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Nachrichten"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="outline-none"
    >
      {items.map((m) => {
        const selected = m.id === selectedId
        return (
          <li
            key={m.id}
            role="option"
            aria-selected={selected}
            data-message-id={m.id}
            onClick={() => onSelect(m.id)}
            className={cn(
              'cursor-default border-b px-3 py-2 text-sm',
              selected ? 'bg-primary/10' : 'hover:bg-muted/60'
            )}
          >
            <div className="flex items-baseline gap-2">
              {!m.isRead && (
                <span
                  className="size-2 shrink-0 self-center rounded-full bg-primary"
                  aria-label="Ungelesen"
                />
              )}
              <span className={cn('min-w-0 flex-1 truncate', !m.isRead && 'font-semibold')}>
                {m.fromName || m.fromEmail || '(Unbekannt)'}
              </span>
              {m.isFlagged && (
                <Flag className="size-3.5 shrink-0 text-orange-500" aria-label="Markiert" />
              )}
              {m.hasAttachments && (
                <Paperclip
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-label="Anhang"
                />
              )}
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatListDate(m.date ?? m.internalDate)}
              </span>
            </div>
            <div className={cn('truncate', !m.isRead && 'font-medium')}>
              {m.subject || '(Kein Betreff)'}
            </div>
            <div className="line-clamp-2 text-xs text-muted-foreground">
              {snippets?.[m.id] ? <Snippet text={snippets[m.id]} /> : m.snippet}
            </div>
          </li>
        )
      })}
      {hasMore && (
        <li className="p-2 text-center">
          <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Wird geladen…' : 'Weitere laden'}
          </Button>
        </li>
      )}
    </ul>
  )
}
