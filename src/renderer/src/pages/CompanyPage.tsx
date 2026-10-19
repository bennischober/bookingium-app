import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting
} from '@/hooks/useListQuery'
import { ImportButton } from '@/components/import/ImportButton'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { z } from 'zod'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { CompanyForm } from '@/components/forms/CompanyForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type {
  CompanyDto,
  CreateCompanyInput,
  UpdateCompanyInput
} from '../../../main/api/schemas/company.schema'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Pencil, Trash2, Users } from 'lucide-react'
import { MembersSheet } from '@/components/MembersSheet'
import { confirmAction } from '@/lib/confirm'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { RowActionButton, RowActions } from '@/components/row-action-button'

export function CompanyPage() {
  const { sorting, setSorting, sortInput } = useListSorting('companies', {
    id: 'name',
    desc: false
  })
  const [search, setSearch] = useState('')
  const [membersEntity, setMembersEntity] = useState<{
    type: 'company'
    id: number
    name: string
  } | null>(null)

  const formSheet = useFormSheet<CompanyDto>()
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()

  // ?create=true / ?open=<id> from the search palette and the "+ Neu" menu
  useListSearchActions({
    onCreate: () => formSheet.openCreate(),
    onOpen: (id) =>
      void utils.company.getById
        .fetch({ id })
        .then((company) => company && formSheet.openEdit(company))
  })

  // Queries
  const companies = trpcReact.company.getAllPaginated.useInfiniteQuery(
    {
      pageSize: LIST_CHUNK_SIZE,
      search: search || undefined,
      ...sortInput
    },
    infiniteListOptions
  )

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
  const handleCreate = (
    data: z.infer<typeof CreateCompanyInput> & {
      id?: number
      logoSourcePath?: string
      signatureSourcePath?: string
    }
  ) => {
    const { logoSourcePath, signatureSourcePath, ...companyData } = data
    createMutation.mutate(companyData, {
      onSuccess: async (created) => {
        // Upload the picked logo/signature now that the company id exists
        if (logoSourcePath && /^[a-zA-Z]:[\\/]/.test(logoSourcePath)) {
          const fileName = logoSourcePath.split(/[\\/]/).pop() || 'logo'
          const upload = await window.api.uploadLogo(created.id, logoSourcePath, fileName)
          if (upload.success && upload.relativePath) {
            updateMutation.mutate({ id: created.id, logoPath: upload.relativePath })
          }
        }
        if (signatureSourcePath && /^[a-zA-Z]:[\\/]/.test(signatureSourcePath)) {
          const fileName = signatureSourcePath.split(/[\\/]/).pop() || 'signature'
          const upload = await window.api.uploadLogo(created.id, signatureSourcePath, fileName)
          if (upload.success && upload.relativePath) {
            updateMutation.mutate({ id: created.id, signaturePath: upload.relativePath })
          }
        }
      }
    })
  }

  const handleUpdate = (
    data: z.infer<typeof CreateCompanyInput> & {
      id?: number
      logoSourcePath?: string
      signatureSourcePath?: string
    }
  ) => {
    updateMutation.mutate(data as z.infer<typeof UpdateCompanyInput>)
  }

  const handleDelete = async (company: CompanyDto) => {
    if (
      await confirmAction({
        title: `„${company.name}“ löschen?`,
        description: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        destructive: true
      })
    ) {
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
        <RowActions>
          <RowActionButton
            icon={Users}
            label="Mitarbeiter"
            onClick={() =>
              setMembersEntity({ type: 'company', id: row.original.id, name: row.original.name })
            }
          />
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
        <h1 className="text-2xl font-bold mb-2">Firmen</h1>
        <p className="text-sm text-muted-foreground">
          Verwalten Sie die Firmen Ihrer Geschäftspartner.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={listRows(companies.data)}
        itemLabel={{ singular: 'Firma', plural: 'Firmen' }}
        hasMore={companies.hasNextPage ?? false}
        isLoadingMore={companies.isFetchingNextPage}
        onLoadMore={() => void companies.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Firmen filtern..."
        // A click opens the company page; the pencil keeps the quick-edit sheet
        onRowClick={(company) =>
          navigate({ to: '/companies/$companyId', params: { companyId: String(company.id) } })
        }
        isLoading={companies.isLoading}
        total={listTotal(companies.data)}
        actionButton={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton list="companies" sort={sortInput} search={search} />
            <ImportButton target="companies" />
            <Button onClick={() => formSheet.openCreate()}>+ Neue Firma anlegen</Button>
          </div>
        }
      />

      <MembersSheet
        entityType="company"
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
