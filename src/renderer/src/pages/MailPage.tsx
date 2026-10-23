import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Lock, Pause, Play, RefreshCw, Search, WifiOff, X } from 'lucide-react'
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
import { FolderTree } from '@/components/mail/FolderTree'
import { MessageList } from '@/components/mail/MessageList'
import { MessageView } from '@/components/mail/MessageView'
import { flattenFolders, folderLabel, isInbox, isTrash, messageKey } from '@/components/mail/format'
import type { SearchFilters, SyncStatus } from '../../../main/mailclient/core/types'

const PAGE_SIZE = 100
// Shorter queries match too much to be useful (FTS prefix search)
const MIN_QUERY_LENGTH = 3

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
  const workerStatus = trpcReact.mail.status.useQuery(undefined, { refetchInterval: 5000 })

  const [chosenAccountId, setChosenAccountId] = useState<string | null>(null)
  const account = accounts.data?.find((a) => a.id === chosenAccountId) ?? accounts.data?.[0] ?? null
  const accountId = account?.id ?? ''
  const canWrite = account?.kind === 'sandbox'

  const [chosenFolderId, setChosenFolderId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ExtraFilters>(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [facetFolderId, setFacetFolderId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const ready = Boolean(account) && workerStatus.data?.running === true

  const folders = useQuery({
    queryKey: ['mail', accountId, 'folders'],
    queryFn: () => mailApi.getFolders(accountId),
    enabled: ready
  })
  const allFolders = useMemo(() => flattenFolders(folders.data ?? []), [folders.data])
  const folderId = chosenFolderId ?? allFolders.find(isInbox)?.id ?? allFolders[0]?.id ?? null
  const folder = allFolders.find((f) => f.id === folderId)

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

  // Refresh folders and lists when the sync stored something new; batched,
  // the initial download reports every folder
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(refreshTimer.current), [])
  trpcReact.mail.events.useSubscription(undefined, {
    enabled: ready,
    onData: (event) => {
      if (event.accountId !== accountId || event.type !== 'sync-event') return
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

  const openMessage = (id: number) => {
    setSelectedId(id)
    const item = listItems.find((m) => m.id === id)
    if (canWrite && item && !item.isRead) {
      mailApi.markRead([id], true, accountId).then(refreshLists, () => undefined)
    }
  }

  const failed = (title: string) => (error: unknown) =>
    toast.error(title, { description: error instanceof Error ? error.message : undefined })

  const toggleFlag = (id: number, flagged: boolean) => {
    mailApi
      .markFlagged([id], flagged, accountId)
      .then(() => {
        refreshLists()
        void queryClient.invalidateQueries({ queryKey: messageKey(accountId, id) })
      })
      .catch(failed('Markierung fehlgeschlagen'))
  }

  // Moves the selection on, then offers to undo the journaled move
  const moveAway = async (id: number, action: 'delete' | 'archive') => {
    const index = listItems.findIndex((m) => m.id === id)
    const next = listItems[index + 1] ?? listItems[index - 1]
    try {
      if (action === 'delete') await mailApi.deleteToTrash([id], accountId)
      else await mailApi.archive([id], accountId)
    } catch (error) {
      failed(action === 'delete' ? 'Löschen fehlgeschlagen' : 'Archivieren fehlgeschlagen')(error)
      return
    }
    setSelectedId(next && next.id !== id ? next.id : null)
    refreshLists()
    const ops = await mailApi.listOps(accountId).catch(() => [])
    const op = ops.find((o) => o.kind === 'move' && o.state === 'done')
    toast.success(action === 'delete' ? 'In den Papierkorb verschoben' : 'Archiviert', {
      action: op
        ? {
            label: 'Rückgängig',
            onClick: () => {
              mailApi
                .undoOp(op.id, accountId)
                .then(refreshLists)
                .catch(failed('Rückgängig machen fehlgeschlagen'))
            }
          }
        : undefined
    })
  }

  const hasArchive = allFolders.some((f) => f.specialUse?.includes('Archive'))

  // "/" focuses the search, as in most mail clients
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key !== '/' || target?.closest('input, textarea, [contenteditable]')) return
      event.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    setSelectedId(null)
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
              setSelectedId(null)
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
          className="hidden w-56 shrink-0 overflow-auto border-r p-2 lg:block"
          aria-label="Ordnerliste"
        >
          {folders.isLoading ? (
            <Spinner className="m-2" />
          ) : (
            <FolderTree
              folders={folders.data ?? []}
              selectedId={searching ? null : folderId}
              onSelect={chooseFolder}
            />
          )}
        </nav>

        <section
          className="flex w-72 shrink-0 flex-col border-r xl:w-[22rem]"
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
                selectedId={selectedId}
                onSelect={openMessage}
                onDelete={
                  canWrite && !isTrash(folder) ? (id) => void moveAway(id, 'delete') : undefined
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

        <div className="flex min-w-0 flex-1 flex-col">
          {selectedId !== null ? (
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
              onToggleFlag={toggleFlag}
              onDelete={(id) => void moveAway(id, 'delete')}
              onArchive={hasArchive ? (id) => void moveAway(id, 'archive') : undefined}
            />
          ) : (
            <p className="m-auto text-sm text-muted-foreground">Keine E-Mail ausgewählt.</p>
          )}
        </div>
      </div>
    </div>
  )
}
