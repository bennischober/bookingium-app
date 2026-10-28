import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Lock, Mail, Search, SquarePen, X } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { mailApi } from '@/lib/mailApi'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ComposeView } from '@/components/mail/ComposeView'
import { hide, unhide, visible } from '@/components/mail/optimistic'
import { readingActions } from '@/components/mail/readingActions'
import { archiveableIds, archivedCount, uncoveredIds } from '@/components/mail/archiveActions'
import { VISIBLE_OPS } from '@/components/mail/opLabel'
import { refreshBatcher, refreshPlan } from '@/components/mail/mailRefresh'
import { OpJournalPanel } from '@/components/mail/OpJournalPanel'
import { SyncIndicator } from '@/components/mail/SyncIndicator'
import {
  type OpAction,
  type OpEntry,
  actionResult,
  discardConfirm,
  opEntries
} from '@/components/mail/opJournal'
import {
  type ComposeState,
  emptyCompose,
  forwardCompose,
  fromSavedDraft,
  replyCompose,
  withSignature,
  composeTo
} from '@/components/mail/composeDraft'
import { FolderTree, type FolderAction } from '@/components/mail/FolderTree'
import { confirmAction } from '@/lib/confirm'
import { askFolderName } from '@/lib/folderName'
import { MessageList } from '@/components/mail/MessageList'
import { type MailActions, MessageMenu } from '@/components/mail/MessageMenu'
import { MessageView } from '@/components/mail/MessageView'
import { PaneResizer } from '@/components/mail/PaneResizer'
import { SelectionActions } from '@/components/mail/SelectionActions'
import {
  EMPTY_SELECTION,
  type Selection,
  nextAfterRemoval,
  single
} from '@/components/mail/selection'
import { useStoredWidth } from '@/hooks/useStoredWidth'
import { useMailSearch } from '@/hooks/useMailSearch'
import { PAGE_SIZE } from '@/components/mail/paging'
import { isTypingTarget, shortcutBlocked, shortcutFor } from '@/components/mail/shortcuts'
import {
  flattenFolders,
  folderLabel,
  isDrafts,
  isInbox,
  isTrash,
  messageKey
} from '@/components/mail/format'
import type {
  FolderNode,
  MessageDetail,
  MessageListItem,
  OpSummary
} from '../../../main/mailclient/core/types'

// Pane widths in px; the user can drag them, see PaneResizer
const FOLDER_PANE = { initial: 224, min: 160, max: 480 }
const LIST_PANE = { initial: 352, min: 260, max: 720 }

type MoveTarget = { kind: 'delete' } | { kind: 'archive' } | { kind: 'folder'; folder: FolderNode }
const MOVE_TEXTS: Record<
  MoveTarget['kind'],
  { done: (folder: string) => string; many: (n: number, folder: string) => string; failed: string }
> = {
  delete: {
    done: () => 'In den Papierkorb verschoben',
    many: (n) => `${n} E-Mails in den Papierkorb verschoben`,
    failed: 'Löschen fehlgeschlagen'
  },
  archive: {
    done: () => 'Archiviert',
    many: (n) => `${n} E-Mails archiviert`,
    failed: 'Archivieren fehlgeschlagen'
  },
  folder: {
    done: (folder) => `Nach „${folder}“ verschoben`,
    many: (n, folder) => `${n} E-Mails nach „${folder}“ verschoben`,
    failed: 'Verschieben fehlgeschlagen'
  }
}

export default function MailPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const accounts = trpcReact.mail.accounts.list.useQuery()
  const workerStatus = trpcReact.mail.status.useQuery(undefined, {
    refetchInterval: (data) => (data?.starting ? 1000 : 5000)
  })

  const [chosenAccountId, setChosenAccountId] = useState<string | null>(null)
  const account = accounts.data?.find((a) => a.id === chosenAccountId) ?? accounts.data?.[0] ?? null
  const accountId = account?.id ?? ''
  // MR-35: one rule, shared with the mail window, so the reading pane cannot offer a write
  // action on a read-only account (its autosave failed silently and lost the text)
  const reading = readingActions(account)
  const canWrite = reading.canWrite

  const [chosenFolderId, setChosenFolderId] = useState<string | null>(null)
  // One selected mail is shown in the reading pane, several get the bulk actions
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION)
  const selectedId = selection.ids.length === 1 ? selection.ids[0] : null
  // The open editor, in place of the reading pane; `draftId` when it shows a mail from Drafts
  const [compose, setCompose] = useState<{
    key: number
    state: ComposeState
    draftId?: number
  } | null>(null)
  // The mails being dragged onto a folder, if any
  const [dragged, setDragged] = useState<MessageListItem[] | null>(null)
  // B2: the folder being dragged, so a drop knows what to move
  const [movingFolder, setMovingFolder] = useState<FolderNode | null>(null)
  // H2: a write op the user started and that is still running; the sync bar shows it.
  // Autosave and flag ops are excluded (see opLabel.ts) so the bar stays quiet.
  const [runningOp, setRunningOp] = useState<string | null>(null)
  // B3: the move shortcut puts the keyboard on the folder tree (the drop target)
  const folderTreeRef = useRef<HTMLUListElement>(null)
  const [folderWidth, setFolderWidth] = useStoredWidth(
    'mail.folderPaneWidth',
    FOLDER_PANE.initial,
    FOLDER_PANE
  )
  const [listWidth, setListWidth] = useStoredWidth(
    'mail.listPaneWidth',
    LIST_PANE.initial,
    LIST_PANE
  )

  const ready = Boolean(account) && workerStatus.data?.running === true

  const folders = useQuery({
    queryKey: ['mail', accountId, 'folders'],
    queryFn: () => mailApi.getFolders(accountId),
    enabled: ready
  })
  const allFolders = useMemo(() => flattenFolders(folders.data ?? []), [folders.data])
  const folderId = chosenFolderId ?? allFolders.find(isInbox)?.id ?? allFolders[0]?.id ?? null

  const messages = useInfiniteQuery({
    queryKey: ['mail', accountId, 'messages', folderId],
    queryFn: ({ pageParam = 0 }) =>
      mailApi.listMessages(folderId!, { offset: pageParam as number, limit: PAGE_SIZE }, accountId),
    getNextPageParam: (last, pages) =>
      last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: ready && folderId !== null
  })

  const {
    query,
    setQuery,
    filters,
    setFilters,
    showFilters,
    setShowFilters,
    facetFolderId,
    setFacetFolderId,
    searchRef,
    hasFilter,
    searching,
    results,
    snippets,
    firstResult,
    clearSearch
  } = useMailSearch({ accountId, ready })

  // G2/L1: mails the user just moved away are hidden at click time, before the server has
  // answered, so the next mail is immediately selectable and a quick delete-run feels instant.
  // The set is cleared as soon as fresh list data arrives (see the effect below), and a
  // failed move puts its ids back - the row reappears rather than silently vanishing.
  const [hiddenIds, setHiddenIds] = useState<number[]>([])
  const hideMails = (ids: number[]) => setHiddenIds((current) => hide(current, ids))
  const unhideMails = (ids: number[]) => setHiddenIds((current) => unhide(current, ids))

  // G7: a hidden mail stays hidden while it is still in the list data.
  //
  // Clearing the whole set whenever fresh list data arrived was wrong: an op-event triggers a
  // refresh 300 ms after the op STARTS, so a slow move had its rows put back on screen while
  // still in flight - the user saw the mail they just deleted reappear, which is the flicker this
  // whole fix exists to remove. A sync can do the same.
  //
  // So a hidden id is released when the fresh data no longer contains it: at that point the mail
  // has really left this folder (or the server has it elsewhere), and the list is already correct.
  // While it is still listed, its op has not landed and it stays hidden. A failed op restores it
  // explicitly through unhideMails.
  const listUpdatedAt = searching ? results.dataUpdatedAt : messages.dataUpdatedAt
  useEffect(() => {
    if (!listUpdatedAt) return
    const listed = new Set(
      (searching
        ? (results.data?.pages.flatMap((page) => page.items) ?? [])
        : (messages.data?.pages.flat() ?? [])
      ).map((m) => m.id)
    )
    setHiddenIds((current) => current.filter((id) => listed.has(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listUpdatedAt])

  const listItems = visible(
    searching
      ? (results.data?.pages.flatMap((p) => p.items) ?? [])
      : (messages.data?.pages.flat() ?? []),
    hiddenIds
  )
  // Selected mails that are still in the list (a sync may have taken some away)
  const selectedItems = listItems.filter((m) => selection.ids.includes(m.id))
  const syncStatus = useQuery({
    queryKey: ['mail', accountId, 'sync'],
    queryFn: () => mailApi.getSyncStatus(accountId),
    enabled: ready,
    refetchInterval: (data) =>
      data?.running ||
      data?.connection === 'connecting' ||
      data?.connection === 'offline' ||
      // a full disk is a state the user can fix outside the app; keep polling so the bar clears
      // by itself once the retry succeeds, instead of staying stuck until a reload
      data?.diskFull
        ? 2000
        : 10_000
  })
  const loginFailed = syncStatus.data?.connection === 'auth-failed'

  // I3: writes that need the user (unclear sends, rejected or failed changes, stuck ones).
  // Every op-event refreshes it; the interval catches an op turning stuck by just waiting.
  const openOps = useQuery({
    queryKey: ['mail', accountId, 'open-ops'],
    queryFn: () => mailApi.listOpenOps(accountId),
    enabled: ready && canWrite,
    refetchInterval: 30_000
  })
  const opNow = openOps.dataUpdatedAt || Date.now()
  const opList = useMemo(() => opEntries(openOps.data ?? [], opNow), [openOps.data, opNow])
  const [busyOpId, setBusyOpId] = useState<string | null>(null)

  // Refresh folders, lists and search when the sync stored something new or a change
  // was made (also in a mail window); batched, the initial download reports every folder.
  // I18: another account's events mark that account stale instead of being dropped.
  const [refresher] = useState(() =>
    refreshBatcher((key) => void queryClient.invalidateQueries({ queryKey: [...key] }))
  )
  useEffect(() => () => refresher.dispose(), [refresher])
  trpcReact.mail.events.useSubscription(undefined, {
    enabled: ready,
    onData: (event) => {
      // H2: show a write op while it runs, but only one the user started. Autosave
      // (draft_save) and flag changes run in the background every few seconds; showing
      // those would make the bar flicker nonstop, which is the opposite of quiet.
      if (
        event.type === 'op-event' &&
        event.accountId === accountId &&
        VISIBLE_OPS.has(event.kind)
      ) {
        setRunningOp(event.outcome === 'running' ? event.kind : null)
      }
      const plan = refreshPlan(event, accountId)
      if (plan) refresher.add(plan)
    }
  })

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'folders'] })
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'messages'] })
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'search'] })
  }

  // Double-click: the mail in its own window; a draft is edited there, not twice
  const openWindow = (id: number) => {
    if (compose?.draftId === id) setCompose(null)
    void window.api.openMailWindow(accountId, id)
  }

  // A new key mounts a fresh editor, also in place of an open one.
  // B8: every new mail, reply and forward gets the account's signature here, so no
  // entry point can forget it. A reopened draft already contains it and is left alone.
  const startCompose = (state: ComposeState, draftId?: number) =>
    setCompose((current) => ({
      key: (current?.key ?? 0) + 1,
      state: draftId === undefined ? withSignature(state, account?.signature) : state,
      draftId
    }))

  // The mail last opened, for answers that come back after the user moved on
  const openedId = useRef<number | null>(null)
  const openMessage = (id: number, markAsRead: boolean) => {
    if (compose?.draftId === id) return
    openedId.current = id
    setCompose(null)
    const item = listItems.find((m) => m.id === id)
    if (canWrite && markAsRead && item && !item.isRead) {
      mailApi.markRead([id], true, accountId).then(refreshLists, () => undefined)
    }
    // A draft opens in the editor; until it is loaded the reading pane shows it
    if (canWrite && item?.isDraft && isDrafts(allFolders.find((f) => f.id === item.folderId))) {
      mailApi
        .getDraft(id, accountId)
        .then((draft) => {
          if (openedId.current === id) startCompose(fromSavedDraft(draft), id)
        })
        .catch(failed('Entwurf konnte nicht geöffnet werden'))
    }
  }

  // A single selected mail is opened (and marked read, unless a right-click
  // selected it); several close the editor and show the bulk actions
  const changeSelection = (next: Selection, how?: 'menu') => {
    setSelection(next)
    if (next.ids.length === 1) {
      openMessage(next.ids[0], how !== 'menu')
      return
    }
    openedId.current = null
    setCompose(null)
  }

  const failed = (title: string) => (error: unknown) =>
    toast.error(title, { description: error instanceof Error ? error.message : undefined })

  // I3: an action from the op panel. Discarding asks first; the core resyncs the op's folders,
  // so a hidden mail or a local flag gives way to what the server has.
  const runOpAction = async (entry: OpEntry, action: OpAction) => {
    if (action === 'discard') {
      if (!(await confirmAction({ ...discardConfirm(entry), destructive: true }))) return
    }
    setBusyOpId(entry.op.id)
    try {
      if (action === 'discard') {
        await mailApi.cancelOp(entry.op.id, accountId)
        toast.success('Verworfen')
      } else {
        const result =
          action === 'resolve'
            ? await mailApi.resolveOp(entry.op.id, accountId)
            : await mailApi.retryOp(entry.op.id, accountId)
        const { ok, text } = actionResult(action, result.outcome)
        if (ok) toast.success(text)
        else toast.error(text)
      }
    } catch (error) {
      failed('Aktion fehlgeschlagen')(error)
    } finally {
      setBusyOpId(null)
      void openOps.refetch()
      refreshLists()
    }
  }

  const afterFlags = () => {
    refreshLists()
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'message'] })
  }
  const markRead = (ids: number[], read: boolean) => {
    mailApi
      .markRead(ids, read, accountId)
      .then(afterFlags)
      .catch(
        failed(
          read ? 'Als gelesen markieren fehlgeschlagen' : 'Als ungelesen markieren fehlgeschlagen'
        )
      )
  }
  const markFlagged = (ids: number[], flagged: boolean) => {
    mailApi
      .markFlagged(ids, flagged, accountId)
      .then(afterFlags)
      .catch(failed('Markierung fehlgeschlagen'))
  }

  // Moves the mails, moves the selection on if it held them, then reports how
  // the journaled moves went and offers to undo them all
  const moveAway = async (ids: number[], target: MoveTarget) => {
    if (ids.length === 0) return
    const order = listItems.map((m) => m.id)
    const texts = MOVE_TEXTS[target.kind]
    const label = target.kind === 'folder' ? folderLabel(target.folder) : ''

    // G2/L1: the click is answered now, not when the server answers. The rows go, the
    // selection moves on to the next mail, and the request runs behind that - so deleting a
    // run of mails is as fast as the user can click. A failure puts the rows back.
    hideMails(ids)
    const next = nextAfterRemoval(order, ids)
    setSelection((current) =>
      current.ids.some((id) => ids.includes(id))
        ? next !== null
          ? single(next)
          : EMPTY_SELECTION
        : current
    )

    let ops: OpSummary[]
    try {
      if (target.kind === 'delete') ops = await mailApi.deleteToTrash(ids, accountId)
      else if (target.kind === 'archive') ops = await mailApi.archive(ids, accountId)
      else ops = await mailApi.moveToFolder(ids, target.folder.id, accountId)
    } catch (error) {
      // the move never happened: the rows come back, and the user sees why
      unhideMails(ids)
      failed(texts.failed)(error)
      return
    }
    refreshLists()
    const done = ops.filter((op) => op.state === 'done')
    const undo =
      done.length > 0
        ? {
            label: 'Rückgängig',
            onClick: () => {
              void (async () => {
                try {
                  // Last move first, so each mail goes back the way it came
                  for (const op of [...done].reverse()) await mailApi.undoOp(op.id, accountId)
                } catch (error) {
                  failed('Rückgängig machen fehlgeschlagen')(error)
                }
                refreshLists()
              })()
            }
          }
        : undefined
    // MR-36: every mail the answer does not cover is shown again - the archive case returns no op
    // for a self-move, and a mixed selection skips the mails already in Archive. The rows come from
    // the whole list: a drag or the reading pane moves mails that are not part of the selection.
    const itemsById = new Map(listItems.map((m) => [m.id, m]))
    const moved = ids
      .map((id) => itemsById.get(id))
      .filter((m): m is MessageListItem => m !== undefined)
    const stillHidden = uncoveredIds(moved, ops, allFolders)
    if (stillHidden.length > 0) unhideMails(stillHidden.map((m) => m.id))

    const notDone = ops.filter((op) => op.state !== 'done')
    if (notDone.length > 0) {
      // A pending op stays journaled and is retried, but its mail is not on the server yet:
      // show it again rather than hiding a mail that has not actually moved
      unhideMails(ids)
      const reason = notDone.some((op) => op.state === 'pending')
        ? 'Der Server war nicht erreichbar; es wird beim nächsten Start erneut versucht.'
        : (notDone.find((op) => op.error)?.error ?? undefined)
      toast.error(texts.failed, {
        description:
          ids.length > 1
            ? `${notDone.length} von ${ids.length} E-Mails wurden nicht verschoben.${reason ? ` ${reason}` : ''}`
            : reason,
        action: undo
      })
      return
    }
    // MR-36 / README renderer 20: the toast says what the core archived, not how many were selected
    const archived = target.kind === 'archive' ? archivedCount(moved, ops, allFolders) : ids.length
    toast.success(archived > 1 ? texts.many(archived, label) : texts.done(label), { action: undo })
  }

  const hasArchive = allFolders.some((f) => f.specialUse?.includes('Archive'))
  const folderOf = (item: MessageListItem) => allFolders.find((f) => f.id === item.folderId)

  // Reply and forward from the menu need the whole mail
  const composeFromList = (id: number, kind: 'reply' | 'replyAll' | 'forward') => {
    queryClient
      .fetchQuery({
        queryKey: messageKey(accountId, id),
        queryFn: () => mailApi.getMessage(id, accountId)
      })
      .then((message) => composeFrom(message, kind))
      .catch(failed('Die E-Mail konnte nicht geladen werden'))
  }

  // What the menu and the bulk pane offer for the selected mails
  const trashable = selectedItems.filter((m) => !isTrash(folderOf(m)))
  // MR-36: the mails an archive may act on - not the ones already in Archive (a self-move the core
  // refuses, which left the rows hidden until a restart) and not the ones in Trash
  const archiveable = archiveableIds(selectedItems, allFolders)
  // B5: permanent deletion is offered only for mails that are in Trash
  const inTrashItems = selectedItems.filter((m) => isTrash(folderOf(m)))
  const selectedActions: MailActions = canWrite
    ? {
        openWindow,
        compose: composeFromList,
        markRead,
        markFlagged,
        move: (ids, target) => void moveAway(ids, { kind: 'folder', folder: target }),
        archive:
          hasArchive && archiveable.length > 0
            ? (ids) =>
                void moveAway(
                  ids.filter((id) => archiveable.includes(id)),
                  { kind: 'archive' }
                )
            : undefined,
        // Mails already in Trash stay there
        toTrash:
          trashable.length > 0
            ? (ids) =>
                void moveAway(
                  ids.filter((id) => trashable.some((m) => m.id === id)),
                  { kind: 'delete' }
                )
            : undefined,
        expunge:
          inTrashItems.length > 0
            ? (ids) => void expunge(ids.filter((id) => inTrashItems.some((m) => m.id === id)))
            : undefined
      }
    : { openWindow }

  // B5: permanent deletion, only ever inside Trash and only for writable accounts
  const expunge = async (ids: number[]) => {
    const count = ids.length
    const confirmed = await confirmAction({
      title: count > 1 ? `${count} E-Mails endgültig löschen?` : 'Diese E-Mail endgültig löschen?',
      description: 'Das kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Endgültig löschen',
      destructive: true
    })
    if (!confirmed) return
    // G6/L1: the rows leave the list at click time, like a normal delete. A permanent delete is
    // the slowest write there is (flags + UID EXPUNGE), and it used to leave the mail on screen
    // for the whole round-trip. A failure puts the rows back.
    hideMails(ids)
    setSelection(EMPTY_SELECTION)
    try {
      await mailApi.expungeFromTrash(ids, accountId)
    } catch (error) {
      unhideMails(ids)
      failed('Endgültig löschen fehlgeschlagen')(error)
      return
    }
    refreshLists()
    toast.success(count > 1 ? `${count} E-Mails endgültig gelöscht` : 'Endgültig gelöscht')
  }

  // B5: "Papierkorb leeren" from the folder's context menu
  const emptyTrash = async (trash: FolderNode) => {
    const total = trash.totalCount ?? 0
    if (total === 0) {
      toast.info('Der Papierkorb ist leer.')
      return
    }
    const confirmed = await confirmAction({
      title: `${total.toLocaleString('de-DE')} E-Mails endgültig löschen?`,
      description: 'Das kann nicht rückgängig gemacht werden.',
      confirmLabel: 'Papierkorb leeren',
      destructive: true
    })
    if (!confirmed) return
    // G6/L1: the folder empties on screen at once. Collecting the ids and expunging them in
    // chunks is many round-trips, so the Trash used to stay full for the whole time. The ids are
    // hidden as they are found, and a failure puts back what has not been deleted.
    const ids: number[] = []
    try {
      // The core takes ids, not a folder: collect them first, then delete in chunks.
      // A failed expunge keeps its row, so the loop must not depend on the folder shrinking.
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await mailApi.listMessages(trash.id, { offset, limit: PAGE_SIZE }, accountId)
        ids.push(...page.map((m) => m.id))
        // the collected page is hidden right away, so the list shrinks as it is read
        hideMails(page.map((m) => m.id))
        if (page.length < PAGE_SIZE) break
      }
      for (let i = 0; i < ids.length; i += PAGE_SIZE) {
        await mailApi.expungeFromTrash(ids.slice(i, i + PAGE_SIZE), accountId)
      }
    } catch (error) {
      // whatever has not been deleted comes back
      unhideMails(ids)
      failed('Papierkorb leeren fehlgeschlagen')(error)
      refreshLists()
      return
    }
    setSelection(EMPTY_SELECTION)
    refreshLists()
    toast.success(`${total.toLocaleString('de-DE')} E-Mails endgültig gelöscht`)
  }

  /**
   * B2: move the dragged folder under `target` (null = top level). The core
   * refuses a move into itself or its own subtree and a name clash there.
   */
  const moveFolderTo = async (target: FolderNode | null) => {
    const folder = movingFolder
    setMovingFolder(null)
    if (!folder) return
    try {
      await mailApi.moveFolder(folder.path, target?.path ?? null, accountId)
      await folders.refetch()
      toast.success(
        target
          ? `„${folderLabel(folder)}“ nach „${folderLabel(target)}“ verschoben`
          : `„${folderLabel(folder)}“ nach oben verschoben`
      )
    } catch (error) {
      toast.error('Ordner konnte nicht verschoben werden', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  // B1: create / rename / delete a folder. The name is asked for in a small
  // dialog; the core validates it again and refuses protected folders.
  const folderAction = async (action: FolderAction, folder: FolderNode | null) => {
    // "Neuer Ordner…" on INBOX means top level, not inside INBOX: IMAP has no
    // subfolders of INBOX, and the card's path builder puts a child under its parent.
    const delimiter = folder?.delimiter ?? '/'
    const parentPath = action !== 'create' ? null : !folder || isInbox(folder) ? null : folder.path
    const title =
      action === 'create'
        ? parentPath
          ? `Neuer Ordner in „${folderLabel(folder!)}“`
          : 'Neuer Ordner'
        : action === 'rename'
          ? 'Ordner umbenennen'
          : 'Ordner löschen'
    const current = action === 'rename' && folder ? folder.path.split(delimiter).pop() : ''
    if (action === 'delete') {
      if (!folder) return
      const confirmed = await confirmAction({
        title: `„${folderLabel(folder) || folder.name}“ löschen?`,
        description:
          'Der Ordner wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        destructive: true
      })
      if (!confirmed) return
      try {
        await mailApi.deleteFolder(folder.path, accountId)
      } catch (error) {
        failed('Ordner konnte nicht gelöscht werden')(error)
        return
      }
      refreshLists()
      toast.success('Ordner gelöscht')
      return
    }
    const name = await askFolderName({ title, initial: current })
    if (name === null) return
    try {
      if (action === 'create') await mailApi.createFolder(parentPath, name, accountId)
      else if (folder) await mailApi.renameFolder(folder.path, name, accountId)
    } catch (error) {
      failed(
        action === 'create'
          ? 'Ordner konnte nicht angelegt werden'
          : 'Ordner konnte nicht umbenannt werden'
      )(error)
      return
    }
    refreshLists()
    toast.success(action === 'create' ? 'Ordner angelegt' : 'Ordner umbenannt')
  }

  const composeFrom = (message: MessageDetail, kind: 'reply' | 'replyAll' | 'forward') => {
    openedId.current = null
    startCompose(
      kind === 'forward'
        ? forwardCompose(message)
        : replyCompose(message, { all: kind === 'replyAll', ownEmail: account?.email ?? '' })
    )
  }

  // "/" focuses the search, as in most mail clients; B3 adds the action shortcuts.
  // Declared after every handler it calls, so the effect never closes over a value
  // that is declared later.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === '/' && !target?.closest('input, textarea, [contenteditable]')) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      // A shortcut never steals a keystroke while the user is typing, and MR-37: not from a dialog,
      // a popover, a menu or the compose area either - the handler is on window, so those reached
      // the list and moved mail or replaced the open editor
      if (isTypingTarget(target)) return
      if (shortcutBlocked({ target, composeOpen: compose !== null })) return
      const ids = selection.ids
      const action = shortcutFor(event, {
        hasSelection: ids.length > 0,
        canWrite,
        hasReader: selectedId !== null
      })
      if (!action) return
      event.preventDefault()
      switch (action) {
        case 'markUnread':
          markRead(ids, false)
          break
        case 'markRead':
          markRead(ids, true)
          break
        case 'toTrash':
          if (trashable.length)
            void moveAway(
              trashable.map((m) => m.id),
              { kind: 'delete' }
            )
          break
        case 'move':
          // There is no folder-picker dialog: moving is drag and drop. The shortcut
          // puts the keyboard on the folder tree, where the drop targets are.
          folderTreeRef.current?.focus()
          break
        case 'compose':
          startCompose(emptyCompose())
          break
        case 'reply':
          if (selectedId !== null) composeFromList(selectedId, 'reply')
          break
        case 'replyAll':
          if (selectedId !== null) composeFromList(selectedId, 'replyAll')
          break
        case 'forward':
          if (selectedId !== null) composeFromList(selectedId, 'forward')
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (accounts.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!account) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-2xl font-bold">E-Mail</h1>
        <p className="text-sm text-muted-foreground">Es ist noch kein Postfach eingerichtet.</p>
        <Button onClick={() => void navigate({ to: '/settings', search: { tab: 'email' } })}>
          Postfach einrichten
        </Button>
      </div>
    )
  }

  const listLoading = searching ? results.isLoading : messages.isLoading || folders.isLoading
  const chooseFolder = (id: string) => {
    setChosenFolderId(id)
    setSelection(EMPTY_SELECTION)
    openedId.current = null
    setCompose(null)
    clearSearch()
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
        <h1 className="text-lg font-semibold">E-Mail</h1>
        {(accounts.data?.length ?? 0) > 1 ? (
          <Select
            value={account.id}
            onValueChange={(id) => {
              setChosenAccountId(id as string)
              setChosenFolderId(null)
              setSelection(EMPTY_SELECTION)
              openedId.current = null
              setCompose(null)
              clearSearch()
              // I10 Low: the hidden rows belong to the account they were hidden in. Carried over, an
              // id that happens to exist in the new account would stay invisible for no reason.
              setHiddenIds([])
            }}
          >
            <SelectTrigger className="w-64" aria-label="Postfach">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.data?.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm text-muted-foreground">{account.email}</span>
        )}
        {!canWrite && (
          <span
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
            role="note"
            title="Nichts wird am Server geändert: kein Lesen-Markieren, Löschen oder Verschieben."
          >
            <Lock className="size-3" />
            Nur lesen
          </span>
        )}
        {canWrite && (
          <Button
            size="sm"
            onClick={() => {
              openedId.current = null
              startCompose(emptyCompose())
            }}
          >
            <SquarePen />
            Neue E-Mail
          </Button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {canWrite && (
            <OpJournalPanel
              entries={opList}
              now={opNow}
              busyId={busyOpId}
              onAction={(entry, action) => void runOpAction(entry, action)}
            />
          )}
          <SyncIndicator
            status={syncStatus.data}
            runningOp={runningOp}
            onPause={() => void mailApi.pauseSync(accountId).then(() => syncStatus.refetch())}
            onResume={() => void mailApi.resumeSync(accountId).then(() => syncStatus.refetch())}
            onSync={() =>
              void mailApi
                .triggerSync(false, accountId)
                .then(() => syncStatus.refetch())
                .catch(failed('Synchronisierung fehlgeschlagen'))
            }
          />
        </div>
      </header>

      {workerStatus.data?.error && (
        <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          Der E-Mail-Dienst läuft nicht: {workerStatus.data.error}
        </p>
      )}
      {workerStatus.data?.starting && (
        <p
          role="status"
          className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm text-muted-foreground"
        >
          <Spinner className="size-4" />
          Der E-Mail-Dienst startet. Nach einem Update kann das bei einem großen Postfach einige
          Minuten dauern.
        </p>
      )}

      {loginFailed && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive"
          data-testid="mail-login-failed"
        >
          <p className="min-w-0 flex-1">
            Anmeldung fehlgeschlagen: Der Server hat Benutzername oder Passwort abgelehnt.
            Bookingium versucht es erst wieder, wenn das Konto neu gespeichert wird.
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void navigate({ to: '/settings', search: { tab: 'email' } })}
          >
            Zugangsdaten prüfen
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <nav
          className="hidden shrink-0 overflow-auto p-2 lg:block"
          style={{ width: folderWidth }}
          aria-label="Ordnerliste"
        >
          {folders.isLoading ? (
            <Spinner className="m-2" />
          ) : (
            <FolderTree
              focusRef={folderTreeRef}
              folders={folders.data ?? []}
              selectedId={searching ? null : folderId}
              onSelect={chooseFolder}
              onEmptyTrash={canWrite ? (folder) => void emptyTrash(folder) : undefined}
              onFolderAction={
                canWrite ? (action, folder) => void folderAction(action, folder) : undefined
              }
              drop={
                dragged
                  ? {
                      canDrop: (target) => dragged.some((m) => m.folderId !== target.id),
                      onDrop: (target) =>
                        void moveAway(
                          dragged.filter((m) => m.folderId !== target.id).map((m) => m.id),
                          { kind: 'folder', folder: target }
                        )
                    }
                  : undefined
              }
              folderMove={
                canWrite
                  ? {
                      canMove: (target) =>
                        movingFolder !== null &&
                        (target === null ||
                          (target.path !== movingFolder.path &&
                            !target.path.startsWith(`${movingFolder.path}/`))),
                      onMove: (target) => void moveFolderTo(target),
                      onDragStart: (folder) => setMovingFolder(folder),
                      // F6: a cancelled or finished drag disarms the folder again
                      onDragEnd: () => setMovingFolder(null)
                    }
                  : undefined
              }
            />
          )}
        </nav>
        <PaneResizer
          label="Breite der Ordnerliste"
          className="hidden lg:block"
          width={folderWidth}
          defaultWidth={FOLDER_PANE.initial}
          min={FOLDER_PANE.min}
          max={FOLDER_PANE.max}
          onResize={setFolderWidth}
        />

        <section
          // The reader keeps at least a third of the window
          className="flex max-w-[45vw] shrink-0 flex-col"
          style={{ width: listWidth }}
          aria-label="Postfachliste"
        >
          <div className="space-y-2 border-b p-2">
            {/* Narrow windows: a folder picker instead of the tree */}
            <Select
              value={folderId ?? undefined}
              onValueChange={(id) => chooseFolder(id as string)}
            >
              <SelectTrigger className="w-full lg:hidden" aria-label="Ordner wählen">
                <SelectValue placeholder="Ordner" />
              </SelectTrigger>
              <SelectContent>
                {allFolders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {folderLabel(f) === f.name ? f.path : folderLabel(f)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setFacetFolderId(null)
                  }}
                  onKeyDown={(e) => e.key === 'Escape' && clearSearch()}
                  placeholder="Suchen (/)"
                  aria-label="E-Mails durchsuchen"
                  className="pl-8"
                />
              </div>
              <Button
                variant={showFilters || hasFilter ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
              >
                Filter
              </Button>
              {searching && (
                <Button variant="ghost" size="icon-sm" onClick={clearSearch} title="Suche beenden">
                  <X />
                </Button>
              )}
            </div>
            {showFilters && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Input
                  className="col-span-2"
                  value={filters.from}
                  onChange={(e) => setFilters({ ...filters, from: e.target.value })}
                  placeholder="Von (Name oder Adresse)"
                  aria-label="Von"
                />
                <label className="flex flex-col gap-1">
                  ab
                  <Input
                    type="date"
                    value={filters.after}
                    onChange={(e) => setFilters({ ...filters, after: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  bis
                  <Input
                    type="date"
                    value={filters.before}
                    onChange={(e) => setFilters({ ...filters, before: e.target.value })}
                  />
                </label>
                <label className="col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={filters.hasAttachment}
                    onChange={(e) => setFilters({ ...filters, hasAttachment: e.target.checked })}
                  />
                  Nur mit Anhang
                </label>
              </div>
            )}
            {searching && firstResult && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  {firstResult.total.toLocaleString('de-DE')} Treffer · {firstResult.elapsedMs} ms
                </p>
                {firstResult.facets && firstResult.facets.length > 1 && (
                  <div className="flex flex-wrap gap-1" aria-label="Treffer nach Ordner">
                    {firstResult.facets.slice(0, 8).map((facet) => {
                      const f = allFolders.find((x) => x.id === facet.folderId)
                      const active = facetFolderId === facet.folderId
                      return (
                        <button
                          key={facet.folderId}
                          type="button"
                          onClick={() => setFacetFolderId(active ? null : facet.folderId)}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-xs',
                            active ? 'border-primary bg-primary/10' : 'hover:bg-muted'
                          )}
                          aria-pressed={active}
                        >
                          {f ? folderLabel(f) : '?'} {facet.count}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {listLoading ? (
              <Spinner className="m-4" />
            ) : (
              <MessageList
                items={listItems}
                selection={selection}
                onSelectionChange={changeSelection}
                multiple={canWrite}
                onOpen={openWindow}
                onDelete={selectedActions.toTrash}
                onDragMessages={
                  canWrite
                    ? (mails) => {
                        // F6: a mail drag is never a folder move, whatever came before
                        if (mails) setMovingFolder(null)
                        setDragged(mails)
                      }
                    : undefined
                }
                menu={
                  <MessageMenu
                    items={selectedItems}
                    folders={allFolders}
                    actions={selectedActions}
                  />
                }
                snippets={searching ? snippets : undefined}
                hasMore={Boolean(searching ? results.hasNextPage : messages.hasNextPage)}
                loadingMore={searching ? results.isFetchingNextPage : messages.isFetchingNextPage}
                onLoadMore={() =>
                  void (searching ? results.fetchNextPage() : messages.fetchNextPage())
                }
                emptyText={
                  searching
                    ? 'Keine Treffer.'
                    : syncStatus.data?.running
                      ? 'Wird synchronisiert…'
                      : 'Dieser Ordner ist leer.'
                }
              />
            )}
          </div>
        </section>
        <PaneResizer
          label="Breite der Nachrichtenliste"
          width={listWidth}
          defaultWidth={LIST_PANE.initial}
          min={LIST_PANE.min}
          max={LIST_PANE.max}
          onResize={setListWidth}
        />

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
                allFolders.find(
                  (f) => f.id === listItems.find((m) => m.id === selectedId)?.folderId
                )
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
              onMarkUnread={(id) => markRead([id], false)}
              onCompose={reading.canCompose ? composeFrom : undefined}
              onWriteTo={
                reading.canWriteTo
                  ? (address) => startCompose(composeTo(address, account?.signature))
                  : undefined
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
      </div>
    </div>
  )
}
