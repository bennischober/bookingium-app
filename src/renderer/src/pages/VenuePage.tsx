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
import type { VenueKind, VenueDto } from '../../../main/api/schemas/venue.schema'
import { VENUE_KIND_COPY, venueDetailPath } from '@/components/venue/constants'
import { confirmAction } from '@/lib/confirm'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { RowActionButton, RowActions } from '@/components/row-action-button'

/** The Clubs list or the Festivals list: the same venue table, one kind each */
export default function VenuePage({ kind }: { kind: VenueKind }) {
  const copy = VENUE_KIND_COPY[kind]
  const { sorting, setSorting, sortInput } = useListSorting('venues', { id: 'name', desc: false })
  const [search, setSearch] = useState('')
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
      kind,
      ...sortInput
    },
    infiniteListOptions
  )

  const createMutation = trpcReact.venue.create.useMutation({
    onSuccess: (venue) => {
      utils.venue.getAllPaginated.invalidate()
      formSheet.close()
      toast.success(`${copy.singular} erstellt`, {
        description: `${venue.name} wurde erfolgreich erstellt.`
      })
    },
    onError: (error) => {
      toast.error(`${copy.singular} konnte nicht erstellt werden`, { description: error.message })
    }
  })

  const updateMutation = trpcReact.venue.update.useMutation({
    onSuccess: (venue) => {
      utils.venue.getAllPaginated.invalidate()
      formSheet.close()
      toast.success(`${copy.singular} aktualisiert`, {
        description: `${venue.name} wurde erfolgreich aktualisiert.`
      })
    },
    onError: (error) => {
      toast.error(`${copy.singular} konnte nicht aktualisiert werden`, {
        description: error.message
      })
    }
  })

  const deleteMutation = trpcReact.venue.delete.useMutation({
    onSuccess: () => {
      utils.venue.getAllPaginated.invalidate()
      toast.success(`${copy.singular} gelöscht`, {
        description: `${copy.article} wurde erfolgreich gelöscht.`
      })
    },
    onError: (error) => {
      toast.error(`${copy.singular} konnte nicht gelöscht werden`, { description: error.message })
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
        <h1 className="text-2xl font-bold mb-2">{copy.plural}</h1>
        <p className="text-sm text-muted-foreground">
          {kind === 'festival'
            ? 'Verwalten Sie alle Festivals und ihre Kapazitäten.'
            : 'Verwalten Sie alle Clubs, Hallen und ihre Kapazitäten.'}
        </p>
      </div>

      <DataTable
        columns={columns}
        data={listRows(venues.data)}
        itemLabel={{ singular: copy.singular, plural: copy.plural }}
        hasMore={venues.hasNextPage ?? false}
        isLoadingMore={venues.isFetchingNextPage}
        onLoadMore={() => void venues.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={`${copy.plural} filtern…`}
        // A click opens the venue page; the pencil keeps the quick-edit sheet
        onRowClick={(venue) =>
          navigate({ to: venueDetailPath(kind), params: { venueId: String(venue.id) } })
        }
        isLoading={venues.isLoading}
        error={venues.error}
        onRetry={() => void venues.refetch()}
        total={listTotal(venues.data)}
        actionButton={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton list="venues" sort={sortInput} search={search} kind={kind} />
            <ImportButton target="venues" kind={kind} />
            <Button onClick={() => formSheet.openCreate()}>+ {copy.newOne} anlegen</Button>
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
        title={
          formSheet.mode === 'create'
            ? `${copy.singular} anlegen`
            : `${VENUE_KIND_COPY[formSheet.selectedItem?.kind ?? kind].singular} bearbeiten`
        }
        description={
          formSheet.mode === 'create'
            ? `${copy.newOne} im Verzeichnis anlegen.`
            : 'Angaben aktualisieren.'
        }
      >
        <VenueForm
          mode={formSheet.mode}
          initialData={formSheet.selectedItem}
          defaultKind={kind}
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
