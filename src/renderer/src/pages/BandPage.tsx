import { useTablePagination } from '@/hooks/useTablePagination'
import { ImportButton } from '@/components/import/ImportButton'
import { trpcReact } from '@/lib/trpc'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { z } from 'zod'
import { type ColumnDef } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/data-table'
import { FormSheet } from '@/components/form-sheet'
import { BandForm } from '@/components/forms/BandForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { FileSignature, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Users } from 'lucide-react'
import { MembersSheet } from '@/components/MembersSheet'
import { ManagementContractSheet } from '@/components/band/ManagementContractSheet'
import type { CreateBandInput, UpdateBandInput } from '../../../main/api/schemas/band.schema'
import type { BandDto } from '../../../main/api/schemas/band.schema'
import { confirmAction } from '@/lib/confirm'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { RowActionButton, RowActions } from '@/components/row-action-button'

export default function BandPage() {
  const [pagination, setPagination] = useTablePagination('bands')
  const [search, setSearch] = useState('')
  const [membersEntity, setMembersEntity] = useState<{
    type: 'band'
    id: number
    name: string
  } | null>(null)
  const [contractBand, setContractBand] = useState<{ id: number; name: string } | null>(null)

  const sheet = useFormSheet<BandDto>()
  const navigate = useNavigate()

  const bands = trpcReact.band.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

  const utils = trpcReact.useUtils()

  // ?create=true / ?open=<id> from the search palette and the "+ Neu" menu
  useListSearchActions({
    onCreate: () => sheet.openCreate(),
    onOpen: (id) => void utils.band.getById.fetch(id).then((band) => band && sheet.openEdit(band))
  })

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

  const handleDelete = async (id: number, name: string) => {
    if (
      await confirmAction({
        title: `„${name}“ löschen?`,
        description: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        destructive: true
      })
    ) {
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
          <RowActions>
            <RowActionButton
              icon={Users}
              label="Mitglieder"
              onClick={() => setMembersEntity({ type: 'band', id: band.id, name: band.name })}
            />
            <RowActionButton
              icon={FileSignature}
              label="Managementvertrag"
              onClick={() => setContractBand({ id: band.id, name: band.name })}
            />
            <RowActionButton
              icon={Pencil}
              label="Bearbeiten"
              onClick={() => sheet.openEdit(band)}
            />
            <RowActionButton
              icon={Trash2}
              label="Löschen"
              destructive
              onClick={() => handleDelete(band.id, band.name)}
            />
          </RowActions>
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
        // A click opens the band page; the pencil keeps the quick-edit sheet
        onRowClick={(band) =>
          navigate({ to: '/band/$bandId', params: { bandId: String(band.id) } })
        }
        isLoading={bands.isLoading}
        total={bands.data?.total ?? 0}
        actionButton={
          <div className="flex flex-wrap items-center gap-2">
            <ImportButton target="bands" />
            <Button onClick={() => sheet.openCreate()}>+ Neue Band anlegen</Button>
          </div>
        }
      />

      <ManagementContractSheet band={contractBand} onClose={() => setContractBand(null)} />

      <MembersSheet
        entityType="band"
        entityId={membersEntity?.id ?? null}
        entityName={membersEntity?.name ?? ''}
        open={membersEntity !== null}
        onOpenChange={(open) => {
          if (!open) setMembersEntity(null)
        }}
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
