import { ExportButton } from '@/components/export/ExportButton'
import {
  LIST_CHUNK_SIZE,
  infiniteListOptions,
  listRows,
  listTotal,
  useListSorting
} from '@/hooks/useListQuery'
import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { useFormSheet } from '@/hooks/useFormSheet'
import { Badge } from '@/components/ui/badge'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { InvoiceEditSheet } from '@/components/invoice/InvoiceEditSheet'
import { InvoiceRowActions } from '@/components/invoice/InvoiceRowActions'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_STYLES,
  formatMoney,
  invoiceNumberLabel
} from '@/lib/invoiceLabels'
import type { InvoiceDto, InvoiceListItemDto } from '../../../main/api/schemas/invoice.schema'
import { useListSearchActions } from '@/hooks/useListSearchActions'

export default function InvoicePage() {
  const { sorting, setSorting, sortInput } = useListSorting('invoices', {
    id: 'issueDate',
    desc: true
  })
  const [search, setSearch] = useState('')

  // Create uses the form sheet; existing invoices open in the edit sheet
  // (drafts editable, issued invoices locked)
  const sheet = useFormSheet<InvoiceDto>()
  const [openInvoiceId, setOpenInvoiceId] = useState<number | null>(null)
  const utils = trpcReact.useUtils()

  // ?create=true / ?open=<id> from the search palette and the "+ Neu" menu
  useListSearchActions({
    onCreate: () => sheet.openCreate(),
    onOpen: (id) => setOpenInvoiceId(id)
  })

  const invoices = trpcReact.invoice.getAllPaginated.useInfiniteQuery(
    {
      pageSize: LIST_CHUNK_SIZE,
      search: search || undefined,
      ...sortInput
    },
    infiniteListOptions
  )

  const createMutation = trpcReact.invoice.create.useMutation({
    onSuccess: (created) => {
      utils.invoice.invalidate()
      utils.dealMemo.getById.invalidate()
      utils.dashboard.invalidate()
      sheet.close()
      toast.success(
        created.status === 'draft'
          ? 'Entwurf angelegt'
          : `Rechnung ${invoiceNumberLabel(created.invoiceNumber)} gestellt`
      )
    },
    onError: (error) =>
      toast.error('Rechnung konnte nicht erstellt werden', { description: error.message })
  })

  const rows = useMemo(() => listRows(invoices.data), [invoices.data])

  const columns: ColumnDef<InvoiceListItemDto>[] = [
    {
      accessorKey: 'invoiceNumber',
      header: 'Rechnungsnr.',
      cell: ({ row }) => invoiceNumberLabel(row.original.invoiceNumber)
    },
    {
      accessorKey: 'companyName',
      header: 'Rechnungssteller'
    },
    {
      accessorKey: 'recipientName',
      header: 'Rechnungsempfänger'
    },
    {
      accessorKey: 'periodLabel',
      header: 'Zeitraum',
      cell: ({ row }) => row.original.periodLabel || '-'
    },
    {
      accessorKey: 'dealMemoName',
      header: 'Event',
      cell: ({ row }) => row.original.dealMemoName ?? '-'
    },
    {
      accessorKey: 'issueDate',
      header: 'Datum'
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const status = row.original.status
        return (
          <Badge variant="outline" className={INVOICE_STATUS_STYLES[status]}>
            {INVOICE_STATUS_LABELS[status]}
          </Badge>
        )
      }
    },
    {
      accessorKey: 'totalAmount',
      header: 'Betrag',
      cell: ({ row }) => formatMoney(row.original.totalAmount, row.original.currency)
    },
    {
      id: 'actions',
      header: 'Aktionen',
      cell: ({ row }) => <InvoiceRowActions invoice={row.original} onOpen={setOpenInvoiceId} />
    }
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Rechnungen</h1>
        <p className="text-sm text-muted-foreground">
          Erstellen Sie eventbezogene oder eigenständige Rechnungen mit bearbeitbarem Status und
          Positionen.
        </p>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        itemLabel={{ singular: 'Rechnung', plural: 'Rechnungen' }}
        hasMore={invoices.hasNextPage ?? false}
        isLoadingMore={invoices.isFetchingNextPage}
        onLoadMore={() => void invoices.fetchNextPage()}
        sorting={sorting}
        onSortingChange={setSorting}
        filtered={Boolean(search)}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Rechnungen filtern..."
        isLoading={invoices.isLoading}
        total={listTotal(invoices.data)}
        actionButton={
          <div className="flex flex-wrap items-center gap-2">
            <ExportButton list="invoices" sort={sortInput} search={search} />
            <Button onClick={() => sheet.openCreate()}>+ Rechnung anlegen</Button>
          </div>
        }
      />

      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode="create"
        title="Rechnung anlegen"
        description="Erstellen Sie eine Rechnung mit Positionen – als Entwurf oder direkt gestellt."
      >
        <InvoiceForm
          key={sheet.isOpen ? 'create-open' : 'create'}
          mode="create"
          onCancel={sheet.close}
          onCreate={(payload) => createMutation.mutate(payload)}
          onUpdate={() => {}}
          isSubmitting={createMutation.isPending}
        />
      </FormSheet>

      <InvoiceEditSheet invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} />
    </div>
  )
}
