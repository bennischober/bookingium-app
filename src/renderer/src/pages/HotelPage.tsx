import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting
} from '@/hooks/useListQuery'
import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { HotelForm } from '@/components/forms/HotelForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { HotelDto } from '../../../main/api/schemas/hotel.schema'
import { confirmAction } from '@/lib/confirm'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { RowActionButton, RowActions } from '@/components/row-action-button'

export default function HotelPage() {
  const { sorting, setSorting, sortInput } = useListSorting('hotels', { id: 'name', desc: false })
  const [search, setSearch] = useState('')

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

  const createMutation = trpcReact.hotel.create.useMutation({
    onSuccess: (hotel) => {
      utils.hotel.getAllPaginated.invalidate()
      utils.hotel.getListItems.invalidate()
      formSheet.close()
      toast.success('Hotel angelegt', { description: `${hotel.name} wurde erfolgreich angelegt.` })
    },
    onError: (error) => {
      toast.error('Hotel konnte nicht angelegt werden', { description: error.message })
    }
  })

  const updateMutation = trpcReact.hotel.update.useMutation({
    onSuccess: (hotel) => {
      utils.hotel.getAllPaginated.invalidate()
      utils.hotel.getListItems.invalidate()
      formSheet.close()
      toast.success('Hotel aktualisiert', {
        description: `${hotel.name} wurde erfolgreich aktualisiert.`
      })
    },
    onError: (error) => {
      toast.error('Hotel konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  const deleteMutation = trpcReact.hotel.delete.useMutation({
    onSuccess: () => {
      utils.hotel.getAllPaginated.invalidate()
      utils.hotel.getListItems.invalidate()
    },
    onError: (error) => {
      toast.error('Hotel konnte nicht gelöscht werden', { description: error.message })
    }
  })

  const handleDelete = async (hotel: HotelDto) => {
    if (
      await confirmAction({
        title: `„${hotel.name}“ löschen?`,
        description: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        destructive: true
      })
    ) {
      deleteMutation.mutate(hotel.id, {
        onSuccess: () => {
          toast.success('Hotel gelöscht', {
            description: `${hotel.name} wurde erfolgreich gelöscht.`
          })
        }
      })
    }
  }

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
            onClick={() => handleDelete(row.original)}
          />
        </RowActions>
      )
    }
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Hotels</h1>
        <p className="text-sm text-muted-foreground">Unterkünfte für Tours und Events verwalten.</p>
      </div>

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
        total={listTotal(hotels.data)}
        actionButton={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton list="hotels" sort={sortInput} search={search} />
            <Button onClick={() => formSheet.openCreate()}>+ Neues Hotel anlegen</Button>
          </div>
        }
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Hotel anlegen' : 'Hotel bearbeiten'}
        description={
          formSheet.mode === 'create'
            ? 'Ein neues Hotel im Verzeichnis anlegen.'
            : 'Hotelinformationen aktualisieren.'
        }
      >
        <HotelForm
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
