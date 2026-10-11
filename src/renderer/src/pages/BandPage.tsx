import { trpcReact } from '@/lib/trpc'
import { useState } from 'react'
import type { z } from 'zod'
import { type ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table'
import { FormSheet } from '@/components/form-sheet'
import { BandForm } from '@/components/forms/BandForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { CreateBandInput, UpdateBandInput } from '../../../main/api/schemas/band.schema'
import type { BandDto } from '../../../main/api/schemas/band.schema'

export default function BandPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')

  const sheet = useFormSheet<BandDto>()

  const bands = trpcReact.band.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

  const utils = trpcReact.useUtils()

  const createBand = trpcReact.band.create.useMutation({
    onSuccess: (data) => {
      utils.band.getAllPaginated.invalidate()
      sheet.close()
      toast.success('Band erfolgreich erstellt', {
        description: `${data.name} wurde zu Ihren Bands hinzugefügt.`
      })
    },
    onError: (error) => {
      toast.error('Band konnte nicht erstellt werden', {
        description: error.message
      })
    }
  })

  const updateBand = trpcReact.band.update.useMutation({
    onSuccess: (data) => {
      utils.band.getAllPaginated.invalidate()
      sheet.close()
      toast.success('Band erfolgreich aktualisiert', {
        description: `${data.name} wurde aktualisiert.`
      })
    },
    onError: (error) => {
      toast.error('Band konnte nicht aktualisiert werden', {
        description: error.message
      })
    }
  })

  const deleteBand = trpcReact.band.delete.useMutation({
    onSuccess: (data) => {
      utils.band.getAllPaginated.invalidate()
      toast.success('Band gelöscht', {
        description: `${data.name} wurde entfernt.`
      })
    },
    onError: (error) => {
      toast.error('Band konnte nicht gelöscht werden', {
        description: error.message
      })
    }
  })

  const handleDelete = (id: number, name: string) => {
    if (confirm(`Sind Sie sicher, dass Sie "${name}" löschen möchten?`)) {
      deleteBand.mutate(id)
    }
  }

  const handleFormSubmit = (data: CreateBandInput | UpdateBandInput) => {
    if (sheet.mode === 'edit') {
      updateBand.mutate(data as z.infer<typeof UpdateBandInput>)
    } else {
      createBand.mutate(data as z.infer<typeof CreateBandInput>)
    }
  }

  // Define table columns
  const columns: ColumnDef<BandDto>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>
    },
    {
      accessorKey: 'genre',
      header: 'Genre',
      cell: (info) => info.getValue()
    },
    {
      accessorKey: 'founded',
      header: 'Gründung',
      cell: (info) => info.getValue() || '-'
    },
    {
      accessorKey: 'notes',
      header: 'Anmerkungen',
      cell: (info) => {
        const value = info.getValue() as string
        return value ? (value.length > 50 ? value.substring(0, 50) + '...' : value) : '-'
      }
    },
    {
      id: 'actions',
      header: 'Aktionen',
      cell: ({ row }) => {
        const band = row.original

        return (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => sheet.openEdit(band)}
              className="h-8 px-2"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDelete(band.id, band.name)}
              className="h-8 px-2 text-destructive hover:text-destructive"
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
        <h1 className="text-2xl font-bold mb-2">Bands</h1>
        <p className="text-sm text-muted-foreground">Verwalten Sie Ihre Künstler und Kontakte.</p>
      </div>

      <DataTable
        columns={columns}
        data={bands.data?.items ?? []}
        pageCount={bands.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPagination((prev) => ({ ...prev, pageIndex: 0 }))
        }}
        searchPlaceholder="Bands filtern..."
        isLoading={bands.isLoading}
        total={bands.data?.total ?? 0}
        actionButton={<Button onClick={() => sheet.openCreate()}>+ Neue Band anlegen</Button>}
      />

      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode={sheet.mode}
        title={sheet.mode === 'create' ? 'Neue Band anlegen' : 'Band bearbeiten'}
        description={
          sheet.mode === 'create'
            ? 'Füllen Sie die Details aus, um eine neue Band anzulegen.'
            : 'Nehmen Sie Änderungen am Bandprofil unten vor.'
        }
      >
        <BandForm
          mode={sheet.mode}
          initialData={sheet.selectedItem}
          onSubmit={handleFormSubmit}
          onCancel={sheet.close}
          isSubmitting={createBand.isPending || updateBand.isPending}
        />
      </FormSheet>
    </div>
  )
}
