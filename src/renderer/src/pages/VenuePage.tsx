import { useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2, Users } from 'lucide-react'
import { MembersSheet } from '@/components/MembersSheet'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { VenueForm } from '@/components/forms/VenueForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { VenueDto } from '../../../main/api/schemas/venue.schema'

export default function VenuePage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')
  const [membersEntity, setMembersEntity] = useState<{
    type: 'venue'
    id: number
    name: string
  } | null>(null)

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

  const handleDelete = (venue: VenueDto) => {
    if (confirm(`Sind Sie sicher, dass Sie ${venue.name} löschen möchten?`)) {
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
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              setMembersEntity({ type: 'venue', id: row.original.id, name: row.original.name })
            }
            title="Ansprechpartner"
          >
            <Users className="h-4 w-4" />
          </Button>
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
        <h1 className="text-2xl font-bold mb-2">Spielstätten</h1>
        <p className="text-sm text-muted-foreground">
          Verwalten Sie alle Event-Spielstätten und Kapazitäten.
        </p>
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
        searchPlaceholder="Spielstätten filtern..."
        isLoading={venues.isLoading}
        total={venues.data?.total ?? 0}
        actionButton={
          <Button onClick={() => formSheet.openCreate()}>+ Neue Spielstätte anlegen</Button>
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
