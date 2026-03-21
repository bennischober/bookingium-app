import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/main'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { VenueForm } from '@/components/forms/VenueForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { VenueDto } from '../../../main/api/schemas/venue.schema'

export default function VenuePage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')

  const formSheet = useFormSheet<VenueDto>()
  const utils = trpcReact.useUtils()

  const venues = trpcReact.venue.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

  const createMutation = trpcReact.venue.create.useMutation({
    onSuccess: (venue) => {
      utils.venue.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Venue created', { description: `${venue.name} was created successfully.` })
    },
    onError: (error) => {
      toast.error('Failed to create venue', { description: error.message })
    }
  })

  const updateMutation = trpcReact.venue.update.useMutation({
    onSuccess: (venue) => {
      utils.venue.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Venue updated', { description: `${venue.name} was updated successfully.` })
    },
    onError: (error) => {
      toast.error('Failed to update venue', { description: error.message })
    }
  })

  const deleteMutation = trpcReact.venue.delete.useMutation({
    onSuccess: () => {
      utils.venue.getAllPaginated.invalidate()
      toast.success('Venue deleted', { description: 'The venue was deleted successfully.' })
    },
    onError: (error) => {
      toast.error('Failed to delete venue', { description: error.message })
    }
  })

  const handleDelete = (venue: VenueDto) => {
    if (confirm(`Are you sure you want to delete ${venue.name}?`)) {
      deleteMutation.mutate({ id: venue.id })
    }
  }

  const columns: ColumnDef<VenueDto>[] = [
    {
      accessorKey: 'name',
      header: 'Venue Name',
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>
    },
    {
      accessorKey: 'company',
      header: 'Company',
      cell: ({ row }) => row.original.company?.name || '-'
    },
    {
      accessorKey: 'address',
      header: 'City',
      cell: ({ row }) => row.original.address?.city || '-'
    },
    {
      accessorKey: 'capacity',
      header: 'Capacity',
      cell: ({ row }) =>
        row.original.capacity ? row.original.capacity.toLocaleString('de-DE') : '-'
    },
    {
      accessorKey: 'notes',
      header: 'Notes',
      cell: ({ row }) => {
        const value = row.original.notes
        return value ? (value.length > 60 ? `${value.slice(0, 60)}...` : value) : '-'
      }
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => formSheet.openEdit(row.original)}
            title="Edit"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleDelete(row.original)}
            title="Delete"
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
        <h1 className="text-2xl font-bold mb-2">Venues</h1>
        <p className="text-sm text-muted-foreground">Manage all event venues and capacities.</p>
      </div>

      <DataTable
        columns={columns}
        data={venues.data?.items ?? []}
        pageCount={venues.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPagination((prev) => ({ ...prev, pageIndex: 0 }))
        }}
        searchPlaceholder="Filter venues..."
        isLoading={venues.isLoading}
        total={venues.data?.total ?? 0}
        actionButton={<Button onClick={() => formSheet.openCreate()}>+ Add New Venue</Button>}
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Create Venue' : 'Edit Venue'}
        description={
          formSheet.mode === 'create'
            ? 'Add a new venue to your directory.'
            : 'Update venue information.'
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
