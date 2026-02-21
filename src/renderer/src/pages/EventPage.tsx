import { useState } from 'react'
import { trpcReact } from '@/main'
import { type ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/data-table'
import { CreateEventWizard } from '@/components/forms/CreateEventWizard'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { DealMemoListItemDto } from 'src/main/api/schemas/deal_memo.schema'

// TODO: create an enum or something for this to avoid hard-coded status strings everywhere
const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

export function EventPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')
  const [wizardOpen, setWizardOpen] = useState(false)

  const utils = trpcReact.useUtils()

  const events = trpcReact.dealMemo.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

  const deleteMutation = trpcReact.dealMemo.delete.useMutation({
    onSuccess: () => {
      utils.dealMemo.getAllPaginated.invalidate()
      toast.success('Event deleted')
    },
    onError: (e) => toast.error('Failed to delete event', { description: e.message })
  })

  const handleDelete = (id: number, name: string) => {
    if (confirm(`Delete event "${name}"? This cannot be undone.`)) {
      deleteMutation.mutate(id)
    }
  }

  const columns: ColumnDef<DealMemoListItemDto>[] = [
    {
      accessorKey: 'deal',
      header: 'Event',
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>
    },
    {
      accessorKey: 'date',
      header: 'Date',
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
      header: 'Venue',
      cell: (info) => (info.getValue() as string | null) ?? '-'
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: (info) => {
        const status = (info.getValue() as string) || 'pending'
        return (
          <Badge
            variant="outline"
            className={cn('capitalize', STATUS_STYLES[status] ?? '')}
          >
            {status}
          </Badge>
        )
      }
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const event = row.original
        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-destructive hover:text-destructive"
              onClick={() => handleDelete(event.id, event.deal)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      }
    }
  ]

  return (
    <div className="flex flex-col w-full h-full p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Events</h1>
        <p className="text-sm text-muted-foreground">
          Manage your shows, tours, and deal memos.
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
        searchPlaceholder="Filter events…"
        isLoading={events.isLoading}
        total={events.data?.total ?? 0}
        actionButton={
          <Button onClick={() => setWizardOpen(true)}>+ New Event</Button>
        }
      />

      <CreateEventWizard
        isOpen={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSuccess={() => setWizardOpen(false)}
      />
    </div>
  )
}

export default EventPage
