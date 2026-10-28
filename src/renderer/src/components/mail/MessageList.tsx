import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Flag, Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { MessageListItem } from '../../../../main/mailclient/core/types'
import { MAIL_DRAG_TYPE, formatListDate, snippetParts } from './format'
import { type Selection, clickSelection, moveSelection, selectAll, single } from './selection'

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

/** The ghost under the pointer while several mails are dragged */
function dragImage(count: number): HTMLElement {
  const ghost = document.createElement('div')
  ghost.textContent = `${count} E-Mails`
  ghost.className =
    'fixed -top-24 left-0 rounded-md border bg-background px-3 py-1.5 text-sm font-medium shadow-md'
  document.body.appendChild(ghost)
  // The browser takes its picture right away; the element can go after this task
  setTimeout(() => ghost.remove())
  return ghost
}

/**
 * Message list as in desktop mail clients: click selects a mail, Ctrl+click and the
 * checkboxes add or remove one, Shift+click and Shift+arrows select a range, Ctrl+A
 * selects all. The parent owns the selection and decides what selecting does; `how`
 * is 'menu' when a right-click selected the row (it should not mark it read).
 */
export function MessageList({
  items,
  selection,
  onSelectionChange,
  multiple = false,
  onOpen,
  onDelete,
  onDragMessages,
  menu,
  snippets,
  hasMore,
  loadingMore,
  onLoadMore,
  emptyText
}: {
  items: MessageListItem[]
  selection: Selection
  onSelectionChange: (next: Selection, how?: 'menu') => void
  /** Several mails can be selected at once (accounts that can write) */
  multiple?: boolean
  /** Double-click or Enter: the message in its own window */
  onOpen?: (id: number) => void
  /** Delete key, with the selected ids; absent where mails cannot be deleted */
  onDelete?: (ids: number[]) => void
  /** Rows can be dragged onto folders; called with null when the drag ends */
  onDragMessages?: (items: MessageListItem[] | null) => void
  /** Right-click menu for the selected mails */
  menu?: ReactNode
  snippets?: Record<number, string>
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  emptyText: string
}) {
  const listRef = useRef<HTMLUListElement>(null)
  const [draggingIds, setDraggingIds] = useState<number[]>([])
  const order = items.map((m) => m.id)
  const selected = new Set(selection.ids)
  const several = selection.ids.length > 1

  // Keep the row the keyboard is on visible
  useEffect(() => {
    if (selection.focus === null) return
    listRef.current
      ?.querySelector(`[data-message-id="${selection.focus}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [selection.focus])

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
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      const next = moveSelection(selection, order, step, multiple && event.shiftKey)
      if (next) onSelectionChange(next)
    } else if (multiple && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      onSelectionChange(selectAll(order))
    } else if (event.key === 'Escape' && several && selection.focus !== null) {
      event.preventDefault()
      onSelectionChange(single(selection.focus))
    } else if (event.key === 'Enter' && onOpen && selection.focus !== null) {
      event.preventDefault()
      onOpen(selection.focus)
    } else if (event.key === 'Delete' && onDelete && selection.ids.length > 0) {
      event.preventDefault()
      // B3's window shortcut handles Delete too; without this the mail would be
      // deleted twice (two journaled ops, two toasts)
      event.stopPropagation()
      onDelete(selection.ids)
    }
  }

  const click = (event: React.MouseEvent, id: number) => {
    const modifiers = multiple
      ? { ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey }
      : {}
    onSelectionChange(clickSelection(selection, order, id, modifiers))
  }

  if (items.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{emptyText}</p>
  }

  const list = (
    <ul
      ref={listRef}
      role="listbox"
      aria-label="Nachrichten"
      aria-multiselectable={multiple || undefined}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="group outline-none"
    >
      {items.map((m) => {
        const isSelected = selected.has(m.id)
        return (
          <li
            key={m.id}
            role="option"
            aria-selected={isSelected}
            data-message-id={m.id}
            onMouseDown={(event) => {
              // Shift+click selects mails, not text; the list still takes the focus
              if (multiple && event.shiftKey) {
                event.preventDefault()
                listRef.current?.focus()
              }
            }}
            onClick={(event) => click(event, m.id)}
            onDoubleClick={onOpen && (() => onOpen(m.id))}
            onContextMenu={() => {
              if (!isSelected) onSelectionChange(single(m.id), 'menu')
            }}
            draggable={Boolean(onDragMessages)}
            onDragStart={(event) => {
              if (!onDragMessages) return
              // A selected row takes the other selected mails along
              const dragged = isSelected && several ? items.filter((x) => selected.has(x.id)) : [m]
              event.dataTransfer.setData(MAIL_DRAG_TYPE, dragged.map((x) => x.id).join(','))
              event.dataTransfer.effectAllowed = 'move'
              if (dragged.length > 1)
                event.dataTransfer.setDragImage(dragImage(dragged.length), 0, 0)
              setDraggingIds(dragged.map((x) => x.id))
              onDragMessages(dragged)
            }}
            onDragEnd={() => {
              setDraggingIds([])
              onDragMessages?.(null)
            }}
            className={cn(
              'group/row cursor-pointer border-b px-3 py-2 text-sm',
              draggingIds.includes(m.id) && 'opacity-50',
              isSelected
                ? // An accent bar, and a ring while the list has keyboard focus
                  'bg-primary/10 shadow-[inset_3px_0_0_var(--color-primary)] group-focus-visible:ring-2 group-focus-visible:ring-ring/50 group-focus-visible:ring-inset'
                : 'hover:bg-muted/60'
            )}
          >
            <div className="flex items-baseline gap-2">
              {multiple ? (
                // The unread dot, and in its place a checkbox on hover and while
                // several mails are selected
                <span className="flex size-4 shrink-0 items-center justify-center self-center">
                  <input
                    type="checkbox"
                    aria-label="Auswählen"
                    checked={isSelected}
                    tabIndex={-1}
                    onClick={(event) => event.stopPropagation()}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onChange={() =>
                      onSelectionChange(clickSelection(selection, order, m.id, { ctrl: true }))
                    }
                    className={cn(
                      'size-3.5 cursor-pointer accent-primary',
                      !several && 'hidden group-hover/row:block'
                    )}
                  />
                  {!m.isRead && (
                    <span
                      className={cn(
                        'size-2 rounded-full bg-primary',
                        several ? 'hidden' : 'group-hover/row:hidden'
                      )}
                      aria-label="Ungelesen"
                    />
                  )}
                </span>
              ) : (
                !m.isRead && (
                  <span
                    className="size-2 shrink-0 self-center rounded-full bg-primary"
                    aria-label="Ungelesen"
                  />
                )
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
            <div className={cn('truncate', !m.isRead && 'font-medium', multiple && 'pl-6')}>
              {m.subject || '(Kein Betreff)'}
            </div>
            <div className={cn('line-clamp-2 text-xs text-muted-foreground', multiple && 'pl-6')}>
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

  if (!menu) return list
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{list}</ContextMenuTrigger>
      <ContextMenuContent className="w-60">{menu}</ContextMenuContent>
    </ContextMenu>
  )
}
