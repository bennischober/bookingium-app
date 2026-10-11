import { useState } from 'react'
import { trpcReact } from '@/main'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { CompanyForm } from '@/components/forms/CompanyForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { CompanyDto } from '../../../main/api/schemas/company.schema'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'

export function CompanyPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')

  const formSheet = useFormSheet<CompanyDto>()
  const utils = trpcReact.useUtils()

  // Queries
  const companies = trpcReact.company.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

  // Mutations
  const createMutation = trpcReact.company.create.useMutation({
    onSuccess: () => {
      utils.company.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Firma angelegt', { description: 'Die Firma wurde erfolgreich angelegt.' })
    },
    onError: (error) => {
      toast.error('Firma konnte nicht angelegt werden', { description: error.message })
    }
  })

  const updateMutation = trpcReact.company.update.useMutation({
    onSuccess: () => {
      utils.company.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Firma aktualisiert', {
        description: 'Die Firma wurde erfolgreich aktualisiert.'
      })
    },
    onError: (error) => {
      toast.error('Firma konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  const deleteMutation = trpcReact.company.delete.useMutation({
    onSuccess: () => {
      utils.company.getAllPaginated.invalidate()
      toast.success('Firma gelöscht', { description: 'Die Firma wurde erfolgreich gelöscht.' })
    },
    onError: (error) => {
      toast.error('Firma konnte nicht gelöscht werden', { description: error.message })
    }
  })

  // Handlers
  const handleCreate = (data: any) => {
    const { logoSourcePath, ...companyData } = data
    createMutation.mutate(companyData, {
      onSuccess: async (created) => {
        // Upload the picked logo now that the company id exists
        if (logoSourcePath && /^[a-zA-Z]:[\\/]/.test(logoSourcePath)) {
          const fileName = logoSourcePath.split(/[\\/]/).pop() || 'logo'
          const upload = await window.api.uploadLogo(created.id, logoSourcePath, fileName)
          if (upload.success && upload.relativePath) {
            updateMutation.mutate({ id: created.id, logoPath: upload.relativePath })
          }
        }
      }
    })
  }

  const handleUpdate = (data: any) => {
    updateMutation.mutate(data)
  }

  const handleDelete = (company: CompanyDto) => {
    if (confirm(`Sind Sie sicher, dass Sie ${company.name} löschen möchten?`)) {
      deleteMutation.mutate({ id: company.id })
    }
  }

  // Table columns
  const columns: ColumnDef<CompanyDto>[] = [
    {
      accessorKey: 'name',
      header: 'Firmenname'
    },
    {
      accessorKey: 'vatNumber',
      header: 'USt-IdNr.'
    },
    {
      accessorKey: 'contact',
      header: 'E-Mail',
      cell: ({ row }) => row.original.contact?.email || '-'
    },
    {
      accessorKey: 'address',
      header: 'Stadt',
      cell: ({ row }) => row.original.address?.city || '-'
    },
    {
      accessorKey: 'bank',
      header: 'Bank',
      cell: ({ row }) => row.original.bank?.bankName || '-'
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
        <h1 className="text-2xl font-bold mb-2">Firmen</h1>
        <p className="text-sm text-muted-foreground">
          Verwalten Sie die Firmen Ihrer Geschäftspartner.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={companies.data?.items ?? []}
        pageCount={companies.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPagination((prev) => ({ ...prev, pageIndex: 0 }))
        }}
        searchPlaceholder="Firmen filtern..."
        isLoading={companies.isLoading}
        total={companies.data?.total ?? 0}
        actionButton={<Button onClick={() => formSheet.openCreate()}>+ Neue Firma anlegen</Button>}
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Firma anlegen' : 'Firma bearbeiten'}
        description={
          formSheet.mode === 'create'
            ? 'Eine neue Firma im System anlegen.'
            : 'Firmeninformationen aktualisieren.'
        }
      >
        <CompanyForm
          company={formSheet.selectedItem || undefined}
          onSubmit={formSheet.mode === 'create' ? handleCreate : handleUpdate}
          onCancel={formSheet.close}
        />
      </FormSheet>
    </div>
  )
}

export default CompanyPage
