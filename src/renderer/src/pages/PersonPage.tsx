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
import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { FormSheet } from '@/components/form-sheet'
import { PersonForm } from '@/components/forms/PersonForm'
import type { PersonDto } from '../../../main/api/schemas/person.schema'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2 } from 'lucide-react'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { ListPageHeader, ListToolbar } from '@/components/ListPageHeader'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { t } from '../../../main/i18n/translate'

export function PersonPage() {
  const { sorting, setSorting, sortInput } = useListSorting('persons', {
    id: 'lastName',
    desc: false
  })
  const [search, setSearch] = useListSearch('persons')
  const navigate = useNavigate()

  const formSheet = useFormSheet<PersonDto>()
  const utils = trpcReact.useUtils()

  // ?create=true / ?open=<id> from the search palette and the "+ Neu" menu
  useListSearchActions({
    onCreate: () => formSheet.openCreate(),
    onOpen: (id) =>
      void utils.person.getById.fetch({ id }).then((person) => person && formSheet.openEdit(person))
  })

  // Queries
  const persons = trpcReact.person.getAllPaginated.useInfiniteQuery(
    {
      pageSize: LIST_CHUNK_SIZE,
      search: search || undefined,
      ...sortInput
    },
    infiniteListOptions
  )

  const mutations = useRecordMutations({
    procedures: trpcReact.person,
    utils: utils.person,
    noun: t('Person'),
    label: (person: PersonDto) => `${person.firstName} ${person.lastName}`,
    deleteInput: (person) => ({ id: person.id }),
    onSaved: formSheet.close
  })

  // Table columns
  const columns: ColumnDef<PersonDto>[] = [
    {
      accessorKey: 'firstName',
      header: t('Vorname')
    },
    {
      accessorKey: 'lastName',
      header: t('Nachname')
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
      id: 'actions',
      header: t('Aktionen'),
      cell: ({ row }) => (
        <RowActions>
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
        title={t('Personen')}
        description={t(
          'Stammdaten der Personen verwalten, einschließlich Kontaktinformationen und Adressen.'
        )}
      />

      <DataTable
        columns={columns}
        data={listRows(persons.data)}
        itemLabel={{ singular: t('Person'), plural: t('Personen') }}
        hasMore={persons.hasNextPage ?? false}
        isLoadingMore={persons.isFetchingNextPage}
        onLoadMore={() => void persons.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('Personen filtern…')}
        // A click opens the person page; the pencil keeps the quick-edit sheet
        onRowClick={(person) =>
          navigate({ to: '/persons/$personId', params: { personId: String(person.id) } })
        }
        isLoading={persons.isLoading}
        error={persons.error}
        onRetry={() => void persons.refetch()}
        total={listTotal(persons.data)}
        actionButton={
          <ListToolbar createLabel={t('+ Neue Person')} onCreate={formSheet.openCreate}>
            <ExportButton list="persons" sort={sortInput} search={search} />
            <ImportButton target="persons" />
          </ListToolbar>
        }
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? t('Neue Person anlegen') : t('Person bearbeiten')}
        description={
          formSheet.mode === 'create'
            ? t('Eine neue Person im System anlegen.')
            : t('Personeninformationen aktualisieren.')
        }
      >
        <PersonForm
          person={formSheet.selectedItem || undefined}
          onSubmit={mutations.submit}
          onCancel={formSheet.close}
        />
      </FormSheet>
    </div>
  )
}

export default PersonPage
