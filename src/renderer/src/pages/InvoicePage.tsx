import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Pencil, Trash2, Printer } from 'lucide-react'
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
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_STYLES, formatMoney } from '@/lib/invoiceLabels'
import type { InvoiceDto, InvoiceListItemDto } from '../../../main/api/schemas/invoice.schema'

export default function InvoicePage() {
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 10 })
  const [search, setSearch] = useState('')
  const [settingsCompanyId, setSettingsCompanyId] = useState<number | null>(null)
  const [nextNumberInput, setNextNumberInput] = useState('1')

  const sheet = useFormSheet<InvoiceDto>()
  const utils = trpcReact.useUtils()
  const navigate = useNavigate()

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
    onSuccess: () => {
      utils.invoice.getAllPaginated.invalidate()
      utils.invoice.getByDealMemoId.invalidate()
      sheet.close()
      toast.success('Rechnung erstellt')
    },
    onError: (error) =>
      toast.error('Rechnung konnte nicht erstellt werden', { description: error.message })
  })

  const updateMutation = trpcReact.invoice.update.useMutation({
    onSuccess: () => {
      utils.invoice.getAllPaginated.invalidate()
      sheet.close()
      toast.success('Rechnung aktualisiert')
    },
    onError: (error) =>
      toast.error('Rechnung konnte nicht aktualisiert werden', { description: error.message })
  })

  const deleteMutation = trpcReact.invoice.delete.useMutation({
    onSuccess: () => {
      utils.invoice.getAllPaginated.invalidate()
      toast.success('Rechnung gelöscht')
    },
    onError: (error) =>
      toast.error('Rechnung konnte nicht gelöscht werden', { description: error.message })
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
      header: 'Rechnungsnr.'
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
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              navigate({
                to: '/invoices/$invoiceId/print',
                params: { invoiceId: String(row.original.id) }
              })
            }
            title="Drucken / Als PDF speichern"
          >
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              const fullInvoice = await utils.invoice.getById.fetch(row.original.id)
              if (!fullInvoice) {
                toast.error('Rechnung nicht gefunden')
                return
              }
              sheet.openEdit(fullInvoice)
            }}
            title="Bearbeiten"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              if (confirm(`Rechnung #${row.original.invoiceNumber} löschen?`)) {
                deleteMutation.mutate(row.original.id)
              }
            }}
            title="Löschen"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )
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

      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
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
        mode={sheet.mode}
        title={sheet.mode === 'create' ? 'Rechnung anlegen' : 'Rechnung bearbeiten'}
        description={
          sheet.mode === 'create'
            ? 'Erstellen Sie eine Rechnung mit Positionen.'
            : 'Bearbeiten Sie Details, Empfänger, Verknüpfung und Status der Rechnung.'
        }
      >
        <InvoiceForm
          key={`${sheet.mode}-${sheet.selectedItem?.id ?? 'new'}`}
          mode={sheet.mode}
          invoice={sheet.selectedItem ?? undefined}
          onCancel={sheet.close}
          onCreate={(payload) => createMutation.mutate(payload)}
          onUpdate={(payload) => updateMutation.mutate(payload)}
          isSubmitting={createMutation.isPending || updateMutation.isPending}
        />
      </FormSheet>
    </div>
  )
}
