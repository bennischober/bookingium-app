import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Lock, Mail, Pause, Play, RefreshCw, Search, SquarePen, WifiOff, X } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { mailApi } from '@/lib/mailApi'
import { retryIn } from '@/lib/mailConnection'
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
import {
  type ComposeState,
  emptyCompose,
  forwardCompose,
  fromSavedDraft,
  replyCompose,
  withSignature
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
import { isTypingTarget, shortcutFor } from '@/components/mail/shortcuts'
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
  OpSummary,
  SearchFilters,
  SyncStatus
} from '../../../main/mailclient/core/types'

const PAGE_SIZE = 100
// Shorter queries match too much to be useful (FTS prefix search)
const MIN_QUERY_LENGTH = 3
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

type ExtraFilters = { from: string; after: string; before: string; hasAttachment: boolean }
const NO_FILTERS: ExtraFilters = { from: '', after: '', before: '', hasAttachment: false }

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** The current time, updated every second while `active` (for countdowns) */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const tick = () => setNow(Date.now())
    // `now` may be old when the countdown starts
    const first = setTimeout(tick, 0)
    const timer = setInterval(tick, 1000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [active])
  return now
}

function SyncIndicator({
  status,
  onPause,
  onResume,
  onSync
}: {
  status: SyncStatus | undefined
  onPause: () => void
  onResume: () => void
  onSync: () => void
}) {
  const offline = status?.connection === 'offline' && !status.running
  const now = useNow(offline && Boolean(status?.retryAt))
  if (!status) return null
  // The banner below the header explains this one
  if (status.connection === 'auth-failed') {
    return (
      <div className="text-xs text-destructive" aria-live="polite">
        Anmeldung fehlgeschlagen
      </div>
    )
  }
  if (offline) {
    const due = status.retryAt ? new Date(status.retryAt).getTime() <= now : false
    return (
      <div
        className="flex items-center gap-1 text-xs text-muted-foreground"
        aria-live="polite"
        title={status.connectionError ?? undefined}
        data-testid="mail-offline"
      >
        <WifiOff className="size-3.5" />
        <span>
          Offline
          {status.retryAt &&
            (due ? ' · verbinde…' : ` · nächster Versuch ${retryIn(status.retryAt, now)}`)}
        </span>
        <Button variant="ghost" size="icon-xs" onClick={onSync} title="Jetzt verbinden">
          <RefreshCw />
        </Button>
      </div>
    )
  }
  const initial = status.phase === 'initial' || status.phase === 'paused'
  const progress =
    initial && status.messagesDone !== undefined
      ? `${status.messagesDone.toLocaleString('de-DE')}${
          status.messagesTotal ? ` / ${status.messagesTotal.toLocaleString('de-DE')}` : ''
        } E-Mails`
      : `${status.foldersSynced} / ${status.foldersTotal} Ordner`

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
      {status.paused ? (
        <>
          <span>Download pausiert · {progress}</span>
          <Button variant="ghost" size="icon-xs" onClick={onResume} title="Fortsetzen">
            <Play />
          </Button>
        </>
      ) : status.running ? (
        <>
          <Spinner className="size-3" />
          <span>
            {status.connection === 'connecting' ? 'Verbinde…' : `Synchronisiere · ${progress}`}
          </span>
          {initial && (
            <Button variant="ghost" size="icon-xs" onClick={onPause} title="Pausieren">
              <Pause />
            </Button>
          )}
        </>
      ) : (
        <>
          <span>
            {status.lastSyncAt
              ? `Synchronisiert ${new Date(status.lastSyncAt).toLocaleTimeString('de-DE', {
                  hour: '2-digit',
                  minute: '2-digit'
                })}`
              : 'Noch nicht synchronisiert'}
          </span>
          <Button variant="ghost" size="icon-xs" onClick={onSync} title="Jetzt synchronisieren">
            <RefreshCw />
          </Button>
        </>
      )}
      {status.errors.length > 0 && (
        <span className="text-destructive" title={status.errors.join('\n')}>
          · {status.errors.length} Fehler
        </span>
      )}
    </div>
  )
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
  const canWrite = account?.kind === 'sandbox'

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
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ExtraFilters>(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [facetFolderId, setFacetFolderId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
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

  // Search replaces the folder list while a query or filter is set
  const searchInput = useDebounced({ query: query.trim(), ...filters }, 180)
  const hasFilter = Boolean(
    searchInput.from || searchInput.after || searchInput.before || searchInput.hasAttachment
  )
  const searching = searchInput.query.length >= MIN_QUERY_LENGTH || hasFilter
  const searchFilters: SearchFilters = {
    query: searchInput.query.length >= MIN_QUERY_LENGTH ? searchInput.query : '',
    from: searchInput.from || undefined,
    after: searchInput.after || undefined,
    before: searchInput.before || undefined,
    hasAttachment: searchInput.hasAttachment || undefined,
    folderId: facetFolderId ?? undefined,
    sortBy: searchInput.query.length >= MIN_QUERY_LENGTH ? 'relevance' : 'date'
  }
  const results = useInfiniteQuery({
    queryKey: ['mail', accountId, 'search', searchFilters],
    queryFn: ({ pageParam = 0 }) =>
      mailApi.search(
        {
          ...searchFilters,
          limit: PAGE_SIZE,
          offset: pageParam as number,
          wantFacets: pageParam === 0,
          wantSnippets: true
        },
        accountId
      ),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0)
      return last.items.length === PAGE_SIZE && loaded < last.total ? loaded : undefined
    },
    enabled: ready && searching,
    keepPreviousData: true
  })

  const listItems = searching
    ? (results.data?.pages.flatMap((p) => p.items) ?? [])
    : (messages.data?.pages.flat() ?? [])
  // Selected mails that are still in the list (a sync may have taken some away)
  const selectedItems = listItems.filter((m) => selection.ids.includes(m.id))
  const snippets = useMemo(
    () => Object.assign({}, ...(results.data?.pages.map((p) => p.snippetMap) ?? [])),
    [results.data]
  ) as Record<number, string>
  const firstResult = results.data?.pages[0]

  const syncStatus = useQuery({
    queryKey: ['mail', accountId, 'sync'],
    queryFn: () => mailApi.getSyncStatus(accountId),
    enabled: ready,
    refetchInterval: (data) =>
      data?.running || data?.connection === 'connecting' || data?.connection === 'offline'
        ? 2000
        : 10_000
  })
  const loginFailed = syncStatus.data?.connection === 'auth-failed'

  // Refresh folders and lists when the sync stored something new or a change
  // was made (also in a mail window); batched, the initial download reports every folder
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(refreshTimer.current), [])
  trpcReact.mail.events.useSubscription(undefined, {
    enabled: ready,
    onData: (event) => {
      if (event.accountId !== accountId) return
      if (event.type === 'op-event') {
        clearTimeout(refreshTimer.current)
        refreshTimer.current = setTimeout(() => {
          refreshLists()
          void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'message'] })
        }, 300)
        return
      }
      if (event.type !== 'sync-event') return
      const sync = event.event as {
        type: string
        newCount?: number
        flagChanges?: number
        expunged?: number
        moved?: number
      }
      const changed =
        sync.type === 'folder-list' ||
        (sync.type === 'folder-done' &&
          Boolean(sync.newCount || sync.flagChanges || sync.expunged || sync.moved))
      if (!changed) return
      clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'folders'] })
        void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'messages'] })
      }, 1000)
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
    let ops: OpSummary[]
    try {
      if (target.kind === 'delete') ops = await mailApi.deleteToTrash(ids, accountId)
      else if (target.kind === 'archive') ops = await mailApi.archive(ids, accountId)
      else ops = await mailApi.moveToFolder(ids, target.folder.id, accountId)
    } catch (error) {
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
    const notDone = ops.filter((op) => op.state !== 'done')
    if (notDone.length > 0) {
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
    const next = nextAfterRemoval(order, ids)
    setSelection((current) =>
      current.ids.some((id) => ids.includes(id))
        ? next !== null
          ? single(next)
          : EMPTY_SELECTION
        : current
    )
    toast.success(ids.length > 1 ? texts.many(ids.length, label) : texts.done(label), {
      action: undo
    })
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
  // B5: permanent deletion is offered only for mails that are in Trash
  const inTrashItems = selectedItems.filter((m) => isTrash(folderOf(m)))
  const selectedActions: MailActions = canWrite
    ? {
        openWindow,
        compose: composeFromList,
        markRead,
        markFlagged,
        move: (ids, target) => void moveAway(ids, { kind: 'folder', folder: target }),
        archive: hasArchive ? (ids) => void moveAway(ids, { kind: 'archive' }) : undefined,
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
    try {
      await mailApi.expungeFromTrash(ids, accountId)
    } catch (error) {
      failed('Endgültig löschen fehlgeschlagen')(error)
      return
    }
    setSelection(EMPTY_SELECTION)
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
    try {
      // The core takes ids, not a folder: collect them first, then delete in chunks.
      // A failed expunge keeps its row, so the loop must not depend on the folder shrinking.
      const ids: number[] = []
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const page = await mailApi.listMessages(trash.id, { offset, limit: PAGE_SIZE }, accountId)
        ids.push(...page.map((m) => m.id))
        if (page.length < PAGE_SIZE) break
      }
      for (let i = 0; i < ids.length; i += PAGE_SIZE) {
        await mailApi.expungeFromTrash(ids.slice(i, i + PAGE_SIZE), accountId)
      }
    } catch (error) {
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
      // A shortcut never steals a keystroke while the user is typing
      if (isTypingTarget(target)) return
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
  const clearSearch = () => {
    setQuery('')
    setFilters(NO_FILTERS)
    setFacetFolderId(null)
  }
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
        <div className="ml-auto">
          <SyncIndicator
            status={syncStatus.data}
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
                      onDragStart: (folder) => setMovingFolder(folder)
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
                onDragMessages={canWrite ? setDragged : undefined}
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
              onArchive={hasArchive ? (id) => void moveAway([id], { kind: 'archive' }) : undefined}
              onMarkUnread={(id) => markRead([id], false)}
              onCompose={composeFrom}
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
