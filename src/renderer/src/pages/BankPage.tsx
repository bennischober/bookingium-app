import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting
} from '@/hooks/useListQuery'
import { useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { FormSheet } from '@/components/form-sheet'
import { BankForm } from '@/components/forms/BankForm'
import type { BankDto } from '../../../main/api/schemas/bank.schema'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { ListPageHeader, ListToolbar } from '@/components/ListPageHeader'
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

  const mutations = useRecordMutations({
    procedures: trpcReact.bank,
    utils: utils.bank,
    noun: 'Bank',
    label: (bank: BankDto) => bank.bankName,
    deleteInput: (bank) => ({ id: bank.id }),
    onSaved: formSheet.close
  })

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
            onClick={() => void mutations.remove(row.original)}
          />
        </RowActions>
      )
    }
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <ListPageHeader
        title="Bankkontoinformationen"
        description="Bankkontodaten von Kundschaft verwalten."
      />

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
        searchPlaceholder="Banken filtern…"
        isLoading={banks.isLoading}
        error={banks.error}
        onRetry={() => void banks.refetch()}
        total={listTotal(banks.data)}
        actionButton={
          <ListToolbar createLabel="+ Neue Bank" onCreate={formSheet.openCreate}>
            <ExportButton list="banks" sort={sortInput} search={search} />
          </ListToolbar>
        }
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Neue Bank anlegen' : 'Bank bearbeiten'}
        description={
          formSheet.mode === 'create'
            ? 'Eine neue Bank im System anlegen.'
            : 'Bankinformationen aktualisieren.'
        }
      >
        <BankForm
          bank={formSheet.selectedItem || undefined}
          onSubmit={mutations.submit}
          onCancel={formSheet.close}
        />
      </FormSheet>
    </div>
  )
}
