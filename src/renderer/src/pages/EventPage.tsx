import { useTablePagination } from '@/hooks/useTablePagination'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { type ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table'
import { CreateEventWizard } from '@/components/forms/CreateEventWizard'
import { Trash2 } from 'lucide-react'
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
  const [pagination, setPagination] = useTablePagination('events')
  const [search, setSearch] = useState('')
  const [wizardOpen, setWizardOpen] = useState(false)
  const navigate = useNavigate()

  const utils = trpcReact.useUtils()

  // ?create=true from the search palette and the "+ Neu" menu
  useListSearchActions({ onCreate: () => setWizardOpen(true) })

  const events = trpcReact.dealMemo.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

  const deleteMutation = trpcReact.dealMemo.delete.useMutation({
    onSuccess: () => {
      utils.dealMemo.getAllPaginated.invalidate()
      toast.success('Event gelöscht')
    },
    onError: (e) => toast.error('Event konnte nicht gelöscht werden', { description: e.message })
  })

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
    <div className="flex flex-col w-full h-full p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Events</h1>
        <p className="text-sm text-muted-foreground">
          Verwalten Sie Ihre Shows, Tours und Deal Memos.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={events.data?.items ?? []}
        pageCount={events.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPagination((prev) => ({ ...prev, pageIndex: 0 }))
        }}
        searchPlaceholder="Events filtern…"
        isLoading={events.isLoading}
        total={events.data?.total ?? 0}
        actionButton={<Button onClick={() => setWizardOpen(true)}>+ Neues Event</Button>}
        onRowClick={(event) =>
          navigate({ to: '/events/$eventId', params: { eventId: String(event.id) } })
        }
      />

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
