import { useMemo, useRef, useState } from 'react'
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
import { readingActions } from '@/components/mail/readingActions'
import { withWholeMessage } from '@/components/mail/completion'
import { archiveableIds } from '@/components/mail/archiveActions'
import { OpJournalPanel } from '@/components/mail/OpJournalPanel'
import { SyncIndicator } from '@/components/mail/SyncIndicator'
import {
  type ComposeState,
  emptyCompose,
  forwardCompose,
  fromSavedDraft,
  replyCompose,
  withSignature,
  composeTo
} from '@/components/mail/composeDraft'
import { FolderTree } from '@/components/mail/FolderTree'
import { MessageList } from '@/components/mail/MessageList'
import { type MailActions, MessageMenu } from '@/components/mail/MessageMenu'
import { MessageView } from '@/components/mail/MessageView'
import { PaneResizer } from '@/components/mail/PaneResizer'
import { SelectionActions } from '@/components/mail/SelectionActions'
import { EMPTY_SELECTION, type Selection } from '@/components/mail/selection'
import { useStoredWidth } from '@/hooks/useStoredWidth'
import { useMailSearch } from '@/hooks/useMailSearch'
import { useMailOps } from '@/hooks/useMailOps'
import { useMessageActions } from '@/hooks/useMessageActions'
import { useFolderActions } from '@/hooks/useFolderActions'
import { useMailShortcuts } from '@/hooks/useMailShortcuts'
import { useInboxUnread } from '@/hooks/useMailUnreadCount'
import { unreadBadgeLabel } from '@/components/mail/unreadBadge'
import { PAGE_SIZE } from '@/components/mail/paging'
import {
  flattenFolders,
  folderLabel,
  isDrafts,
  isInbox,
  isTrash,
  messageKey
} from '@/components/mail/format'
import type { MessageDetail, MessageListItem } from '../../../main/mailclient/core/types'

// Pane widths in px; the user can drag them, see PaneResizer
const FOLDER_PANE = { initial: 224, min: 160, max: 480 }
const LIST_PANE = { initial: 352, min: 260, max: 720 }

/** The mail client, or a note while "E-Mail (experimentell)" is off (the menu then has no entry) */
export default function MailPage() {
  const navigate = useNavigate()
  const settings = trpcReact.settings.get.useQuery()
  if (!settings.data) return null
  if (settings.data.mailClient) return <MailClient />
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">E-Mail</h1>
      <p className="text-sm text-muted-foreground">Der E-Mail-Client ist ausgeschaltet.</p>
      <Button onClick={() => void navigate({ to: '/settings', search: { tab: 'email' } })}>
        Zu den Einstellungen
      </Button>
    </div>
  )
}

/** "· 6 ungelesen" after an account in the picker; nothing when all is read */
function UnreadCount({ unread }: { unread: number | undefined }) {
  if (!unread) return null
  return (
    <span className="ml-1.5 text-xs text-muted-foreground" title="Ungelesen im Posteingang">
      · {unreadBadgeLabel(unread)} ungelesen
    </span>
  )
}

function MailClient() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const accounts = trpcReact.mail.accounts.list.useQuery()
  // Each account's INBOX unread in the picker, the menu badge's numbers (#88)
  const inboxUnread = useInboxUnread().accounts
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

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'folders'] })
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'messages'] })
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'search'] })
  }

  const failed = (title: string) => (error: unknown) =>
    toast.error(title, { description: error instanceof Error ? error.message : undefined })

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

  const { setHiddenIds, listItems, markRead, markFlagged, moveAway, expunge, emptyTrash } =
    useMessageActions({
      accountId,
      searching,
      results,
      messages,
      allFolders,
      setSelection,
      refreshLists,
      failed
    })

  const { movingFolder, setMovingFolder, moveFolderTo, folderAction } = useFolderActions({
    accountId,
    folders,
    refreshLists,
    failed
  })

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

  const { runningOp, opList, opNow, busyOpId, runOpAction } = useMailOps({
    accountId,
    ready,
    canWrite,
    refreshLists,
    failed
  })

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

  const hasArchive = allFolders.some((f) => f.specialUse?.includes('Archive'))
  const folderOf = (item: MessageListItem) => allFolders.find((f) => f.id === item.folderId)

  // Reply and forward from the menu need the whole mail
  const composeFromList = (id: number, kind: 'reply' | 'replyAll' | 'forward') => {
    queryClient
      .fetchQuery({
        queryKey: messageKey(accountId, id),
        queryFn: () => mailApi.getMessage(id, accountId)
      })
      .then((message) =>
        kind === 'forward'
          ? // S1: a forward carries the files, so a mail stored without them is downloaded first
            withWholeMessage(
              message,
              {
                complete: () => mailApi.completeMessage(id, accountId),
                busy: (on) =>
                  on
                    ? toast.loading('Nachricht wird geladen…', { id: `complete-${id}` })
                    : toast.dismiss(`complete-${id}`),
                adopt: (whole) => queryClient.setQueryData(messageKey(accountId, id), whole)
              },
              (whole) => composeFrom(whole, kind)
            ).catch(failed('Anhänge konnten nicht geladen werden'))
          : composeFrom(message, kind)
      )
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

  const composeFrom = (message: MessageDetail, kind: 'reply' | 'replyAll' | 'forward') => {
    openedId.current = null
    startCompose(
      kind === 'forward'
        ? forwardCompose(message)
        : replyCompose(message, { all: kind === 'replyAll', ownEmail: account?.email ?? '' })
    )
  }

  useMailShortcuts({
    searchRef,
    folderTreeRef,
    compose,
    selection,
    selectedId,
    canWrite,
    markRead,
    trashable,
    moveAway,
    startCompose,
    composeFromList
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
                  <UnreadCount unread={inboxUnread.find((entry) => entry.id === a.id)?.unread} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm text-muted-foreground">
            {account.email}
            <UnreadCount unread={inboxUnread[0]?.unread} />
          </span>
        )}
        {!canWrite && (
          <span
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
            role="note"
            title={
              account?.writeRefusal ??
              'Nichts wird am Server geändert: kein Lesen-Markieren, Löschen oder Verschieben.'
            }
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
