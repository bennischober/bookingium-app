import { useState } from 'react'
import { trpcReact } from '@/main'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { BankForm } from '@/components/forms/BankForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { BankDto } from '../../../main/api/schemas/bank.schema'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'

export default function BankPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')

  const formSheet = useFormSheet<BankDto>()

  const banks = trpcReact.bank.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search
  })

  const utils = trpcReact.useUtils()

  // Mutations
  const createMutation = trpcReact.bank.create.useMutation({
    onSuccess: () => {
      utils.bank.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Bank angelegt', { description: 'Die Bank wurde erfolgreich angelegt.' })
    },
    onError: (error) => {
      toast.error('Bank konnte nicht angelegt werden', { description: error.message })
    }
  })

  const updateMutation = trpcReact.bank.update.useMutation({
    onSuccess: () => {
      utils.bank.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Bank aktualisiert', { description: 'Die Bank wurde erfolgreich aktualisiert.' })
    },
    onError: (error) => {
      toast.error('Bank konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  const deleteMutation = trpcReact.bank.delete.useMutation({
    onSuccess: () => {
      utils.bank.getAllPaginated.invalidate()
      toast.success('Bank gelöscht', { description: 'Die Bank wurde erfolgreich gelöscht.' })
    },
    onError: (error) => {
      toast.error('Bank konnte nicht gelöscht werden', { description: error.message })
    }
  })

  // Handlers
  const handleCreate = (data: any) => {
    createMutation.mutate(data)
  }

  const handleUpdate = (data: any) => {
    updateMutation.mutate(data)
  }

  const handleDelete = (bank: BankDto) => {
    if (confirm(`Sind Sie sicher, dass Sie ${bank.bankName} löschen möchten?`)) {
      deleteMutation.mutate({ id: bank.id })
    }
  }

  // Table columns
  const columns: ColumnDef<BankDto>[] = [
    {
      accessorKey: 'bankName',
      header: 'Bankname'
    },
    {
      accessorKey: 'accountHolder',
      header: 'Kontoinhaber'
    },
    {
      accessorKey: 'iban',
      header: 'IBAN'
    },
    {
      accessorKey: 'bic',
      header: 'BIC/SWIFT'
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
        <h1 className="text-2xl font-bold mb-2">Bankkontoinformationen</h1>
        <p className="text-sm text-muted-foreground">Bankkontodaten von Kundschaft verwalten.</p>
      </div>

      <DataTable
        columns={columns}
        data={banks.data?.items || []}
        pageCount={banks.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPagination((prev) => ({ ...prev, pageIndex: 0 }))
        }}
        searchPlaceholder="Banken filtern..."
        isLoading={banks.isLoading}
        total={banks.data?.total ?? 0}
        actionButton={<Button onClick={() => formSheet.openCreate()}>+ Neue Bank anlegen</Button>}
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Bank anlegen' : 'Bank bearbeiten'}
        description={
          formSheet.mode === 'create'
            ? 'Eine neue Bank im System anlegen.'
            : 'Bankinformationen aktualisieren.'
        }
      >
        <BankForm
          bank={formSheet.selectedItem || undefined}
          onSubmit={formSheet.mode === 'create' ? handleCreate : handleUpdate}
          onCancel={formSheet.close}
        />
      </FormSheet>
    </div>
  )
}
