import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting,
  useListSearch
} from '@/hooks/useListQuery'
import { ImportButton } from '@/components/import/ImportButton'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { FormSheet } from '@/components/form-sheet'
import { CompanyForm } from '@/components/forms/CompanyForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { CompanyDto } from '../../../main/api/schemas/company.schema'
import type { ColumnDef } from '@tanstack/react-table'
import { FileText, Pencil, Trash2, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EInvoiceCompanyDialog } from '@/components/company/EInvoiceCompanyDialog'
import { MembersSheet } from '@/components/MembersSheet'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { ListPageHeader, ListToolbar } from '@/components/ListPageHeader'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { t } from '../../../main/i18n/translate'

export function CompanyPage() {
  const { sorting, setSorting, sortInput } = useListSorting('companies', {
    id: 'name',
    desc: false
  })
  const [search, setSearch] = useListSearch('companies')
  const [membersEntity, setMembersEntity] = useState<{
    type: 'company'
    id: number
    name: string
  } | null>(null)

  const [fromEInvoice, setFromEInvoice] = useState(false)

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

  const mutations = useRecordMutations({
    procedures: trpcReact.company,
    utils: utils.company,
    noun: t('Firma'),
    label: (company: CompanyDto) => company.name,
    deleteInput: (company) => ({ id: company.id }),
    onSaved: formSheet.close
  })

  // Table columns
  const columns: ColumnDef<CompanyDto>[] = [
    {
      accessorKey: 'name',
      header: t('Firmenname')
    },
    {
      accessorKey: 'vatId',
      header: 'USt-IdNr.'
    },
    {
      accessorKey: 'contact',
      header: 'E-Mail',
      cell: ({ row }) => row.original.contact?.email || '-'
    },
    {
      accessorKey: 'address',
      header: t('Stadt'),
      cell: ({ row }) => row.original.address?.city || '-'
    },
    {
      accessorKey: 'bank',
      header: t('Bank'),
      cell: ({ row }) => row.original.bank?.bankName || '-'
    },
    {
      id: 'actions',
      header: t('Aktionen'),
      cell: ({ row }) => (
        <RowActions>
          <RowActionButton
            icon={Users}
            label={t('Mitarbeiter')}
            onClick={() =>
              setMembersEntity({ type: 'company', id: row.original.id, name: row.original.name })
            }
          />
          <RowActionButton
            icon={Pencil}
            label={t('Bearbeiten')}
            onClick={() => formSheet.openEdit(row.original)}
          />
          <RowActionButton
            icon={Trash2}
            label={t('Löschen')}
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
        title={t('Firmen')}
        description={t('Firmen der Geschäftspartner verwalten.')}
      />

      <DataTable
        columns={columns}
        data={listRows(companies.data)}
        itemLabel={{ singular: t('Firma'), plural: t('Firmen') }}
        hasMore={companies.hasNextPage ?? false}
        isLoadingMore={companies.isFetchingNextPage}
        onLoadMore={() => void companies.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('Firmen filtern…')}
        // A click opens the company page; the pencil keeps the quick-edit sheet
        onRowClick={(company) =>
          navigate({ to: '/companies/$companyId', params: { companyId: String(company.id) } })
        }
        isLoading={companies.isLoading}
        error={companies.error}
        onRetry={() => void companies.refetch()}
        total={listTotal(companies.data)}
        actionButton={
          <ListToolbar createLabel={t('+ Neue Firma')} onCreate={formSheet.openCreate}>
            <ExportButton list="companies" sort={sortInput} search={search} />
            <ImportButton target="companies" />
            <Button
              variant="outline"
              aria-label={t('Aus E-Rechnung')}
              title={t('Firma und Personen aus einer E-Rechnung anlegen')}
              onClick={() => setFromEInvoice(true)}
            >
              <FileText className="h-4 w-4" />
              <span className="hidden lg:inline">{t('Aus E-Rechnung')}</span>
            </Button>
          </ListToolbar>
        }
      />

      <EInvoiceCompanyDialog
        open={fromEInvoice}
        onOpenChange={setFromEInvoice}
        onSaved={(companyId) =>
          navigate({ to: '/companies/$companyId', params: { companyId: String(companyId) } })
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
        title={formSheet.mode === 'create' ? t('Neue Firma anlegen') : t('Firma bearbeiten')}
        description={
          formSheet.mode === 'create'
            ? t('Eine neue Firma im System anlegen.')
            : t('Firmeninformationen aktualisieren.')
        }
      >
        <CompanyForm
          company={formSheet.selectedItem || undefined}
          onSubmit={mutations.submit}
          onCancel={formSheet.close}
          isSubmitting={mutations.isSubmitting}
        />
      </FormSheet>
    </div>
  )
}

export default CompanyPage
