import type { Dispatch, SetStateAction } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Mail } from 'lucide-react'
import type { useMessageActions } from '@/hooks/useMessageActions'
import { ComposeView } from './ComposeView'
import { MessageView } from './MessageView'
import { SelectionActions } from './SelectionActions'
import type { MailActions } from './MessageMenu'
import { archiveableIds } from './archiveActions'
import { inboxOf, junkFolderOf, spamTargets } from './spamActions'
import { type ComposeState, composeTo } from './composeDraft'
import type { ReadingActions } from './readingActions'
import { EMPTY_SELECTION, type Selection } from './selection'
import { isTrash } from './format'
import type { MailAccountDto } from '../../../../main/mailclient/accounts'
import type {
  FolderNode,
  MessageDetail,
  MessageListItem
} from '../../../../main/mailclient/core/types'

/** The open editor; a new key mounts a fresh one, `draftId` when it shows a mail from Drafts */
export type OpenCompose = { key: number; state: ComposeState; draftId?: number }

type MessageActionsHook = ReturnType<typeof useMessageActions>

/**
 * The mail page's reading pane: the editor, the one selected mail, the bulk actions for several,
 * or a note that nothing is selected
 */
export function ReadingPane({
  compose,
  setCompose,
  selection,
  setSelection,
  selectedId,
  selectedItems,
  selectedActions,
  account,
  accountId,
  canWrite,
  reading,
  allFolders,
  listItems,
  hasArchive,
  markRead,
  markFlagged,
  moveAway,
  composeFrom,
  startCompose,
  refreshLists
}: {
  compose: OpenCompose | null
  setCompose: Dispatch<SetStateAction<OpenCompose | null>>
  selection: Selection
  setSelection: Dispatch<SetStateAction<Selection>>
  selectedId: number | null
  selectedItems: MessageListItem[]
  selectedActions: MailActions
  account: MailAccountDto
  accountId: string
  canWrite: boolean
  reading: ReadingActions
  allFolders: FolderNode[]
  listItems: MessageListItem[]
  hasArchive: boolean
  markRead: MessageActionsHook['markRead']
  markFlagged: MessageActionsHook['markFlagged']
  moveAway: MessageActionsHook['moveAway']
  composeFrom: (
    message: MessageDetail,
    kind: 'reply' | 'replyAll' | 'forward' | 'editAsNew'
  ) => void
  startCompose: (state: ComposeState) => void
  refreshLists: () => void
}) {
  const navigate = useNavigate()

  // #214: "Spam" for an open mail outside Junk, "Kein Spam" inside it; neither without a Junk
  // folder or on a read-only account
  const spamHandlers = (): {
    onSpam?: (id: number) => void
    onNotSpam?: (id: number) => void
  } => {
    const open = listItems.find((m) => m.id === selectedId)
    const junk = junkFolderOf(allFolders)
    const inbox = inboxOf(allFolders)
    if (!canWrite || !open || !junk) return {}
    const { toSpam, notSpam } = spamTargets([open], allFolders)
    return {
      onSpam:
        toSpam.length > 0
          ? (id) => void moveAway([id], { kind: 'folder', folder: junk })
          : undefined,
      onNotSpam:
        notSpam.length > 0 && inbox
          ? (id) => void moveAway([id], { kind: 'folder', folder: inbox })
          : undefined
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {compose ? (
        <ComposeView
          key={compose.key}
          accountId={accountId}
          initial={compose.state}
          onClose={() => {
            setCompose(null)
            // A sent or discarded draft is gone from Drafts
            if (compose.draftId !== undefined) setSelection(EMPTY_SELECTION)
          }}
          onStored={refreshLists}
        />
      ) : selectedId !== null ? (
        <MessageView
          key={selectedId}
          accountId={accountId}
          messageId={selectedId}
          canWrite={canWrite}
          inTrash={isTrash(
            allFolders.find((f) => f.id === listItems.find((m) => m.id === selectedId)?.folderId)
          )}
          onToggleFlag={(id, flagged) => markFlagged([id], flagged)}
          onDelete={(id) => void moveAway([id], { kind: 'delete' })}
          onArchive={
            // MR-36: not offered for a mail already in Archive (a self-move the core refuses,
            // which hid the row until a restart) and not from Trash
            hasArchive &&
            archiveableIds(
              [listItems.find((m) => m.id === selectedId)].filter(
                (m): m is MessageListItem => m !== undefined
              ),
              allFolders
            ).length > 0
              ? (id) => void moveAway([id], { kind: 'archive' })
              : undefined
          }
          {...spamHandlers()}
          onMarkUnread={(id) => markRead([id], false)}
          onCompose={reading.canCompose ? composeFrom : undefined}
          onWriteTo={
            reading.canWriteTo
              ? (address) => startCompose(composeTo(address, account?.signature))
              : undefined
          }
          onOpenEvent={(eventId) =>
            void navigate({ to: '/events/$eventId', params: { eventId: String(eventId) } })
          }
        />
      ) : selection.ids.length > 1 && selectedItems.length > 0 ? (
        <SelectionActions
          items={selectedItems}
          actions={selectedActions}
          onClear={() => setSelection(EMPTY_SELECTION)}
        />
      ) : (
        <div className="m-auto flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <Mail className="size-10 stroke-1" aria-hidden />
          <p>Keine E-Mail ausgewählt.</p>
        </div>
      )}
    </div>
  )
}
