import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting
} from '@/hooks/useListQuery'
import { ImportButton } from '@/components/import/ImportButton'
import { trpcReact } from '@/lib/trpc'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { type ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/data-table'
import { FormSheet } from '@/components/form-sheet'
import { BandForm } from '@/components/forms/BandForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { FileSignature, Pencil, Trash2 } from 'lucide-react'
import { Users } from 'lucide-react'
import { MembersSheet } from '@/components/MembersSheet'
import { ManagementContractSheet } from '@/components/band/ManagementContractSheet'
import type { BandDto } from '../../../main/api/schemas/band.schema'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { ListPageHeader, ListToolbar } from '@/components/ListPageHeader'
import { RowActionButton, RowActions } from '@/components/row-action-button'

export default function BandPage() {
  const { sorting, setSorting, sortInput } = useListSorting('bands', { id: 'name', desc: false })
  const [search, setSearch] = useState('')
  const [membersEntity, setMembersEntity] = useState<{
    type: 'band'
    id: number
    name: string
  } | null>(null)
  const [contractBand, setContractBand] = useState<{ id: number; name: string } | null>(null)

  const sheet = useFormSheet<BandDto>()
  const navigate = useNavigate()

  const bands = trpcReact.band.getAllPaginated.useInfiniteQuery(
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
    onCreate: () => sheet.openCreate(),
    onOpen: (id) => void utils.band.getById.fetch(id).then((band) => band && sheet.openEdit(band))
  })

  const mutations = useRecordMutations({
    procedures: trpcReact.band,
    utils: utils.band,
    noun: 'Band',
    label: (band: BandDto) => band.name,
    deleteInput: (band) => band.id,
    onSaved: sheet.close
  })

  // Define table columns
  const columns: ColumnDef<BandDto>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: (info) => <span className="font-medium">{info.getValue() as string}</span>
    },
    {
      accessorKey: 'genre',
      header: 'Genre',
      cell: (info) => info.getValue()
    },
    {
      accessorKey: 'founded',
      header: 'Gründung',
      cell: (info) => info.getValue() || '-'
    },
    {
      accessorKey: 'notes',
      header: 'Anmerkungen',
      cell: (info) => {
        const value = info.getValue() as string
        return value ? (value.length > 50 ? value.substring(0, 50) + '...' : value) : '-'
      }
    },
    {
      id: 'actions',
      header: 'Aktionen',
      cell: ({ row }) => {
        const band = row.original
        return (
          <RowActions>
            <RowActionButton
              icon={Users}
              label="Mitglieder"
              onClick={() => setMembersEntity({ type: 'band', id: band.id, name: band.name })}
            />
            <RowActionButton
              icon={FileSignature}
              label="Managementvertrag"
              onClick={() => setContractBand({ id: band.id, name: band.name })}
            />
            <RowActionButton
              icon={Pencil}
              label="Bearbeiten"
              onClick={() => sheet.openEdit(band)}
            />
            <RowActionButton
              icon={Trash2}
              label="Löschen"
              destructive
              onClick={() => void mutations.remove(band)}
            />
          </RowActions>
        )
      }
    }
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <ListPageHeader title="Bands" description="Verwalten Sie Ihre Künstler und Kontakte." />

      <DataTable
        columns={columns}
        data={listRows(bands.data)}
        itemLabel={{ singular: 'Band', plural: 'Bands' }}
        hasMore={bands.hasNextPage ?? false}
        isLoadingMore={bands.isFetchingNextPage}
        onLoadMore={() => void bands.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Bands filtern…"
        // A click opens the band page; the pencil keeps the quick-edit sheet
        onRowClick={(band) =>
          navigate({ to: '/band/$bandId', params: { bandId: String(band.id) } })
        }
        isLoading={bands.isLoading}
        error={bands.error}
        onRetry={() => void bands.refetch()}
        total={listTotal(bands.data)}
        actionButton={
          <ListToolbar createLabel="+ Neue Band anlegen" onCreate={sheet.openCreate}>
            <ExportButton list="bands" sort={sortInput} search={search} />
            <ImportButton target="bands" />
          </ListToolbar>
        }
      />

      <ManagementContractSheet band={contractBand} onClose={() => setContractBand(null)} />

      <MembersSheet
        entityType="band"
        entityId={membersEntity?.id ?? null}
        entityName={membersEntity?.name ?? ''}
        open={membersEntity !== null}
        onOpenChange={(open) => {
          if (!open) setMembersEntity(null)
        }}
      />

      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode={sheet.mode}
        title={sheet.mode === 'create' ? 'Neue Band anlegen' : 'Band bearbeiten'}
        description={
          sheet.mode === 'create'
            ? 'Füllen Sie die Details aus, um eine neue Band anzulegen.'
            : 'Nehmen Sie Änderungen am Bandprofil unten vor.'
        }
      >
        <BandForm
          mode={sheet.mode}
          initialData={sheet.selectedItem}
          onSubmit={mutations.submit}
          onCancel={sheet.close}
          isSubmitting={mutations.isSubmitting}
        />
      </FormSheet>
    </div>
  )
}
