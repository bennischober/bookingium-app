import { useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { DataTable } from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { useFormSheet } from '@/hooks/useFormSheet'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
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
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')
  const [settingsCompanyId, setSettingsCompanyId] = useState<number | null>(null)
  const [nextNumberInput, setNextNumberInput] = useState('1')

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

  const invoices = trpcReact.invoice.getAllPaginated.useQuery({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

  const companies = trpcReact.company.getListItems.useQuery()
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery()

  // Default the settings panel to the default invoicing company once known
  // (state adjustment during render, per "You Might Not Need an Effect")
  const [lastDefaultCompanyId, setLastDefaultCompanyId] = useState<number | null | undefined>(
    defaultCompany.data?.id
  )
  if (settingsCompanyId === null && defaultCompany.data?.id !== lastDefaultCompanyId) {
    setLastDefaultCompanyId(defaultCompany.data?.id)
    if (defaultCompany.data?.id) {
      setSettingsCompanyId(defaultCompany.data.id)
    }
  }

  const settingsQuery = trpcReact.invoice.getCompanySettings.useQuery(settingsCompanyId ?? 0, {
    enabled: settingsCompanyId !== null
  })

  // Keep the numbering input following the loaded settings (state adjustment
  // during render, per "You Might Not Need an Effect")
  const [lastNextInvoiceNumber, setLastNextInvoiceNumber] = useState<number | undefined>(
    settingsQuery.data?.nextInvoiceNumber
  )
  if (settingsQuery.data?.nextInvoiceNumber !== lastNextInvoiceNumber) {
    setLastNextInvoiceNumber(settingsQuery.data?.nextInvoiceNumber)
    setNextNumberInput((settingsQuery.data?.nextInvoiceNumber ?? 1).toString())
  }

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

  const settingsMutation = trpcReact.invoice.upsertCompanySettings.useMutation({
    onSuccess: () => {
      if (settingsCompanyId !== null) {
        utils.invoice.getCompanySettings.invalidate(settingsCompanyId)
      }
      toast.success('Rechnungsnummerierung aktualisiert')
    },
    onError: (error) =>
      toast.error('Einstellungen konnten nicht aktualisiert werden', { description: error.message })
  })

  const rows = useMemo(() => invoices.data?.items ?? [], [invoices.data?.items])

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

  const handleSaveSettings = () => {
    if (settingsCompanyId === null) {
      toast.error('Bitte zuerst eine Firma auswählen')
      return
    }

    const value = Number(nextNumberInput)
    if (!Number.isInteger(value) || value < 1) {
      toast.error('Nächste Rechnungsnummer muss eine ganze Zahl ≥ 1 sein')
      return
    }

    settingsMutation.mutate({
      companyId: settingsCompanyId,
      nextInvoiceNumber: value
    })
  }

  return (
    <div className="flex flex-col w-full h-full p-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Rechnungen</h1>
        <p className="text-sm text-muted-foreground">
          Erstellen Sie eventbezogene oder eigenständige Rechnungen mit bearbeitbarem Status und
          Positionen.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 min-[1700px]:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <DataTable
            columns={columns}
            data={rows}
            pageCount={invoices.data?.totalPages ?? 0}
            pagination={pagination}
            onPaginationChange={setPagination}
            search={search}
            onSearchChange={(value) => {
              setSearch(value)
              setPagination((prev) => ({ ...prev, pageIndex: 0 }))
            }}
            searchPlaceholder="Rechnungen filtern..."
            isLoading={invoices.isLoading}
            total={invoices.data?.total ?? 0}
            actionButton={<Button onClick={() => sheet.openCreate()}>+ Rechnung anlegen</Button>}
          />
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Rechnungsnummerierung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Firma</Label>
              <Select
                value={settingsCompanyId?.toString() ?? ''}
                onValueChange={(value) => setSettingsCompanyId(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Firma auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {(companies.data ?? []).map((company) => (
                    <SelectItem key={company.id} value={company.id.toString()}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Nächste Rechnungsnummer</Label>
              <Input
                type="number"
                min="1"
                step="1"
                value={nextNumberInput}
                onChange={(e) => setNextNumberInput(e.target.value)}
                disabled={settingsQuery.isLoading}
              />
            </div>

            <Button
              className="w-full"
              onClick={handleSaveSettings}
              disabled={settingsMutation.isPending}
            >
              Nummerierung speichern
            </Button>

            <p className="text-xs text-muted-foreground">
              Dieser Wert wird als nächste Rechnungsnummer für neu erstellte Rechnungen der
              ausgewählten Firma verwendet.
            </p>
          </CardContent>
        </Card>
      </div>

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
