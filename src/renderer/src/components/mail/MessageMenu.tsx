import { Fragment, type ReactNode } from 'react'
import {
  Archive,
  FilePen,
  Flag,
  FolderInput,
  Forward,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldBan,
  ShieldCheck,
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
import { SHORTCUT_HINTS } from './shortcuts'
import { folderLabel } from './format'
import { t } from '../../../../main/i18n/translate'

/**
 * What can be done with the selected mails; an absent action is not offered
 * (read-only accounts, mails already in Trash, no Archive folder)
 */
export type MailActions = {
  openWindow: (id: number) => void
  compose?: (id: number, kind: 'reply' | 'replyAll' | 'forward' | 'editAsNew') => void
  markRead?: (ids: number[], read: boolean) => void
  markFlagged?: (ids: number[], flagged: boolean) => void
  move?: (ids: number[], folder: FolderNode) => void
  archive?: (ids: number[]) => void
  toTrash?: (ids: number[]) => void
  /** B5: permanent deletion - only offered inside Trash, and only for writable accounts */
  expunge?: (ids: number[]) => void
  /** #214: to the account's Junk folder (mails not in it yet) */
  toSpam?: (ids: number[]) => void
  /** #214: from Junk back to the inbox */
  notSpam?: (ids: number[]) => void
  /** #214: a rule that moves each new mail of this sender (or its domain) to Junk; one mail only */
  blockSender?: (id: number, scope: 'sender' | 'domain') => void
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
    return <ContextMenuItem disabled>{t('Keine E-Mail ausgewählt')}</ContextMenuItem>
  }
  const ids = items.map((m) => m.id)
  const one = items.length === 1 ? items[0] : null
  const anyUnread = items.some((m) => !m.isRead)
  const anyUnflagged = items.some((m) => !m.isFlagged)
  const { compose, markRead, markFlagged, move, archive, toTrash, expunge } = actions
  const { toSpam, notSpam, blockSender } = actions

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
            {t('In eigenem Fenster öffnen')}
          </ContextMenuItem>
        ]
      : [],
    one && compose
      ? [
          <ContextMenuItem key="reply" className={ITEM} onSelect={() => compose(one.id, 'reply')}>
            <Reply />
            {t('Antworten')}
          </ContextMenuItem>,
          <ContextMenuItem
            key="replyAll"
            className={ITEM}
            onSelect={() => compose(one.id, 'replyAll')}
          >
            <ReplyAll />
            {t('Allen antworten')}
          </ContextMenuItem>,
          <ContextMenuItem
            key="forward"
            className={ITEM}
            onSelect={() => compose(one.id, 'forward')}
          >
            <Forward />
            {t('Weiterleiten')}
          </ContextMenuItem>,
          <ContextMenuItem
            key="editAsNew"
            className={ITEM}
            onSelect={() => compose(one.id, 'editAsNew')}
          >
            <FilePen />
            {t('Als neue Nachricht bearbeiten')}
          </ContextMenuItem>
        ]
      : [],
    [
      markRead && (
        <ContextMenuItem key="read" className={ITEM} onSelect={() => markRead(ids, anyUnread)}>
          {anyUnread ? <MailOpen /> : <Mail />}
          {anyUnread ? t('Als gelesen markieren') : t('Als ungelesen markieren')}
        </ContextMenuItem>
      ),
      markFlagged && (
        <ContextMenuItem
          key="flag"
          className={ITEM}
          onSelect={() => markFlagged(ids, anyUnflagged)}
        >
          <Flag />
          {anyUnflagged ? t('Markieren') : t('Markierung entfernen')}
          <ContextMenuShortcut>{SHORTCUT_HINTS.toggleFlag}</ContextMenuShortcut>
        </ContextMenuItem>
      )
    ].filter(Boolean),
    [
      move && (
        <ContextMenuSub key="move">
          <ContextMenuSubTrigger className={ITEM}>
            <FolderInput />
            {t('Verschieben nach')}
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
          {t('Archivieren')}
          <ContextMenuShortcut>{SHORTCUT_HINTS.archive}</ContextMenuShortcut>
        </ContextMenuItem>
      ),
      toSpam && (
        <ContextMenuItem key="spam" className={ITEM} onSelect={() => toSpam(ids)}>
          <ShieldAlert />
          {t('Spam')}
          <ContextMenuShortcut>{SHORTCUT_HINTS.spam}</ContextMenuShortcut>
        </ContextMenuItem>
      ),
      notSpam && (
        <ContextMenuItem key="notSpam" className={ITEM} onSelect={() => notSpam(ids)}>
          <ShieldCheck />
          {t('Kein Spam')}
        </ContextMenuItem>
      ),
      one && blockSender && (
        <ContextMenuSub key="block">
          <ContextMenuSubTrigger className={ITEM}>
            <ShieldBan />
            {t('Absender immer als Spam')}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56">
            <ContextMenuItem onSelect={() => blockSender(one.id, 'sender')}>
              {t('Nur diese Adresse')}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => blockSender(one.id, 'domain')}>
              {t('Die ganze Domain')}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      ),
      toTrash && (
        <ContextMenuItem key="trash" className={ITEM} onSelect={() => toTrash(ids)}>
          <Trash2 />
          {t('In den Papierkorb')}
          <ContextMenuShortcut>{t('Entf')}</ContextMenuShortcut>
        </ContextMenuItem>
      ),
      // B5: permanent deletion is only offered inside Trash
      expunge && (
        <ContextMenuItem key="expunge" className={ITEM} onSelect={() => expunge(ids)}>
          <Trash2 />
          {t('Endgültig löschen')}
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
