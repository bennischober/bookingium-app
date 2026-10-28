import { Fragment, type ReactNode } from 'react'
import {
  Archive,
  Flag,
  FolderInput,
  Forward,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  SquareArrowOutUpRight,
  Trash2
} from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger
} from '@/components/ui/context-menu'
import type { FolderNode, MessageListItem } from '../../../../main/mailclient/core/types'
import { folderLabel } from './format'

/**
 * What can be done with the selected mails; an absent action is not offered
 * (read-only accounts, mails already in Trash, no Archive folder)
 */
export type MailActions = {
  openWindow: (id: number) => void
  compose?: (id: number, kind: 'reply' | 'replyAll' | 'forward') => void
  markRead?: (ids: number[], read: boolean) => void
  markFlagged?: (ids: number[], flagged: boolean) => void
  move?: (ids: number[], folder: FolderNode) => void
  archive?: (ids: number[]) => void
  toTrash?: (ids: number[]) => void
  /** B5: permanent deletion - only offered inside Trash, and only for writable accounts */
  expunge?: (ids: number[]) => void
}

// Icons in the menu like in the app's buttons
const ITEM = 'gap-2 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground'

/** Right-click menu of the message list, for one or several selected mails */
export function MessageMenu({
  items,
  folders,
  actions
}: {
  items: MessageListItem[]
  /** All folders, flat, for "Verschieben nach" */
  folders: FolderNode[]
  actions: MailActions
}) {
  if (items.length === 0) {
    return <ContextMenuItem disabled>Keine E-Mail ausgewählt</ContextMenuItem>
  }
  const ids = items.map((m) => m.id)
  const one = items.length === 1 ? items[0] : null
  const anyUnread = items.some((m) => !m.isRead)
  const anyUnflagged = items.some((m) => !m.isFlagged)
  const { compose, markRead, markFlagged, move, archive, toTrash, expunge } = actions

  // Groups between separators; empty ones are left out
  const groups: ReactNode[][] = [
    one
      ? [
          <ContextMenuItem
            key="window"
            className={ITEM}
            onSelect={() => actions.openWindow(one.id)}
          >
            <SquareArrowOutUpRight />
            In eigenem Fenster öffnen
          </ContextMenuItem>
        ]
      : [],
    one && compose
      ? [
          <ContextMenuItem key="reply" className={ITEM} onSelect={() => compose(one.id, 'reply')}>
            <Reply />
            Antworten
          </ContextMenuItem>,
          <ContextMenuItem
            key="replyAll"
            className={ITEM}
            onSelect={() => compose(one.id, 'replyAll')}
          >
            <ReplyAll />
            Allen antworten
          </ContextMenuItem>,
          <ContextMenuItem
            key="forward"
            className={ITEM}
            onSelect={() => compose(one.id, 'forward')}
          >
            <Forward />
            Weiterleiten
          </ContextMenuItem>
        ]
      : [],
    [
      markRead && (
        <ContextMenuItem key="read" className={ITEM} onSelect={() => markRead(ids, anyUnread)}>
          {anyUnread ? <MailOpen /> : <Mail />}
          {anyUnread ? 'Als gelesen markieren' : 'Als ungelesen markieren'}
        </ContextMenuItem>
      ),
      markFlagged && (
        <ContextMenuItem
          key="flag"
          className={ITEM}
          onSelect={() => markFlagged(ids, anyUnflagged)}
        >
          <Flag />
          {anyUnflagged ? 'Markieren' : 'Markierung entfernen'}
        </ContextMenuItem>
      )
    ].filter(Boolean),
    [
      move && (
        <ContextMenuSub key="move">
          <ContextMenuSubTrigger className={ITEM}>
            <FolderInput />
            Verschieben nach
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-80 w-56 overflow-y-auto">
            {folders.map((f) => (
              <ContextMenuItem
                key={f.id}
                // Nothing to move when all of them are in there already
                disabled={items.every((m) => m.folderId === f.id)}
                onSelect={() => move(ids, f)}
              >
                <span className="truncate">
                  {folderLabel(f) === f.name ? f.path : folderLabel(f)}
                </span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ),
      archive && (
        <ContextMenuItem key="archive" className={ITEM} onSelect={() => archive(ids)}>
          <Archive />
          Archivieren
        </ContextMenuItem>
      ),
      toTrash && (
        <ContextMenuItem key="trash" className={ITEM} onSelect={() => toTrash(ids)}>
          <Trash2 />
          In den Papierkorb
          <ContextMenuShortcut>Entf</ContextMenuShortcut>
        </ContextMenuItem>
      ),
      // B5: permanent deletion is only offered inside Trash
      expunge && (
        <ContextMenuItem key="expunge" className={ITEM} onSelect={() => expunge(ids)}>
          <Trash2 />
          Endgültig löschen
        </ContextMenuItem>
      )
    ].filter(Boolean)
  ].filter((group) => group.length > 0)

  return (
    <>
      {groups.map((group, i) => (
        <Fragment key={i}>
          {i > 0 && <ContextMenuSeparator />}
          {group}
        </Fragment>
      ))}
    </>
  )
}
