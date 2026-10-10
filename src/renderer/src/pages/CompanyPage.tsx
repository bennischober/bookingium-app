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
      toast.success('Company created', { description: 'The company was created successfully.' })
    },
    onError: (error) => {
      toast.error('Failed to create company', { description: error.message })
    }
  })

  const updateMutation = trpcReact.company.update.useMutation({
    onSuccess: () => {
      utils.company.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Company updated', { description: 'The company was updated successfully.' })
    },
    onError: (error) => {
      toast.error('Failed to update company', { description: error.message })
    }
  })

  const deleteMutation = trpcReact.company.delete.useMutation({
    onSuccess: () => {
      utils.company.getAllPaginated.invalidate()
      toast.success('Company deleted', { description: 'The company was deleted successfully.' })
    },
    onError: (error) => {
      toast.error('Failed to delete company', { description: error.message })
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
    if (confirm(`Are you sure you want to delete ${company.name}?`)) {
      deleteMutation.mutate({ id: company.id })
    }
  }

  // Table columns
  const columns: ColumnDef<CompanyDto>[] = [
    {
      accessorKey: 'name',
      header: 'Company Name'
    },
    {
      accessorKey: 'vatNumber',
      header: 'VAT Number'
    },
    {
      accessorKey: 'contact',
      header: 'Email',
      cell: ({ row }) => row.original.contact?.email || '-'
    },
    {
      accessorKey: 'address',
      header: 'City',
      cell: ({ row }) => row.original.address?.city || '-'
    },
    {
      accessorKey: 'bank',
      header: 'Bank',
      cell: ({ row }) => row.original.bank?.bankName || '-'
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
        <h1 className="text-2xl font-bold mb-2">Companies</h1>
        <p className="text-sm text-muted-foreground">Manage the companies of your business partners.</p>
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
        searchPlaceholder="Filter companies..."
        isLoading={companies.isLoading}
        total={companies.data?.total ?? 0}
        actionButton={
          <Button onClick={() => formSheet.openCreate()}>
            + Add New Company
          </Button>
        }
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Create Company' : 'Edit Company'}
        description={
          formSheet.mode === 'create'
            ? 'Add a new company to the system.'
            : 'Update the company information.'
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
