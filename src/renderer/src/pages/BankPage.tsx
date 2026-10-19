import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting
} from '@/hooks/useListQuery'
import { useState } from 'react'
import type { z } from 'zod'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { BankForm } from '@/components/forms/BankForm'
import type {
  BankDto,
  CreateBankInput,
  UpdateBankInput
} from '../../../main/api/schemas/bank.schema'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'
import { confirmAction } from '@/lib/confirm'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { RowActionButton, RowActions } from '@/components/row-action-button'

export default function BankPage() {
  const { sorting, setSorting, sortInput } = useListSorting('banks', {
    id: 'bankName',
    desc: false
  })
  const [search, setSearch] = useState('')

  const formSheet = useFormSheet<BankDto>()

  const banks = trpcReact.bank.getAllPaginated.useInfiniteQuery(
    {
      pageSize: LIST_CHUNK_SIZE,
      search: search || undefined,
      ...sortInput
    },
    infiniteListOptions
  )

  const utils = trpcReact.useUtils()

  // ?create=true / ?open=<id> from the search palette and the "+ Neu" menu
  useListSearchActions({
    onCreate: () => formSheet.openCreate(),
    onOpen: (id) =>
      void utils.bank.getById.fetch({ id }).then((bank) => bank && formSheet.openEdit(bank))
  })

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
      toast.success('Bank aktualisiert', {
        description: 'Die Bank wurde erfolgreich aktualisiert.'
      })
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
  const handleCreate = (data: z.infer<typeof CreateBankInput>) => {
    createMutation.mutate(data)
  }

  const handleUpdate = (data: z.infer<typeof CreateBankInput> & { id?: number }) => {
    updateMutation.mutate(data as z.infer<typeof UpdateBankInput>)
  }

  const handleDelete = async (bank: BankDto) => {
    if (
      await confirmAction({
        title: `„${bank.bankName}“ löschen?`,
        description: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        destructive: true
      })
    ) {
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
        <h1 className="text-2xl font-bold mb-2">Bankkontoinformationen</h1>
        <p className="text-sm text-muted-foreground">Bankkontodaten von Kundschaft verwalten.</p>
      </div>

      <DataTable
        columns={columns}
        data={listRows(banks.data)}
        itemLabel={{ singular: 'Bank', plural: 'Banken' }}
        hasMore={banks.hasNextPage ?? false}
        isLoadingMore={banks.isFetchingNextPage}
        onLoadMore={() => void banks.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Banken filtern..."
        isLoading={banks.isLoading}
        total={listTotal(banks.data)}
        actionButton={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton list="banks" sort={sortInput} search={search} />
            <Button onClick={() => formSheet.openCreate()}>+ Neue Bank anlegen</Button>
          </div>
        }
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
