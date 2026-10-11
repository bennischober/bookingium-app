import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/main'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { HotelForm } from '@/components/forms/HotelForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { HotelDto } from '../../../main/api/schemas/hotel.schema'

export default function HotelPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')

  const formSheet = useFormSheet<HotelDto>()
  const utils = trpcReact.useUtils()

  const hotels = trpcReact.hotel.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

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
      toast.success('Hotel aktualisiert', { description: `${hotel.name} wurde erfolgreich aktualisiert.` })
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

  const handleDelete = (hotel: HotelDto) => {
    if (confirm(`Sind Sie sicher, dass Sie ${hotel.name} löschen möchten?`)) {
      deleteMutation.mutate(hotel.id, {
        onSuccess: () => {
          toast.success('Hotel gelöscht', { description: `${hotel.name} wurde erfolgreich gelöscht.` })
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
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => formSheet.openEdit(row.original)}
            title="Bearbeiten"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDelete(row.original)}
            title="Löschen"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )
    }
  ]

  return (
    <div className="flex flex-col w-full h-full p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Hotels</h1>
        <p className="text-sm text-muted-foreground">Unterkünfte für Tours und Events verwalten.</p>
      </div>

      <DataTable
        columns={columns}
        data={hotels.data?.items ?? []}
        pageCount={hotels.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPagination((prev) => ({ ...prev, pageIndex: 0 }))
        }}
        searchPlaceholder="Hotels filtern..."
        isLoading={hotels.isLoading}
        total={hotels.data?.total ?? 0}
        actionButton={<Button onClick={() => formSheet.openCreate()}>+ Neues Hotel anlegen</Button>}
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
