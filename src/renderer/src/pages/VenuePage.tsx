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
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2, Users } from 'lucide-react'
import { MembersSheet } from '@/components/MembersSheet'
import { ImportButton } from '@/components/import/ImportButton'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { VenueForm } from '@/components/forms/VenueForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { VENUE_KIND_LABELS, VenueKind, type VenueDto } from '../../../main/api/schemas/venue.schema'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { confirmAction } from '@/lib/confirm'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { RowActionButton, RowActions } from '@/components/row-action-button'

export default function VenuePage() {
  const { sorting, setSorting, sortInput } = useListSorting('venues', { id: 'name', desc: false })
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<VenueKind | 'all'>('all')
  const [membersEntity, setMembersEntity] = useState<{
    type: 'venue'
    id: number
    name: string
  } | null>(null)

  const formSheet = useFormSheet<VenueDto>()
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()

  // ?create=true / ?open=<id> from the search palette and the "+ Neu" menu
  useListSearchActions({
    onCreate: () => formSheet.openCreate(),
    onOpen: (id) =>
      void utils.venue.getById.fetch({ id }).then((venue) => venue && formSheet.openEdit(venue))
  })

  const venues = trpcReact.venue.getAllPaginated.useInfiniteQuery(
    {
      pageSize: LIST_CHUNK_SIZE,
      search: search || undefined,
      kind: kind === 'all' ? undefined : kind,
      ...sortInput
    },
    infiniteListOptions
  )

  const createMutation = trpcReact.venue.create.useMutation({
    onSuccess: (venue) => {
      utils.venue.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Spielstätte erstellt', {
        description: `${venue.name} wurde erfolgreich erstellt.`
      })
    },
    onError: (error) => {
      toast.error('Spielstätte konnte nicht erstellt werden', { description: error.message })
    }
  })

  const updateMutation = trpcReact.venue.update.useMutation({
    onSuccess: (venue) => {
      utils.venue.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Spielstätte aktualisiert', {
        description: `${venue.name} wurde erfolgreich aktualisiert.`
      })
    },
    onError: (error) => {
      toast.error('Spielstätte konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  const deleteMutation = trpcReact.venue.delete.useMutation({
    onSuccess: () => {
      utils.venue.getAllPaginated.invalidate()
      toast.success('Spielstätte gelöscht', {
        description: 'Die Spielstätte wurde erfolgreich gelöscht.'
      })
    },
    onError: (error) => {
      toast.error('Spielstätte konnte nicht gelöscht werden', { description: error.message })
    }
  })

  const handleDelete = async (venue: VenueDto) => {
    if (
      await confirmAction({
        title: `„${venue.name}“ löschen?`,
        description: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        destructive: true
      })
    ) {
      deleteMutation.mutate({ id: venue.id })
    }
  }

  const columns: ColumnDef<VenueDto>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>
    },
    {
      accessorKey: 'kind',
      header: 'Art',
      cell: ({ row }) =>
        row.original.kind === 'festival' ? (
          <Badge variant="secondary">{VENUE_KIND_LABELS.festival}</Badge>
        ) : (
          VENUE_KIND_LABELS.venue
        )
    },
    {
      accessorKey: 'company',
      header: 'Firma',
      cell: ({ row }) => row.original.company?.name || '-'
    },
    {
      accessorKey: 'address',
      header: 'Stadt',
      cell: ({ row }) => row.original.address?.city || '-'
    },
    {
      accessorKey: 'capacity',
      header: 'Kapazität',
      cell: ({ row }) =>
        row.original.capacity ? row.original.capacity.toLocaleString('de-DE') : '-'
    },
    {
      accessorKey: 'notes',
      header: 'Anmerkungen',
      cell: ({ row }) => {
        const value = row.original.notes
        return value ? (value.length > 60 ? `${value.slice(0, 60)}...` : value) : '-'
      }
    },
    {
      id: 'actions',
      header: 'Aktionen',
      cell: ({ row }) => (
        <RowActions>
          <RowActionButton
            icon={Users}
            label="Ansprechpartner"
            onClick={() =>
              setMembersEntity({ type: 'venue', id: row.original.id, name: row.original.name })
            }
          />
          <RowActionButton
            icon={Pencil}
            label="Bearbeiten"
            onClick={() => formSheet.openEdit(row.original)}
          />
          <RowActionButton
            icon={Trash2}
            label="Löschen"
            destructive
            onClick={() => handleDelete(row.original)}
          />
        </RowActions>
      )
    }
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Spielstätten</h1>
        <p className="text-sm text-muted-foreground">
          Verwalten Sie alle Event-Spielstätten und Kapazitäten.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={listRows(venues.data)}
        itemLabel={
          kind === 'festival'
            ? { singular: 'Festival', plural: 'Festivals' }
            : { singular: 'Spielstätte', plural: 'Spielstätten' }
        }
        hasMore={venues.hasNextPage ?? false}
        isLoadingMore={venues.isFetchingNextPage}
        onLoadMore={() => void venues.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search) || kind !== 'all'}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Spielstätten filtern..."
        // A click opens the venue page; the pencil keeps the quick-edit sheet
        onRowClick={(venue) =>
          navigate({ to: '/venues/$venueId', params: { venueId: String(venue.id) } })
        }
        isLoading={venues.isLoading}
        total={listTotal(venues.data)}
        actionButton={
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={kind}
              onValueChange={(value) => {
                setKind(value as VenueKind | 'all')
              }}
            >
              <SelectTrigger className="w-40" aria-label="Art filtern">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Arten</SelectItem>
                <SelectItem value="venue">Spielstätten</SelectItem>
                <SelectItem value="festival">Festivals</SelectItem>
              </SelectContent>
            </Select>
            <ExportButton
              list="venues"
              sort={sortInput}
              search={search}
              kind={kind === 'all' ? undefined : kind}
            />
            <ImportButton target="venues" />
            <Button onClick={() => formSheet.openCreate()}>+ Neue Spielstätte anlegen</Button>
          </div>
        }
      />

      <MembersSheet
        entityType="venue"
        entityId={membersEntity?.id ?? null}
        entityName={membersEntity?.name ?? ''}
        open={membersEntity !== null}
        onOpenChange={(open) => {
          if (!open) setMembersEntity(null)
        }}
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Spielstätte anlegen' : 'Spielstätte bearbeiten'}
        description={
          formSheet.mode === 'create'
            ? 'Fügen Sie eine neue Spielstätte zu Ihrem Verzeichnis hinzu.'
            : 'Spielstätteninformationen aktualisieren.'
        }
      >
        <VenueForm
          mode={formSheet.mode}
          initialData={formSheet.selectedItem}
          onSubmit={(data) => {
            if ('id' in data) {
              updateMutation.mutate(data)
            } else {
              createMutation.mutate(data)
            }
          }}
          onCancel={formSheet.close}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
        />
      </FormSheet>
    </div>
  )
}
