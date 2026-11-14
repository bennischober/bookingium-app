import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Trash2, Upload } from 'lucide-react'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting
} from '@/hooks/useListQuery'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { confirmAction } from '@/lib/confirm'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { DataTable } from '@/components/data-table'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { germanDate } from '@/components/map/mapDisplay'
import { AgencyImportDialog } from './AgencyImportDialog'
import {
  EXTERNAL_BOOKING_KIND_LABELS,
  EXTERNAL_BOOKING_STATUS_LABELS,
  type ExternalBookingDto
} from '../../../../main/api/schemas/external_booking.schema'

const STATUS_STYLES: Record<ExternalBookingDto['status'], string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

/** Select value for "every agency" */
const ALL_AGENCIES = '__all__'

/**
 * #103: the Agenturbuchungen view of the event list - shows of the user's
 * bands another agency booked. Read-only: rows come from the agency's export
 * and change only through its next import; they can be removed, one by one or
 * per agency. No row opens a page, there is nothing to edit.
 */
export function AgencyBookingsView() {
  const { sorting, setSorting, sortInput } = useListSorting('agency-bookings', {
    id: 'date',
    desc: false
  })
  const [search, setSearch] = useState('')
  const [agency, setAgency] = useState(ALL_AGENCIES)
  const [importOpen, setImportOpen] = useState(false)
  const utils = trpcReact.useUtils()

  const agencies = trpcReact.externalBooking.agencies.useQuery()
  const agencyFilter = agency === ALL_AGENCIES ? undefined : agency
  // A filter left on an agency whose last booking was removed shows all again
  const agencyKnown =
    agencyFilter === undefined || (agencies.data ?? []).some((a) => a.agency === agencyFilter)

  const bookings = trpcReact.externalBooking.getAllPaginated.useInfiniteQuery(
    {
      pageSize: LIST_CHUNK_SIZE,
      search: search || undefined,
      agency: agencyKnown ? agencyFilter : undefined,
      ...sortInput
    },
    infiniteListOptions
  )

  const invalidate = (): void => {
    void utils.externalBooking.invalidate()
    void utils.map.invalidate()
  }

  const deleteMutation = trpcReact.externalBooking.delete.useMutation({
    onSuccess: () => {
      invalidate()
      toast.success('Agenturbuchung entfernt')
    },
    onError: (e) =>
      toast.error('Agenturbuchung konnte nicht entfernt werden', { description: e.message })
  })

  const deleteAgencyMutation = trpcReact.externalBooking.deleteAgency.useMutation({
    onSuccess: (count) => {
      setAgency(ALL_AGENCIES)
      invalidate()
      toast.success(`${count} ${count === 1 ? 'Agenturbuchung' : 'Agenturbuchungen'} entfernt`)
    },
    onError: (e) =>
      toast.error('Agenturbuchungen konnten nicht entfernt werden', { description: e.message })
  })

  const handleDelete = async (booking: ExternalBookingDto) => {
    if (
      await confirmAction({
        title: `Agenturbuchung vom ${germanDate(booking.date)} entfernen?`,
        description: `${booking.bandName}${
          booking.venueName ? `, ${booking.venueName}` : ''
        }. Der nächste Import der Agentur legt sie wieder an, wenn ihre Liste sie noch enthält.`,
        confirmLabel: 'Entfernen',
        destructive: true
      })
    ) {
      deleteMutation.mutate(booking.id)
    }
  }

  const handleDeleteAgency = async (name: string) => {
    const count = agencies.data?.find((entry) => entry.agency === name)?.count ?? 0
    if (
      await confirmAction({
        title: `Alle Buchungen von „${name}“ entfernen?`,
        description: `${count} ${
          count === 1 ? 'Agenturbuchung wird' : 'Agenturbuchungen werden'
        } entfernt. Das lässt sich nicht rückgängig machen, außer durch einen neuen Import.`,
        confirmLabel: 'Alle entfernen',
        destructive: true
      })
    ) {
      deleteAgencyMutation.mutate(name)
    }
  }

  const columns: ColumnDef<ExternalBookingDto>[] = [
    {
      accessorKey: 'date',
      header: 'Datum',
      cell: (info) => germanDate(info.getValue() as string)
    },
    {
      accessorKey: 'bandName',
      header: 'Band',
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>
    },
    {
      accessorKey: 'venueName',
      header: 'Club / Festival',
      cell: ({ row }) => (
        <span title={row.original.notes || undefined}>
          {row.original.venueName || '-'}
          <span className="ml-2 text-xs text-muted-foreground">
            {EXTERNAL_BOOKING_KIND_LABELS[row.original.kind]}
          </span>
        </span>
      )
    },
    {
      accessorKey: 'city',
      header: 'Ort',
      cell: ({ row }) => [row.original.zipCode, row.original.city].filter(Boolean).join(' ') || '-'
    },
    {
      accessorKey: 'agency',
      header: 'Agentur',
      cell: (info) => info.getValue() as string
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn(STATUS_STYLES[row.original.status])}>
            {EXTERNAL_BOOKING_STATUS_LABELS[row.original.status]}
          </Badge>
          <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">
            Agenturbuchung
          </Badge>
        </span>
      )
    },
    {
      id: 'actions',
      header: 'Aktionen',
      enableSorting: false,
      cell: ({ row }) => (
        <RowActions>
          <RowActionButton
            icon={Trash2}
            label="Entfernen"
            destructive
            onClick={() => void handleDelete(row.original)}
          />
        </RowActions>
      )
    }
  ]

  return (
    <section aria-label="Agenturbuchungen" className="flex min-h-0 flex-1 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Shows Ihrer Bands, die andere Agenturen gebucht haben. Sie sind schreibgeschützt und zählen
        für Terminkonflikte, den Kalender und den Gebietsschutz auf der Karte, aber nie für
        Rechnungen, Verträge, Abrechnungen, Verteiler oder Wiedervorlagen. Ändern lassen sie sich
        nur durch einen neuen Import.
      </p>
      <DataTable
        columns={columns}
        data={listRows(bookings.data)}
        itemLabel={{ singular: 'Agenturbuchung', plural: 'Agenturbuchungen' }}
        hasMore={bookings.hasNextPage ?? false}
        isLoadingMore={bookings.isFetchingNextPage}
        onLoadMore={() => void bookings.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search) || (agencyKnown && agencyFilter !== undefined)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Agenturbuchungen filtern…"
        isLoading={bookings.isLoading}
        error={bookings.error}
        onRetry={() => void bookings.refetch()}
        total={listTotal(bookings.data)}
        actionButton={
          <div className="flex flex-wrap items-center gap-2">
            {(agencies.data ?? []).length > 1 && (
              <Select value={agencyKnown ? agency : ALL_AGENCIES} onValueChange={setAgency}>
                <SelectTrigger className="w-48" aria-label="Agentur">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_AGENCIES}>Alle Agenturen</SelectItem>
                  {(agencies.data ?? []).map((entry) => (
                    <SelectItem key={entry.agency} value={entry.agency}>
                      {entry.agency} ({entry.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {agencyKnown && agencyFilter !== undefined ? (
              <Button
                variant="outline"
                onClick={() => void handleDeleteAgency(agencyFilter)}
                disabled={deleteAgencyMutation.isPending}
              >
                <Trash2 className="h-4 w-4" /> Agentur entfernen
              </Button>
            ) : (
              (agencies.data ?? []).length === 1 && (
                <Button
                  variant="outline"
                  onClick={() => void handleDeleteAgency(agencies.data![0].agency)}
                  disabled={deleteAgencyMutation.isPending}
                >
                  <Trash2 className="h-4 w-4" /> Alle entfernen
                </Button>
              )
            )}
            <Button onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" /> Importieren
            </Button>
          </div>
        }
      />
      <AgencyImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </section>
  )
}
