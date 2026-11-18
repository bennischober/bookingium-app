import { useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { CheckCircle2, Clock, ExternalLink, Landmark, Pencil, Trash2, Upload } from 'lucide-react'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSearch,
  useListSorting
} from '@/hooks/useListQuery'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { formatShortDate } from '@/lib/utils'
import { formatMoney } from '@/lib/invoiceLabels'
import { DataTable } from '@/components/data-table'
import { ListPageHeader, ListToolbar } from '@/components/ListPageHeader'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { droppedFilePaths } from '@/components/documents/documentFiles'
import { ReceiptDialog } from '@/components/receipts/ReceiptDialog'
import { fromCents } from '../../../main/einvoice/amounts'
import {
  RECEIPT_CATEGORIES,
  RECEIPT_CATEGORY_LABELS,
  type ReceiptCategory,
  type ReceiptDto,
  type ReceiptSource
} from '../../../main/api/schemas/receipt.schema'

const ALL = 'all'

/** #225: received documents (Belege) and their hand-over to DATEV */
export default function ReceiptPage() {
  const utils = trpcReact.useUtils()
  const { sorting, setSorting, sortInput } = useListSorting('receipts', {
    id: 'receiptDate',
    desc: true
  })
  const [search, setSearch] = useListSearch('receipts')
  const [category, setCategory] = useState<ReceiptCategory | typeof ALL>(ALL)
  const [notSent, setNotSent] = useState(false)
  // Dropped or picked files, taken one after another
  const [queue, setQueue] = useState<ReceiptSource[]>([])
  const [queueIndex, setQueueIndex] = useState(0)
  const [editing, setEditing] = useState<ReceiptDto | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const receipts = trpcReact.receipt.list.useInfiniteQuery(
    {
      pageSize: LIST_CHUNK_SIZE,
      search: search || undefined,
      category: category === ALL ? undefined : category,
      notSent: notSent || undefined,
      ...sortInput
    },
    infiniteListOptions
  )

  const failed = (title: string) => (error: { message: string }) =>
    toast.error(title, { description: error.message })
  const remove = trpcReact.receipt.delete.useMutation({
    onSuccess: () => {
      void utils.receipt.invalidate()
      toast.success('Beleg gelöscht', { description: 'Die Datei liegt im Papierkorb.' })
    },
    onError: failed('Beleg konnte nicht gelöscht werden')
  })
  const open = trpcReact.receipt.open.useMutation({
    onError: failed('Datei konnte nicht geöffnet werden')
  })
  const send = trpcReact.receipt.sendToDatev.useMutation({
    onSuccess: (result) => {
      void utils.receipt.invalidate()
      if (result.success) toast.success('An DATEV übergeben', { description: result.to })
      else toast.error('Nicht an DATEV übergeben', { description: result.error })
    },
    onError: failed('Nicht an DATEV übergeben')
  })

  const startQueue = (sources: ReceiptSource[]) => {
    if (sources.length === 0) return
    setQueue(sources)
    setQueueIndex(0)
  }
  const nextInQueue = () => {
    if (queueIndex + 1 < queue.length) setQueueIndex(queueIndex + 1)
    else setQueue([])
  }

  const pickFiles = async () => {
    const paths = await window.api.pickReceiptFiles()
    startQueue(paths.map((path) => ({ kind: 'file' as const, path })))
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const paths = droppedFilePaths(e)
    if (paths.length === 0) {
      toast.error('Dateien konnten nicht gelesen werden', {
        description:
          'Diese Drag-Quelle stellt keine lokalen Dateien bereit. Bitte „Belege hinzufügen“ verwenden.'
      })
      return
    }
    startQueue(paths.map((path) => ({ kind: 'file' as const, path })))
  }

  const sendToDatev = async (receipt: ReceiptDto) => {
    if (receipt.datev !== 'none') {
      const again = await confirmAction({
        title: 'Noch einmal an DATEV übergeben?',
        description:
          receipt.datev === 'sent'
            ? 'Der Beleg ist schon übergeben. Ein zweites Mal wird er in DATEV ein zweiter Beleg.'
            : 'Die erste Übergabe wartet noch auf die Bestätigung des Servers. Ein zweites Mal kann in DATEV ein doppelter Beleg werden.',
        confirmLabel: 'Trotzdem übergeben'
      })
      if (!again) return
    }
    send.mutate({ id: receipt.id })
  }

  const confirmRemove = async (receipt: ReceiptDto) => {
    const confirmed = await confirmAction({
      title: `Beleg „${receipt.fileName}“ löschen?`,
      description:
        receipt.datev === 'sent'
          ? 'Die Datei kommt in den Papierkorb. In DATEV bleibt der übergebene Beleg.'
          : 'Die Datei kommt in den Papierkorb.',
      confirmLabel: 'Löschen',
      destructive: true
    })
    if (confirmed) remove.mutate({ id: receipt.id })
  }

  const columns: ColumnDef<ReceiptDto>[] = [
    {
      id: 'receiptDate',
      accessorKey: 'receiptDate',
      header: 'Datum',
      cell: ({ row }) =>
        row.original.receiptDate ? formatShortDate(row.original.receiptDate) : '–'
    },
    {
      id: 'supplierName',
      accessorKey: 'supplierName',
      header: 'Lieferant',
      cell: ({ row }) => row.original.supplierName || '–'
    },
    {
      id: 'category',
      accessorKey: 'category',
      header: 'Belegart',
      cell: ({ row }) => RECEIPT_CATEGORY_LABELS[row.original.category]
    },
    {
      id: 'amountCents',
      accessorKey: 'amountCents',
      header: 'Betrag',
      cell: ({ row }) =>
        row.original.amountCents === null
          ? '–'
          : formatMoney(fromCents(row.original.amountCents), row.original.currency)
    },
    { id: 'fileName', accessorKey: 'fileName', header: 'Datei' },
    {
      id: 'datev',
      header: 'DATEV',
      enableSorting: false,
      cell: ({ row }) =>
        row.original.datev === 'sent' ? (
          <Badge variant="secondary" className="gap-1">
            <CheckCircle2 className="h-3 w-3" /> übergeben
          </Badge>
        ) : row.original.datev === 'pending' ? (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" /> wird bestätigt
          </Badge>
        ) : (
          <span className="text-muted-foreground">offen</span>
        )
    },
    {
      id: 'actions',
      header: 'Aktionen',
      cell: ({ row }) => (
        <RowActions>
          <RowActionButton
            icon={ExternalLink}
            label="Öffnen"
            onClick={() => open.mutate({ id: row.original.id })}
          />
          <RowActionButton
            icon={Landmark}
            label="An DATEV übergeben"
            onClick={() => void sendToDatev(row.original)}
          />
          <RowActionButton
            icon={Pencil}
            label="Bearbeiten"
            onClick={() => setEditing(row.original)}
          />
          <RowActionButton
            icon={Trash2}
            label="Löschen"
            destructive
            onClick={() => void confirmRemove(row.original)}
          />
        </RowActions>
      )
    }
  ]

  return (
    <div
      className="relative flex h-full min-h-0 w-full flex-col p-6"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        dragDepth.current++
        setDragging(true)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-4 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/85">
          <div className="text-center">
            <Upload className="mx-auto mb-2 h-8 w-8 text-primary" />
            <p className="font-medium">Belege hier ablegen</p>
            <p className="text-sm text-muted-foreground">PDF, E-Rechnung (XML), JPG oder PNG</p>
          </div>
        </div>
      )}

      <ListPageHeader
        title="Belege"
        description="Eingangsrechnungen, Kreditkarten- und Kassenbelege für DATEV. Dateien hierher ziehen oder hinzufügen."
      >
        <Select value={category} onValueChange={(value) => setCategory(value as typeof category)}>
          <SelectTrigger className="w-52" aria-label="Belegart">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Alle Belegarten</SelectItem>
            {RECEIPT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {RECEIPT_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch id="receipts-not-sent" checked={notSent} onCheckedChange={setNotSent} />
          <Label htmlFor="receipts-not-sent">Nur nicht übergebene</Label>
        </div>
      </ListPageHeader>

      <DataTable
        columns={columns}
        data={listRows(receipts.data)}
        itemLabel={{ singular: 'Beleg', plural: 'Belege' }}
        hasMore={receipts.hasNextPage ?? false}
        isLoadingMore={receipts.isFetchingNextPage}
        onLoadMore={() => void receipts.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search) || category !== ALL || notSent}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Belege filtern…"
        onRowClick={(receipt) => setEditing(receipt)}
        isLoading={receipts.isLoading}
        error={receipts.error}
        onRetry={() => void receipts.refetch()}
        total={listTotal(receipts.data)}
        actionButton={
          <ListToolbar createLabel="+ Belege hinzufügen" onCreate={() => void pickFiles()} />
        }
      />

      {queue.length > 0 && (
        <ReceiptDialog
          open
          onOpenChange={(next) => {
            if (!next) nextInQueue()
          }}
          source={queue[queueIndex]}
          position={{ index: queueIndex, count: queue.length }}
        />
      )}
      {editing && (
        <ReceiptDialog
          open
          onOpenChange={(next) => {
            if (!next) setEditing(null)
          }}
          receipt={editing}
        />
      )}
    </div>
  )
}
