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
import { PersonForm } from '@/components/forms/PersonForm'
import type { CreatePersonInput, UpdatePersonInput } from '../../../main/api/schemas/person.schema'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'
import { PersonDto } from 'src/main/api/schemas/person.schema'
import { confirmAction } from '@/lib/confirm'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { RowActionButton, RowActions } from '@/components/row-action-button'

export function PersonPage() {
  const { sorting, setSorting, sortInput } = useListSorting('persons', {
    id: 'lastName',
    desc: false
  })
  const [search, setSearch] = useState('')
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

  // Mutations
  const createMutation = trpcReact.person.create.useMutation({
    onSuccess: () => {
      utils.person.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Person angelegt', { description: 'Die Person wurde erfolgreich angelegt.' })
    },
    onError: (error) => {
      toast.error('Person konnte nicht angelegt werden', { description: error.message })
    }
  })

  const updateMutation = trpcReact.person.update.useMutation({
    onSuccess: () => {
      utils.person.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Person aktualisiert', {
        description: 'Die Person wurde erfolgreich aktualisiert.'
      })
    },
    onError: (error) => {
      toast.error('Person konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  const deleteMutation = trpcReact.person.delete.useMutation({
    onSuccess: () => {
      utils.person.getAllPaginated.invalidate()
      toast.success('Person gelöscht', { description: 'Die Person wurde erfolgreich gelöscht.' })
    },
    onError: (error) => {
      toast.error('Person konnte nicht gelöscht werden', { description: error.message })
    }
  })

  // Handlers
  const handleCreate = (data: z.infer<typeof CreatePersonInput>) => {
    createMutation.mutate(data)
  }

  const handleUpdate = (data: z.infer<typeof CreatePersonInput> & { id?: number }) => {
    updateMutation.mutate(data as z.infer<typeof UpdatePersonInput>)
  }

  const handleDelete = async (person: PersonDto) => {
    if (
      await confirmAction({
        title: `„${person.firstName} ${person.lastName}“ löschen?`,
        description: 'Diese Aktion kann nicht rückgängig gemacht werden.',
        confirmLabel: 'Löschen',
        destructive: true
      })
    ) {
      deleteMutation.mutate({ id: person.id })
    }
  }

  // Table columns
  const columns: ColumnDef<PersonDto>[] = [
    {
      accessorKey: 'firstName',
      header: 'Vorname'
    },
    {
      accessorKey: 'lastName',
      header: 'Nachname'
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
        <h1 className="text-2xl font-bold mb-2">Personen</h1>
        <p className="text-sm text-muted-foreground">
          Stammdaten der Personen verwalten, einschließlich Kontaktinformationen und Adressen.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={listRows(persons.data)}
        itemLabel={{ singular: 'Person', plural: 'Personen' }}
        hasMore={persons.hasNextPage ?? false}
        isLoadingMore={persons.isFetchingNextPage}
        onLoadMore={() => void persons.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Personen filtern…"
        // A click opens the person page; the pencil keeps the quick-edit sheet
        onRowClick={(person) =>
          navigate({ to: '/persons/$personId', params: { personId: String(person.id) } })
        }
        isLoading={persons.isLoading}
        error={persons.error}
        onRetry={() => void persons.refetch()}
        total={listTotal(persons.data)}
        actionButton={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton list="persons" sort={sortInput} search={search} />
            <ImportButton target="persons" />
            <Button onClick={() => formSheet.openCreate()}>+ Neue Person anlegen</Button>
          </div>
        }
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Person anlegen' : 'Person bearbeiten'}
        description={
          formSheet.mode === 'create'
            ? 'Eine neue Person im System anlegen.'
            : 'Personeninformationen aktualisieren.'
        }
      >
        <PersonForm
          person={formSheet.selectedItem || undefined}
          onSubmit={formSheet.mode === 'create' ? handleCreate : handleUpdate}
          onCancel={formSheet.close}
        />
      </FormSheet>
    </div>
  )
}

export default PersonPage
