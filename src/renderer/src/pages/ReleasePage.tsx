import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting,
  useListSearch
} from '@/hooks/useListQuery'
import type { ColumnDef } from '@tanstack/react-table'
import { useNavigate } from '@tanstack/react-router'
import { FileUp, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLabelCopyImport } from '@/components/release/useLabelCopyImport'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { FormSheet } from '@/components/form-sheet'
import { ReleaseForm } from '@/components/forms/ReleaseForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { useListSearchActions } from '@/hooks/useListSearchActions'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { ListPageHeader, ListToolbar } from '@/components/ListPageHeader'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { formatShortDate } from '@/lib/utils'
import { releaseTitle } from '@/components/release/releaseText'
import {
  RELEASE_TYPE_LABELS,
  type CreateReleaseRequest,
  type ReleaseDto,
  type UpdateReleaseRequest
} from '../../../main/api/schemas/release.schema'
import { t } from '../../../main/i18n/translate'

/** #289: every release with its label copy data; a row opens the release */
export default function ReleasePage() {
  const navigate = useNavigate()
  const { sorting, setSorting, sortInput } = useListSorting('releases', {
    id: 'releaseDate',
    desc: true
  })
  const [search, setSearch] = useListSearch('releases')
  const formSheet = useFormSheet<ReleaseDto>()
  const labelCopy = useLabelCopyImport()
  const utils = trpcReact.useUtils()

  useListSearchActions({
    onCreate: () => formSheet.openCreate(),
    onOpen: (id) => void navigate({ to: '/releases/$releaseId', params: { releaseId: String(id) } })
  })

  const releases = trpcReact.release.getAllPaginated.useInfiniteQuery(
    { pageSize: LIST_CHUNK_SIZE, search: search || undefined, ...sortInput },
    infiniteListOptions
  )

  const mutations = useRecordMutations<
    ReleaseDto,
    CreateReleaseRequest,
    UpdateReleaseRequest,
    number
  >({
    procedures: trpcReact.release,
    utils: utils.release,
    noun: t('Release'),
    label: (release: ReleaseDto) => release.title,
    deleteInput: (release: ReleaseDto) => release.id,
    onSaved: (release: ReleaseDto) => {
      const created = formSheet.mode === 'create'
      formSheet.close()
      if (created)
        void navigate({ to: '/releases/$releaseId', params: { releaseId: String(release.id) } })
    }
  })

  const columns: ColumnDef<ReleaseDto>[] = [
    {
      id: 'artist',
      header: t('Artist'),
      cell: ({ row }) => row.original.artist || '-'
    },
    {
      id: 'title',
      header: t('Titel'),
      cell: ({ row }) => <span className="font-medium">{releaseTitle(row.original)}</span>
    },
    {
      id: 'releaseType',
      header: t('Art'),
      cell: ({ row }) => RELEASE_TYPE_LABELS[row.original.releaseType]
    },
    {
      id: 'releaseDate',
      header: t('VÖ'),
      cell: ({ row }) =>
        row.original.releaseDate ? formatShortDate(row.original.releaseDate) : '-'
    },
    {
      id: 'label',
      header: t('Label'),
      cell: ({ row }) => row.original.label || '-'
    },
    {
      id: 'catalogNumber',
      header: t('Katalognr.'),
      cell: ({ row }) => row.original.catalogNumber || '-'
    },
    {
      id: 'upcs',
      header: 'UPC / EAN',
      cell: ({ row }) => (
        <span className="font-mono text-xs" title={row.original.upcs}>
          {row.original.upcs || '-'}
        </span>
      )
    },
    {
      id: 'trackCount',
      header: t('Tracks'),
      cell: ({ row }) => row.original.trackCount || '-'
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
        title={t('Releases')}
        description={t(
          'Die Labelcopy jedes Releases an einem Ort: Produkte, Tracks, Credits und Rechte.'
        )}
      />

      <DataTable
        columns={columns}
        data={listRows(releases.data)}
        itemLabel={{ singular: t('Release'), plural: t('Releases') }}
        hasMore={releases.hasNextPage ?? false}
        isLoadingMore={releases.isFetchingNextPage}
        onLoadMore={() => void releases.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={t('Titel, Artist, UPC oder ISRC suchen…')}
        isLoading={releases.isLoading}
        error={releases.error}
        onRetry={() => void releases.refetch()}
        total={listTotal(releases.data)}
        onRowClick={(release) =>
          void navigate({ to: '/releases/$releaseId', params: { releaseId: String(release.id) } })
        }
        actionButton={
          <ListToolbar createLabel={t('+ Neues Release')} onCreate={formSheet.openCreate}>
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={labelCopy.reading}
              onClick={labelCopy.start}
            >
              <FileUp className="h-4 w-4" />
              {labelCopy.reading ? t('Wird gelesen…') : t('Labelcopy einlesen')}
            </Button>
          </ListToolbar>
        }
      />

      {labelCopy.dialog}

      <FormSheet
        isOpen={formSheet.isOpen}
        onClose={formSheet.close}
        mode={formSheet.mode}
        title={formSheet.mode === 'create' ? t('Neues Release anlegen') : t('Release bearbeiten')}
        description={t('Kopfdaten des Releases. Tracks und Produkte folgen auf seiner Seite.')}
      >
        <ReleaseForm
          mode={formSheet.mode}
          initialData={formSheet.selectedItem}
          onSubmit={mutations.submit}
          onCancel={formSheet.close}
          isSubmitting={mutations.isSubmitting}
        />
      </FormSheet>
    </div>
  )
}
