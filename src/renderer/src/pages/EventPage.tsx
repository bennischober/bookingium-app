import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting
} from '@/hooks/useListQuery'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { type ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table'
import { CreateEventWizard } from '@/components/forms/CreateEventWizard'
import { Archive, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { DealMemoListItemDto } from 'src/main/api/schemas/deal_memo.schema'
import { confirmAction } from '@/lib/confirm'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { RowActionButton, RowActions } from '@/components/row-action-button'

// TODO: create an enum or something for this to avoid hard-coded status strings everywhere
const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Bestätigt',
  pending: 'Ausstehend',
  cancelled: 'Storniert'
}

export function EventPage() {
  const { sorting, setSorting, sortInput } = useListSorting('events', { id: 'date', desc: false })
  const [search, setSearch] = useState('')
  const [wizardOpen, setWizardOpen] = useState(false)
  // D3: the archive view replaces the list while it is open
  const [showArchive, setShowArchive] = useState(false)
  const navigate = useNavigate()

  const utils = trpcReact.useUtils()

  // ?create=true from the search palette and the "+ Neu" menu
  useListSearchActions({ onCreate: () => setWizardOpen(true) })

  const events = trpcReact.dealMemo.getAllPaginated.useInfiniteQuery(
    {
      pageSize: LIST_CHUNK_SIZE,
      search: search || undefined,
      ...sortInput
    },
    infiniteListOptions
  )

  const deleteMutation = trpcReact.dealMemo.delete.useMutation({
    onSuccess: () => {
      utils.dealMemo.getAllPaginated.invalidate()
      toast.success('Event gelöscht')
    },
    onError: (e) => toast.error('Event konnte nicht gelöscht werden', { description: e.message })
  })

  // D3: the normal way out of the working view - nothing is destroyed
  const archiveMutation = trpcReact.dealMemo.archive.useMutation({
    onSuccess: () => {
      utils.dealMemo.getAllPaginated.invalidate()
      toast.success('Event archiviert')
    },
    onError: (e) => toast.error('Event konnte nicht archiviert werden', { description: e.message })
  })

  const restoreMutation = trpcReact.dealMemo.restore.useMutation({
    onSuccess: () => {
      utils.dealMemo.listArchived.invalidate()
      utils.dealMemo.getAllPaginated.invalidate()
      toast.success('Event wiederhergestellt')
    },
    onError: (e) =>
      toast.error('Event konnte nicht wiederhergestellt werden', { description: e.message })
  })

  // D3: the archive view - archived events are out of every other surface
  const archived = trpcReact.dealMemo.listArchived.useQuery(undefined, { enabled: showArchive })

  const handleArchive = async (id: number, name: string) => {
    if (
      await confirmAction({
        title: `Event „${name}“ archivieren?`,
        description:
          'Das Event verschwindet aus den Listen und dem Kalender. Rechnungen, Dokumente und Wiedervorlagen bleiben erhalten, und es lässt sich jederzeit wiederherstellen.',
        confirmLabel: 'Archivieren'
      })
    ) {
      archiveMutation.mutate(id)
    }
  }

  const handleDelete = async (id: number, name: string) => {
    if (
      await confirmAction({
        title: `Event „${name}“ löschen?`,
        description: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        destructive: true
      })
    ) {
      deleteMutation.mutate(id)
    }
  }

  const columns: ColumnDef<DealMemoListItemDto>[] = [
    {
      accessorKey: 'name',
      header: 'Event',
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>
    },
    {
      accessorKey: 'date',
      header: 'Datum',
      cell: (info) => {
        const val = info.getValue() as string
        if (!val) return '-'
        return new Date(val).toLocaleDateString('de-DE', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
      }
    },
    {
      accessorKey: 'bandName',
      header: 'Band',
      cell: (info) => info.getValue() as string
    },
    {
      accessorKey: 'venueName',
      header: 'Spielstätte',
      cell: (info) => (info.getValue() as string | null) ?? '-'
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: (info) => {
        const status = (info.getValue() as string) || 'pending'
        return (
          <Badge variant="outline" className={cn('capitalize', STATUS_STYLES[status] ?? '')}>
            {STATUS_LABELS[status] ?? status}
          </Badge>
        )
      }
    },
    {
      id: 'actions',
      header: 'Aktionen',
      cell: ({ row }) => {
        const event = row.original
        return (
          <RowActions>
            <RowActionButton
              icon={Archive}
              label="Archivieren"
              onClick={() => handleArchive(event.id, event.name)}
            />
            <RowActionButton
              icon={Trash2}
              label="Löschen"
              destructive
              onClick={() => handleDelete(event.id, event.name)}
            />
          </RowActions>
        )
      }
    }
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold mb-2">Events</h1>
          <p className="text-sm text-muted-foreground">
            Verwalten Sie Ihre Shows, Tours und Deal Memos.
          </p>
        </div>
        {/* D3: archived events are out of every working view, and findable here */}
        <Button variant="outline" onClick={() => setShowArchive((on) => !on)}>
          <Archive className="h-4 w-4" /> {showArchive ? 'Archiv schließen' : 'Archiv'}
        </Button>
      </div>

      {showArchive ? (
        <section aria-label="Archiv" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Archivierte Events sind aus den Listen und dem Kalender verschwunden. Rechnungen,
            Dokumente und Wiedervorlagen sind erhalten.
          </p>
          {archived.isLoading ? (
            <p className="text-sm text-muted-foreground">Archiv wird geladen…</p>
          ) : (archived.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Das Archiv ist leer.</p>
          ) : (
            <ul className="rounded-lg border" aria-label="Archivierte Events">
              {(archived.data ?? []).map((event) => (
                <li
                  key={event.id}
                  className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0"
                >
                  <span className="w-24 shrink-0 text-muted-foreground">{event.date}</span>
                  <button
                    type="button"
                    onClick={() =>
                      navigate({ to: '/events/$eventId', params: { eventId: String(event.id) } })
                    }
                    className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
                  >
                    {event.name}
                  </button>
                  <span className="shrink-0 text-muted-foreground">{event.bandName ?? ''}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => restoreMutation.mutate(event.id)}
                    disabled={restoreMutation.isPending}
                  >
                    Wiederherstellen
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <DataTable
          columns={columns}
          data={listRows(events.data)}
          itemLabel={{ singular: 'Event', plural: 'Events' }}
          hasMore={events.hasNextPage ?? false}
          isLoadingMore={events.isFetchingNextPage}
          onLoadMore={() => void events.fetchNextPage()}
          sorting={sorting}
          onSortingChange={setSorting}
          filtered={Boolean(search)}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Events filtern…"
          isLoading={events.isLoading}
          error={events.error}
          onRetry={() => void events.refetch()}
          total={listTotal(events.data)}
          actionButton={
            <div className="flex flex-wrap items-center gap-2">
              <ExportButton list="events" sort={sortInput} search={search} />
              <Button onClick={() => setWizardOpen(true)}>+ Neues Event</Button>
            </div>
          }
          onRowClick={(event) =>
            navigate({ to: '/events/$eventId', params: { eventId: String(event.id) } })
          }
        />
      )}

      <CreateEventWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={(memo) => {
          setWizardOpen(false)
          navigate({ to: '/events/$eventId', params: { eventId: String(memo.id) } })
        }}
      />
    </div>
  )
}

export default EventPage
