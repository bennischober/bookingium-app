import { Users } from 'lucide-react'
import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { PersonRelations } from '@/components/PersonRelations'
import { trpcReact } from '@/main'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { PersonForm } from '@/components/forms/PersonForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { Pencil, Trash2 } from 'lucide-react'
import { PersonDto } from 'src/main/api/schemas/person.schema'

export function PersonPage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')
  const [relationsSheetOpen, setRelationsSheetOpen] = useState(false)
  const [selectedPersonForRelations, setSelectedPersonForRelations] = useState<PersonDto | null>(null)

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
      toast.success('Person created', { description: 'The person was created successfully.' })
    },
    onError: (error) => {
      toast.error('Failed to create person', { description: error.message })
    }
  })

  const updateMutation = trpcReact.person.update.useMutation({
    onSuccess: () => {
      utils.person.getAllPaginated.invalidate()
      formSheet.close()
      toast.success('Person updated', { description: 'The person was updated successfully.' })
    },
    onError: (error) => {
      toast.error('Failed to update person', { description: error.message })
    }
  })

  const deleteMutation = trpcReact.person.delete.useMutation({
    onSuccess: () => {
      utils.person.getAllPaginated.invalidate()
      toast.success('Person deleted', { description: 'The person was deleted successfully.' })
    },
    onError: (error) => {
      toast.error('Failed to delete person', { description: error.message })
    }
  })

  // Handlers
  const handleCreate = (data: any) => {
    createMutation.mutate(data)
  }

  const handleUpdate = (data: any) => {
    updateMutation.mutate(data)
  }

  const handleDelete = (person: PersonDto) => {
    if (confirm(`Are you sure you want to delete ${person.firstName} ${person.lastName}?`)) {
      deleteMutation.mutate({ id: person.id })
    }
  }

  // Table columns
  const columns: ColumnDef<PersonDto>[] = [
    {
      accessorKey: 'firstName',
      header: 'First Name'
    },
    {
      accessorKey: 'lastName',
      header: 'Last Name'
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
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSelectedPersonForRelations(row.original)
              setRelationsSheetOpen(true)
            }}
            title="View Relations"
          >
            <Users className="h-4 w-4" />
          </Button>
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
        <h1 className="text-2xl font-bold mb-2">Persons</h1>
        <p className="text-sm text-muted-foreground">
          Manage the Person master data including contact information and addresses.
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
        searchPlaceholder="Filter persons..."
        isLoading={persons.isLoading}
        total={persons.data?.total ?? 0}
        actionButton={<Button onClick={() => formSheet.openCreate()}>+ Add New Person</Button>}
      />

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? 'Create Person' : 'Edit Person'}
        description={
          formSheet.mode === 'create'
            ? 'Add a new person to the system.'
            : 'Update the person information.'
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
            <SheetTitle>Person Relations</SheetTitle>
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
