import { type RefObject, useState } from 'react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { composeBody } from './composeBody'
import type { Address, ComposeState } from './composeDraft'
import {
  addMentioned,
  mentionCandidates,
  mentionHtml,
  mentionLabel,
  mentionQuery
} from './composeMention'
import { t } from '../../../../main/i18n/translate'

type Open = { query: string; node: Text; end: number; left: number; top: number }

/** How wide the menu is at least, so it is kept inside the window at the right edge */
const MENU_WIDTH = 240

/**
 * #306: "@Name" in the compose editor. `detect` runs after every input and caret move and
 * opens the menu while the caret is in an "@word"; a pick replaces the "@word" with the
 * mention and puts a person who is not on the mail yet under An.
 */
export function useComposeMention({
  body,
  accountId,
  mail,
  mailRef,
  update
}: {
  body: RefObject<HTMLDivElement | null>
  accountId: string
  /** The mail as rendered: its recipients come first in the menu */
  mail: ComposeState
  /** The mail as of now, for a pick between renders */
  mailRef: RefObject<ComposeState>
  update: (patch: Partial<ComposeState>) => void
}) {
  const [open, setOpen] = useState<Open | null>(null)
  const [active, setActive] = useState(0)
  const query = open?.query ?? ''
  // The same lookup as the recipient fields: the app's contacts and addresses seen in mail
  const contacts = trpcReact.mail.contacts.useQuery(
    { query, accountId },
    { enabled: open !== null && query.length >= 2, keepPreviousData: true }
  )

  const recipients = [...mail.to, ...mail.cc, ...mail.bcc]
  const items = open
    ? mentionCandidates(query, recipients, query.length >= 2 ? (contacts.data ?? []) : [])
    : []

  const close = () => setOpen(null)

  const detect = () => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return close()
    const range = selection.getRangeAt(0)
    const node = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE || !body.current?.contains(node)) return close()
    // A mention or a link is finished text, not a new "@"
    if (node.parentElement?.closest('a')) return close()
    const found = mentionQuery((node as Text).data.slice(0, range.startOffset))
    if (found === null) return close()
    let rect = range.getBoundingClientRect()
    // A collapsed range at the start of a text node can have no box; its parent has one
    if (!rect.height && node.parentElement) rect = node.parentElement.getBoundingClientRect()
    if (found !== open?.query) setActive(0)
    setOpen({
      query: found,
      node: node as Text,
      end: range.startOffset,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - MENU_WIDTH - 8)),
      top: rect.bottom + 4
    })
  }

  const pick = (address: Address) => {
    const editor = body.current
    const start = open ? open.end - open.query.length - 1 : -1
    if (!editor || !open || !open.node.isConnected || start < 0) return close()
    if (open.node.data.length < open.end) return close()
    editor.focus()
    const range = document.createRange()
    range.setStart(open.node, start)
    range.setEnd(open.node, open.end)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    // insertHTML keeps the browser's undo, as the template insert does
    document.execCommand('insertHTML', false, mentionHtml(address))
    close()
    const added = addMentioned(mailRef.current, address)
    update({ ...composeBody(editor.innerHTML), ...(added ?? {}) })
    if (added) {
      toast.info(t('{{name}} als Empfänger hinzugefügt', { name: mentionLabel(address) }))
    }
  }

  /** The editor's keys while the menu is open; true when the key was the menu's */
  const onKeyDown = (event: React.KeyboardEvent): boolean => {
    if (!open || items.length === 0) return false
    if (event.ctrlKey || event.metaKey || event.altKey) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + items.length) % items.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      pick(items[Math.min(active, items.length - 1)])
    } else if (event.key === 'Escape') {
      close()
    } else {
      return false
    }
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  return {
    detect,
    close,
    onKeyDown,
    menu:
      open && items.length > 0
        ? {
            items,
            active: Math.min(active, items.length - 1),
            position: { left: open.left, top: open.top },
            recipients: new Set(recipients.map((a) => a.email.toLowerCase())),
            onPick: pick,
            onHover: setActive
          }
        : null
  }
}
