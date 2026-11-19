import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { mailApi } from '@/lib/mailApi'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { readingActions } from '@/components/mail/readingActions'
import { withWholeMessage } from '@/components/mail/completion'
import { archiveableIds } from '@/components/mail/archiveActions'
import { blockRule, inboxOf, junkFolderOf, spamTargets } from '@/components/mail/spamActions'
import {
  type ComposeState,
  emptyCompose,
  forwardCompose,
  editAsNewCompose,
  fromSavedDraft,
  replyCompose,
  withSignature
} from '@/components/mail/composeDraft'
import { hasPendingCompose, takePendingCompose } from '@/components/mail/pendingCompose'
import { FolderPane } from '@/components/mail/FolderPane'
import { FolderTree } from '@/components/mail/FolderTree'
import { MailHeader } from '@/components/mail/MailHeader'
import { MailListPane } from '@/components/mail/MailListPane'
import { MailStatusBanners } from '@/components/mail/MailStatusBanners'
import type { MailActions } from '@/components/mail/MessageMenu'
import { PaneResizer } from '@/components/mail/PaneResizer'
import { type OpenCompose, ReadingPane } from '@/components/mail/ReadingPane'
import { EMPTY_SELECTION, type Selection, single } from '@/components/mail/selection'
import { useStoredWidth } from '@/hooks/useStoredWidth'
import { useMailFolders } from '@/hooks/useMailFolders'
import { useMailSearch } from '@/hooks/useMailSearch'
import { useMailOps } from '@/hooks/useMailOps'
import { useMailSyncStatus } from '@/hooks/useMailSyncStatus'
import { useMessageActions } from '@/hooks/useMessageActions'
import { useFolderActions } from '@/hooks/useFolderActions'
import { useMailShortcuts } from '@/hooks/useMailShortcuts'
import { useInboxUnread } from '@/hooks/useMailUnreadCount'
import { PAGE_SIZE } from '@/components/mail/paging'
import { isDrafts, isInbox, isTrash, messageKey } from '@/components/mail/format'
import type { MessageDetail, MessageListItem } from '../../../main/mailclient/core/types'
import type { QuickActions } from '@/components/mail/MessageList'

// Pane widths in px; the user can drag them, see PaneResizer
const FOLDER_PANE = { initial: 224, min: 160, max: 480 }
const LIST_PANE = { initial: 352, min: 260, max: 720 }

/** The mail client; #136: always part of the app, no longer behind a switch */
export default function MailPage() {
  return <MailClient />
}

function MailClient() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  // #214: "Absender immer als Spam" is an ordinary mail rule
  const saveRule = trpcReact.mailRule.save.useMutation({
    onError: (error) =>
      toast.error('Regel konnte nicht angelegt werden', { description: error.message })
  })
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
  // The open editor, in place of the reading pane
  const [compose, setCompose] = useState<OpenCompose | null>(null)
  // The mails being dragged onto a folder, if any
  const [dragged, setDragged] = useState<MessageListItem[] | null>(null)
  // The list grouped into threads instead of one row per mail
  const [threads, setThreads] = useState(false)
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
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'threads'] })
    void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'search'] })
  }

  const failed = (title: string) => (error: unknown) =>
    toast.error(title, { description: error instanceof Error ? error.message : undefined })

  const { folders, allFolders, otherAccounts, otherFolders } = useMailFolders({
    accounts: accounts.data,
    accountId,
    ready
  })
  const folderId = chosenFolderId ?? allFolders.find(isInbox)?.id ?? allFolders[0]?.id ?? null

  const messages = useInfiniteQuery({
    queryKey: ['mail', accountId, 'messages', folderId],
    queryFn: ({ pageParam = 0 }) =>
      mailApi.listMessages(folderId!, { offset: pageParam as number, limit: PAGE_SIZE }, accountId),
    getNextPageParam: (last, pages) =>
      last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: ready && folderId !== null
  })

  // The same folder grouped into threads, newest first. A separate query so the
  // list keeps its own rows: a thread only decides how they are shown.
  const threadList = useInfiniteQuery({
    queryKey: ['mail', accountId, 'threads', folderId],
    queryFn: ({ pageParam = 0 }) =>
      mailApi.listThreads(folderId, { offset: pageParam as number, limit: PAGE_SIZE }, accountId),
    getNextPageParam: (last, pages) =>
      last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: ready && folderId !== null && threads
  })

  const search = useMailSearch({ accountId, ready })
  const { searchRef, searching, results, clearSearch } = search

  const {
    setHiddenIds,
    listItems,
    markRead,
    markFlagged,
    moveAway,
    expunge,
    emptyTrash,
    markFolderRead,
    emptyFolder
  } = useMessageActions({
    accountId,
    searching,
    results,
    messages,
    allFolders,
    setSelection,
    refreshLists,
    failed
  })

  const { movingFolder, setMovingFolder, moveFolderTo, folderAction, setSyncMode } =
    useFolderActions({
      accountId,
      folders,
      refreshLists,
      failed
    })

  // Selected mails that are still in the list (a sync may have taken some away)
  const selectedItems = listItems.filter((m) => selection.ids.includes(m.id))

  const sync = useMailSyncStatus({ accountId, ready, folderId, allFolders, failed })
  const { syncStatus, loginFailed, folderSyncErrors } = sync

  const ops = useMailOps({
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
  const composeFromList = (id: number, kind: 'reply' | 'replyAll' | 'forward' | 'editAsNew') => {
    queryClient
      .fetchQuery({
        queryKey: messageKey(accountId, id),
        queryFn: () => mailApi.getMessage(id, accountId)
      })
      .then((message) =>
        kind === 'forward' || kind === 'editAsNew'
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
  // #214: Spam / Kein Spam need the account's Junk folder; "Kein Spam" goes back to the inbox
  const junk = junkFolderOf(allFolders)
  const inbox = inboxOf(allFolders)
  const spam = spamTargets(selectedItems, allFolders)
  const blockSender = (id: number, scope: 'sender' | 'domain') => {
    const item = listItems.find((m) => m.id === id)
    const rule = item && junk ? blockRule(accountId, item.fromEmail, scope, junk) : null
    if (!item || !rule) {
      toast.error('Für diesen Absender lässt sich keine Regel anlegen')
      return
    }
    saveRule.mutate(rule, {
      onSuccess: () => {
        void utils.mailRule.list.invalidate()
        toast.success('Regel angelegt', {
          description:
            'Neue Mails dieses Absenders landen ab jetzt im Spam-Ordner. Ändern oder löschen unter Einstellungen › E-Mail › E-Mail-Regeln.'
        })
        if (item.folderId !== junk?.id && junk)
          void moveAway([id], { kind: 'folder', folder: junk })
      }
    })
  }
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
            : undefined,
        toSpam:
          junk && spam.toSpam.length > 0
            ? (ids) =>
                void moveAway(
                  ids.filter((id) => spam.toSpam.includes(id)),
                  { kind: 'folder', folder: junk }
                )
            : undefined,
        notSpam:
          inbox && spam.notSpam.length > 0
            ? (ids) =>
                void moveAway(
                  ids.filter((id) => spam.notSpam.includes(id)),
                  { kind: 'folder', folder: inbox }
                )
            : undefined,
        blockSender: junk ? blockSender : undefined
      }
    : { openWindow }

  /** #240: the buttons on a row under the pointer act on that row, selected or not */
  const quickActions: QuickActions | undefined = canWrite
    ? {
        archive: hasArchive
          ? (m) =>
              archiveableIds([m], allFolders).length > 0
                ? void moveAway([m.id], { kind: 'archive' })
                : toast.info('Diese E-Mail ist schon im Archiv.')
          : undefined,
        trash: (m) =>
          isTrash(folderOf(m)) ? void expunge([m.id]) : void moveAway([m.id], { kind: 'delete' }),
        toggleRead: (m) => markRead([m.id], !m.isRead),
        toggleFlag: (m) => markFlagged([m.id], !m.isFlagged)
      }
    : undefined

  const composeFrom = (
    message: MessageDetail,
    kind: 'reply' | 'replyAll' | 'forward' | 'editAsNew'
  ) => {
    openedId.current = null
    startCompose(
      kind === 'forward'
        ? forwardCompose(message)
        : kind === 'editAsNew'
          ? editAsNewCompose(message)
          : replyCompose(message, { all: kind === 'replyAll', ownEmail: account?.email ?? '' })
    )
  }

  // #65: the account whose newest unread mail opens once its INBOX list is fresh
  const [openNewest, setOpenNewest] = useState<string | null>(null)

  /**
   * Shows another account, on the given folder or its INBOX. Selection, search and the
   * editor belong to the account they were made in, so they are left behind.
   */
  const switchAccount = (id: string, folderId: string | null = null) => {
    setChosenAccountId(id)
    setChosenFolderId(folderId)
    setSelection(EMPTY_SELECTION)
    openedId.current = null
    setCompose(null)
    clearSearch()
    // I10 Low: the hidden rows belong to the account they were hidden in. Carried over, an
    // id that happens to exist in the new account would stay invisible for no reason.
    setHiddenIds([])
    // A new mail waiting to open is given up when the user moves on (a new-mail click sets it again)
    setOpenNewest(null)
  }

  // #65: a click on a new-mail popup or notification (?newMail=<account>) shows that account's
  // INBOX with its newest unread mail open. The search param is taken once and removed, so a
  // reload or Back does not open it again. An open editor is left alone: it may hold unsaved text.
  const { newMail } = useSearch({ strict: false }) as { newMail?: string }
  const showNewMail = useEffectEvent((id: string) => {
    void navigate({ to: '/mail', search: {}, replace: true })
    if (compose || !accounts.data?.some((a) => a.id === id)) return
    switchAccount(id)
    // The cached list may be older than the mail; it opens from a fresh one
    void queryClient.invalidateQueries({ queryKey: ['mail', id, 'folders'] })
    void queryClient.invalidateQueries({ queryKey: ['mail', id, 'messages'] })
    setOpenNewest(id)
  })
  useEffect(() => {
    if (newMail && accounts.data) showNewMail(newMail)
  }, [newMail, accounts.data])

  // #136: a new mail another page asked for (pendingCompose.ts), such as the mailing list's
  // BCC mail. It opens on the shown account when that one can send, else on the first that can.
  const openPendingCompose = useEffectEvent(() => {
    const state = takePendingCompose()
    if (!state) return
    const target = canWrite ? account : accounts.data?.find((a) => readingActions(a).canWrite)
    if (!target) {
      toast.error('Kein E-Mail-Konto, das senden kann', {
        description: 'Konten unter Einstellungen › E-Mail.'
      })
      return
    }
    if (target.id !== accountId) switchAccount(target.id)
    openedId.current = null
    // The target's signature: after a switch, startCompose would still see the old account
    setCompose((current) => ({
      key: (current?.key ?? 0) + 1,
      state: withSignature(state, target.signature)
    }))
  })
  useEffect(() => {
    if (accounts.data && hasPendingCompose()) openPendingCompose()
  }, [accounts.data])
  const openNewestUnread = useEffectEvent(() => {
    setOpenNewest(null)
    // The mail that came last is the one stored last: by id, not by the list's date order, in
    // which an older unread mail (or one with an odd Date header) can stand above it
    const newest = listItems.reduce<MessageListItem | null>(
      (last, m) => (!m.isRead && (!last || m.id > last.id) ? m : last),
      null
    )
    if (newest) changeSelection(single(newest.id))
  })
  const newestReady =
    openNewest !== null &&
    openNewest === accountId &&
    chosenFolderId === null &&
    folderId !== null &&
    messages.isSuccess &&
    !messages.isFetching
  useEffect(() => {
    if (newestReady) openNewestUnread()
  }, [newestReady])

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
    composeFromList,
    archive: selectedActions.archive,
    toggleFlag: canWrite
      ? (ids) =>
          markFlagged(
            ids,
            selectedItems.some((m) => !m.isFlagged)
          )
      : undefined,
    toSpam: selectedActions.toSpam
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
    setOpenNewest(null)
    setSelection(EMPTY_SELECTION)
    openedId.current = null
    setCompose(null)
    clearSearch()
  }
  const shownTree = folders.isLoading ? (
    <Spinner className="m-2" />
  ) : (
    <FolderTree
      focusRef={folderTreeRef}
      folders={folders.data ?? []}
      selectedId={searching ? null : folderId}
      onSelect={chooseFolder}
      onEmptyTrash={canWrite ? (folder) => void emptyTrash(folder) : undefined}
      onMarkFolderRead={canWrite ? (folder) => void markFolderRead(folder) : undefined}
      onEmptyFolder={canWrite ? (folder, label) => void emptyFolder(folder, label) : undefined}
      onFolderAction={canWrite ? (action, folder) => void folderAction(action, folder) : undefined}
      onSyncMode={(folder, mode) => void setSyncMode(folder, mode)}
      syncErrors={folderSyncErrors}
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
  )

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <MailHeader
        accounts={accounts.data}
        account={account}
        accountId={accountId}
        folderId={folderId}
        inboxUnread={inboxUnread}
        canWrite={canWrite}
        switchAccount={switchAccount}
        startNewMail={() => {
          openedId.current = null
          startCompose(emptyCompose())
        }}
        ops={ops}
        sync={sync}
        failed={failed}
      />
      <MailStatusBanners
        worker={workerStatus.data}
        loginFailed={loginFailed}
        syncStatus={syncStatus}
        accountId={accountId}
      />

      <div className="flex min-h-0 flex-1">
        <FolderPane
          folderWidth={folderWidth}
          accounts={accounts.data}
          accountId={accountId}
          otherAccounts={otherAccounts}
          otherFolders={otherFolders}
          inboxUnread={inboxUnread}
          shownTree={shownTree}
          switchAccount={switchAccount}
        />

        <PaneResizer
          label="Breite der Ordnerliste"
          className="hidden lg:block"
          width={folderWidth}
          defaultWidth={FOLDER_PANE.initial}
          min={FOLDER_PANE.min}
          max={FOLDER_PANE.max}
          onResize={setFolderWidth}
        />

        <MailListPane
          listWidth={listWidth}
          folderId={folderId}
          allFolders={allFolders}
          chooseFolder={chooseFolder}
          search={search}
          threads={threads}
          setThreads={setThreads}
          listLoading={listLoading}
          messages={messages}
          threadList={threadList}
          listItems={listItems}
          selection={selection}
          changeSelection={changeSelection}
          canWrite={canWrite}
          openWindow={openWindow}
          selectedItems={selectedItems}
          selectedActions={selectedActions}
          quickActions={quickActions}
          setMovingFolder={setMovingFolder}
          setDragged={setDragged}
          syncStatus={syncStatus}
        />
        <PaneResizer
          label="Breite der Nachrichtenliste"
          width={listWidth}
          defaultWidth={LIST_PANE.initial}
          min={LIST_PANE.min}
          max={LIST_PANE.max}
          onResize={setListWidth}
        />

        <ReadingPane
          compose={compose}
          setCompose={setCompose}
          selection={selection}
          setSelection={setSelection}
          selectedId={selectedId}
          selectedItems={selectedItems}
          selectedActions={selectedActions}
          account={account}
          accountId={accountId}
          canWrite={canWrite}
          reading={reading}
          allFolders={allFolders}
          listItems={listItems}
          hasArchive={hasArchive}
          markRead={markRead}
          markFlagged={markFlagged}
          moveAway={moveAway}
          composeFrom={composeFrom}
          startCompose={startCompose}
          refreshLists={refreshLists}
        />
      </div>
    </div>
  )
}
