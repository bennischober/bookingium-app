import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting,
  useListSearch
} from '@/hooks/useListQuery'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2, Users } from 'lucide-react'
import { MembersSheet } from '@/components/MembersSheet'
import { ImportButton } from '@/components/import/ImportButton'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { FormSheet } from '@/components/form-sheet'
import { VenueForm } from '@/components/forms/VenueForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { VenueKind, VenueDto } from '../../../main/api/schemas/venue.schema'
import { VENUE_KIND_TERMS, venueDetailPath } from '@/components/venue/constants'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { ListPageHeader, ListToolbar } from '@/components/ListPageHeader'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { formatCapacity } from '../../../main/api/schemas/capacity'
import { t } from '../../../main/i18n/translate'

/** The Clubs list or the Festivals list: the same venue table, one kind each */
export default function VenuePage({ kind }: { kind: VenueKind }) {
  const copy = VENUE_KIND_TERMS[kind]
  const { sorting, setSorting, sortInput } = useListSorting('venues', { id: 'name', desc: false })
  const [search, setSearch] = useListSearch(`venues-${kind}`)
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

  const mutations = useRecordMutations({
    procedures: trpcReact.venue,
    utils: utils.venue,
    noun: copy.singular,
    label: (venue: VenueDto) => venue.name,
    deleteInput: (venue) => ({ id: venue.id }),
    onSaved: formSheet.close
  })

  const columns: ColumnDef<VenueDto>[] = [
    {
      accessorKey: 'name',
      header: t('Name'),
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>
    },
    {
      accessorKey: 'company',
      header: t('Firma'),
      cell: ({ row }) => row.original.company?.name || '-'
    },
    {
      accessorKey: 'address',
      header: t('Stadt'),
      cell: ({ row }) => row.original.address?.city || '-'
    },
    {
      accessorKey: 'capacity',
      header: t('Kapazität'),
      cell: ({ row }) =>
        row.original.capacity
          ? formatCapacity(row.original.capacityMin, row.original.capacity)
          : '-'
    },
    {
      accessorKey: 'notes',
      header: t('Anmerkungen'),
      cell: ({ row }) => {
        const value = row.original.notes
        return value ? (value.length > 60 ? `${value.slice(0, 60)}...` : value) : '-'
      }
    },
    {
      id: 'actions',
      header: t('Aktionen'),
      cell: ({ row }) => (
        <RowActions>
          <RowActionButton
            icon={Users}
            label={t('Ansprechpartner')}
            onClick={() =>
              setMembersEntity({ type: 'venue', id: row.original.id, name: row.original.name })
            }
          />
          <RowActionButton
            icon={Pencil}
            label={t('Bearbeiten')}
            onClick={() => formSheet.openEdit(row.original)}
          />
          <RowActionButton
            icon={Trash2}
            label={t('Löschen')}
            destructive
            onClick={() => void mutations.remove(row.original)}
          />
        </RowActions>
      )
    }
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <ListPageHeader
        title={copy.plural}
        description={
          kind === 'festival'
            ? t('Alle Festivals und ihre Kapazitäten verwalten.')
            : t('Alle Clubs, Hallen und ihre Kapazitäten verwalten.')
        }
      />

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
        searchPlaceholder={t('{{plural}} filtern…', { plural: copy.plural })}
        // A click opens the venue page; the pencil keeps the quick-edit sheet
        onRowClick={(venue) =>
          navigate({ to: venueDetailPath(kind), params: { venueId: String(venue.id) } })
        }
        isLoading={venues.isLoading}
        error={venues.error}
        onRetry={() => void venues.refetch()}
        total={listTotal(venues.data)}
        actionButton={
          <ListToolbar createLabel={`+ ${copy.Neuer}`} onCreate={formSheet.openCreate}>
            <ExportButton list="venues" sort={sortInput} search={search} kind={kind} />
            <ImportButton target="venues" kind={kind} />
          </ListToolbar>
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
            ? `${copy.Neuen} anlegen`
            : `${VENUE_KIND_TERMS[formSheet.selectedItem?.kind ?? kind].singular} bearbeiten`
        }
        description={
          formSheet.mode === 'create'
            ? t('{{Neuen}} im Verzeichnis anlegen.', { Neuen: copy.Neuen })
            : t('Angaben aktualisieren.')
        }
      >
        <VenueForm
          mode={formSheet.mode}
          initialData={formSheet.selectedItem}
          defaultKind={kind}
          onSubmit={mutations.submit}
          onCancel={formSheet.close}
          isSubmitting={mutations.isSubmitting}
        />
      </FormSheet>
    </div>
  )
}
