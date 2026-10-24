import { useEffect, useRef, useState } from 'react'
import { Flag, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { MessageListItem } from '../../../../main/mailclient/core/types'
import { MAIL_DRAG_TYPE, formatListDate, snippetParts } from './format'

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
  onOpen,
  onDelete,
  onDragMessage,
  snippets,
  hasMore,
  loadingMore,
  onLoadMore,
  emptyText
}: {
  items: MessageListItem[]
  selectedId: number | null
  onSelect: (id: number) => void
  /** Double-click or Enter: the message in its own window */
  onOpen?: (id: number) => void
  /** Delete key; absent for read-only accounts */
  onDelete?: (id: number) => void
  /** Rows can be dragged onto folders; called with null when the drag ends */
  onDragMessage?: (item: MessageListItem | null) => void
  snippets?: Record<number, string>
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  emptyText: string
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)

  // Keep the selected row visible when moving with the keyboard
  useEffect(() => {
    if (selectedId === null) return
    listRef.current
      ?.querySelector(`[data-message-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // Load the next page when the end of the list scrolls into view; the
  // button stays for keyboard users and as a fallback
  const moreRef = useRef<HTMLLIElement>(null)
  const loadMore = useRef(onLoadMore)
  useEffect(() => {
    loadMore.current = onLoadMore
  })
  useEffect(() => {
    const target = moreRef.current
    if (!target || !hasMore || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore.current()
      },
      // The parent is the scroll box; the margin starts loading a bit early
      { root: listRef.current?.parentElement, rootMargin: '400px 0px' }
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, items.length])

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = items.findIndex((m) => m.id === selectedId)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next =
        event.key === 'ArrowDown' ? Math.min(index + 1, items.length - 1) : Math.max(index - 1, 0)
      if (items[next]) onSelect(items[next].id)
    } else if (event.key === 'Enter' && onOpen && selectedId !== null) {
      event.preventDefault()
      onOpen(selectedId)
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
      className="group outline-none"
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
            onDoubleClick={onOpen && (() => onOpen(m.id))}
            draggable={Boolean(onDragMessage)}
            onDragStart={(event) => {
              if (!onDragMessage) return
              event.dataTransfer.setData(MAIL_DRAG_TYPE, String(m.id))
              event.dataTransfer.effectAllowed = 'move'
              setDraggingId(m.id)
              onDragMessage(m)
            }}
            onDragEnd={() => {
              setDraggingId(null)
              onDragMessage?.(null)
            }}
            className={cn(
              'cursor-pointer border-b px-3 py-2 text-sm',
              draggingId === m.id && 'opacity-50',
              selected
                ? // An accent bar, and a ring while the list has keyboard focus
                  'bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary)] group-focus-visible:ring-2 group-focus-visible:ring-ring/50 group-focus-visible:ring-inset'
                : 'hover:bg-muted/60'
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
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
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
        <li ref={moreRef} className="p-2 text-center">
          <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? 'Wird geladen…' : 'Weitere laden'}
          </Button>
        </li>
      )}
    </ul>
  )
}
