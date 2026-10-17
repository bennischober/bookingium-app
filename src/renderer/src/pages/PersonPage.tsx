import { Users } from 'lucide-react'
import { useState } from 'react'
import type { z } from 'zod'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PersonRelations } from '@/components/PersonRelations'
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

export function PersonPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')
  const [relationsSheetOpen, setRelationsSheetOpen] = useState(false)
  const [selectedPersonForRelations, setSelectedPersonForRelations] = useState<PersonDto | null>(
    null
  )

  const formSheet = useFormSheet<PersonDto>()
  const utils = trpcReact.useUtils()

  const allPersons = trpcReact.person.getAll.useQuery()
  console.log(allPersons.data)

  // Queries
  const persons = trpcReact.person.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

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
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSelectedPersonForRelations(row.original)
              setRelationsSheetOpen(true)
            }}
            title="Beziehungen anzeigen"
          >
            <Users className="h-4 w-4" />
          </Button>
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
        <h1 className="text-2xl font-bold mb-2">Personen</h1>
        <p className="text-sm text-muted-foreground">
          Stammdaten der Personen verwalten, einschließlich Kontaktinformationen und Adressen.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={persons.data?.items ?? []}
        pageCount={persons.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        search={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPagination((prev) => ({ ...prev, pageIndex: 0 }))
        }}
        searchPlaceholder="Personen filtern..."
        isLoading={persons.isLoading}
        total={persons.data?.total ?? 0}
        actionButton={<Button onClick={() => formSheet.openCreate()}>+ Neue Person anlegen</Button>}
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

      <Sheet open={relationsSheetOpen} onOpenChange={setRelationsSheetOpen}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Beziehungen der Person</SheetTitle>
          </SheetHeader>
          {selectedPersonForRelations && (
            <PersonRelations
              personId={selectedPersonForRelations.id}
              personName={`${selectedPersonForRelations.firstName} ${selectedPersonForRelations.lastName}`}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

export default PersonPage
