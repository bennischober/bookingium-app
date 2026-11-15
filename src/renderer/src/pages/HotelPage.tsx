import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting,
  useListSearch
} from '@/hooks/useListQuery'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { FormSheet } from '@/components/form-sheet'
import { HotelForm } from '@/components/forms/HotelForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { HotelDto } from '../../../main/api/schemas/hotel.schema'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { ListPageHeader, ListToolbar } from '@/components/ListPageHeader'
import { RowActionButton, RowActions } from '@/components/row-action-button'

export default function HotelPage() {
  const { sorting, setSorting, sortInput } = useListSorting('hotels', { id: 'name', desc: false })
  const [search, setSearch] = useListSearch('hotels')

  const formSheet = useFormSheet<HotelDto>()
  const utils = trpcReact.useUtils()

  // ?create=true / ?open=<id> from the search palette and the "+ Neu" menu
  useListSearchActions({
    onCreate: () => formSheet.openCreate(),
    onOpen: (id) =>
      void utils.hotel.getById.fetch(id).then((hotel) => hotel && formSheet.openEdit(hotel))
  })

  const hotels = trpcReact.hotel.getAllPaginated.useInfiniteQuery(
    {
      pageSize: LIST_CHUNK_SIZE,
      search: search || undefined,
      ...sortInput
    },
    infiniteListOptions
  )

  const mutations = useRecordMutations({
    procedures: trpcReact.hotel,
    utils: utils.hotel,
    noun: 'Hotel',
    label: (hotel: HotelDto) => hotel.name,
    deleteInput: (hotel) => hotel.id,
    onSaved: formSheet.close
  })

  const columns: ColumnDef<HotelDto>[] = [
    {
      accessorKey: 'name',
      header: 'Hotelname',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>
    },
    {
      accessorKey: 'address',
      header: 'Stadt',
      cell: ({ row }) => row.original.address?.city || '-'
    },
    {
      accessorKey: 'contact',
      header: 'E-Mail',
      cell: ({ row }) => row.original.contact?.email || '-'
    },
    {
      accessorKey: 'notes',
      header: 'Anmerkungen',
      cell: ({ row }) => {
        const value = row.original.notes
        return value ? (value.length > 90 ? `${value.slice(0, 90)}...` : value) : '-'
      }
    },
    {
      id: 'actions',
      header: 'Aktionen',
      cell: ({ row }) => (
        <RowActions>
          <RowActionButton
            icon={Pencil}
            label="Bearbeiten"
            onClick={() => formSheet.openEdit(row.original)}
          />
          <RowActionButton
            icon={Trash2}
            label="Löschen"
            destructive
            onClick={() => void mutations.remove(row.original)}
          />
        </RowActions>
      )
    }
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <ListPageHeader title="Hotels" description="Unterkünfte für Tours und Events verwalten." />

      <DataTable
        columns={columns}
        data={listRows(hotels.data)}
        itemLabel={{ singular: 'Hotel', plural: 'Hotels' }}
        hasMore={hotels.hasNextPage ?? false}
        isLoadingMore={hotels.isFetchingNextPage}
        onLoadMore={() => void hotels.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Hotels filtern…"
        isLoading={hotels.isLoading}
        error={hotels.error}
        onRetry={() => void hotels.refetch()}
        total={listTotal(hotels.data)}
        actionButton={
          <ListToolbar createLabel="+ Neues Hotel" onCreate={formSheet.openCreate}>
            <ExportButton list="hotels" sort={sortInput} search={search} />
          </ListToolbar>
        }
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Neues Hotel anlegen' : 'Hotel bearbeiten'}
        description={
          formSheet.mode === 'create'
            ? 'Ein neues Hotel im Verzeichnis anlegen.'
            : 'Hotelinformationen aktualisieren.'
        }
      >
        <HotelForm
          mode={formSheet.mode}
          initialData={formSheet.selectedItem}
          onSubmit={mutations.submit}
          onCancel={formSheet.close}
          isSubmitting={mutations.isSubmitting}
        />
      </FormSheet>
    </div>
  )
}
