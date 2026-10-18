import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FileText, Plus, Printer, X } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RowActionButton } from '@/components/row-action-button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_STYLES,
  formatMoney,
  invoiceNumberLabel,
  parseAmount,
  roundMoney
} from '@/lib/invoiceLabels'
import {
  managementShareAmount,
  quarterLabel,
  type ManagementShareIncomeInput,
  type ManagementContractDto
} from '../../../../main/api/schemas/management_contract.schema'
import type { InvoiceStatus } from '../../../../main/api/schemas/invoice.schema'

/** The last quarter that has ended (the one usually billed next) */
function lastEndedQuarter(today = new Date()): { year: number; quarter: number } {
  const current = Math.floor(today.getMonth() / 3) + 1
  return current === 1
    ? { year: today.getFullYear() - 1, quarter: 4 }
    : { year: today.getFullYear(), quarter: current - 1 }
}

const eur = (value: number) => formatMoney(value, 'EUR')

/**
 * Quarterly management shares billed from this contract: the list of
 * billed quarters and "Quartal abrechnen" (band's net income → draft
 * invoice to the band). `beforeBilling` saves pending contract edits first.
 */
export function ManagementShareSection({
  bandId,
  contract,
  beforeBilling
}: {
  bandId: number
  contract: ManagementContractDto
  beforeBilling: () => Promise<boolean>
}) {
  const navigate = useNavigate()
  const shares = trpcReact.managementContract.listSharesByBand.useQuery(bandId)
  const [dialogOpen, setDialogOpen] = useState(false)

  const list = shares.data ?? []

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">Managementbeteiligung</div>
          <p className="text-sm text-muted-foreground">
            {contract.commissionPercent.toLocaleString('de-DE')} % der Netto-Einnahmen der Band, je
            Quartal als Rechnung an die Band.
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          disabled={!contract.managementCompanyId}
          title={contract.managementCompanyId ? undefined : 'Erst ein Management auswählen'}
          onClick={async () => {
            if (await beforeBilling()) setDialogOpen(true)
          }}
        >
          <Plus className="h-4 w-4" /> Quartal abrechnen
        </Button>
      </div>

      {list.length > 0 && (
        <ul aria-label="Abgerechnete Quartale" className="divide-y rounded-md border">
          {list.map((share) => (
            <li key={share.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
              <span className="w-36 shrink-0 font-medium">
                {quarterLabel(share.year, share.quarter)}
              </span>
              <span
                className="flex-1 truncate text-muted-foreground"
                title={share.income
                  .map((line) => `${line.description}: ${eur(line.netAmount)}`)
                  .join('\n')}
              >
                {share.commissionPercent.toLocaleString('de-DE')} % von {eur(share.incomeTotal)} ={' '}
                <span className="text-foreground">{eur(share.netAmount)}</span> netto
              </span>
              <Badge
                variant="outline"
                className={INVOICE_STATUS_STYLES[share.invoiceStatus as InvoiceStatus]}
              >
                {share.invoiceNumber === null
                  ? INVOICE_STATUS_LABELS.draft
                  : `${invoiceNumberLabel(share.invoiceNumber)} · ${
                      INVOICE_STATUS_LABELS[share.invoiceStatus as InvoiceStatus]
                    }`}
              </Badge>
              <div className="flex shrink-0">
                <RowActionButton
                  icon={FileText}
                  label="Rechnung öffnen"
                  onClick={() =>
                    void navigate({ to: '/invoices', search: { open: share.invoiceId } })
                  }
                />
                <RowActionButton
                  icon={Printer}
                  label="Drucken / PDF"
                  onClick={() =>
                    void navigate({
                      to: '/invoices/$invoiceId/print',
                      params: { invoiceId: String(share.invoiceId) }
                    })
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialogOpen && (
        <BillQuarterDialog
          bandId={bandId}
          contract={contract}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  )
}

type IncomeLine = { key: number; description: string; amount: string }

function BillQuarterDialog({
  bandId,
  contract,
  onClose
}: {
  bandId: number
  contract: ManagementContractDto
  onClose: () => void
}) {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const initial = lastEndedQuarter()
  const [quarter, setQuarter] = useState(initial.quarter)
  const [year, setYear] = useState(String(initial.year))
  const [taxRate, setTaxRate] = useState('19')
  const [lines, setLines] = useState<IncomeLine[]>([
    { key: 1, description: 'Konzerte', amount: '' }
  ])

  const createMutation = trpcReact.managementContract.createShare.useMutation({
    onSuccess: (share) => {
      void utils.managementContract.listSharesByBand.invalidate(bandId)
      void utils.invoice.getAllPaginated.invalidate()
      toast.success(`Entwurf für das ${quarterLabel(share.year, share.quarter)} angelegt`, {
        description: `${eur(share.netAmount)} netto – unter Rechnungen prüfen und stellen.`,
        action: {
          label: 'Drucken',
          onClick: () =>
            void navigate({
              to: '/invoices/$invoiceId/print',
              params: { invoiceId: String(share.invoiceId) }
            })
        }
      })
      onClose()
    },
    onError: (error) =>
      toast.error('Abrechnung konnte nicht angelegt werden', { description: error.message })
  })

  const setLine = (key: number, patch: Partial<IncomeLine>) =>
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)))

  // Live preview with the same rounding as the invoice
  const amounts = lines.map((line) => parseAmount(line.amount))
  const incomeTotal = roundMoney(amounts.reduce<number>((sum, value) => sum + (value ?? 0), 0))
  const share = managementShareAmount(incomeTotal, contract.commissionPercent)
  const vatRate = parseAmount(taxRate)
  const vat = roundMoney((share * (vatRate ?? 0)) / 100)

  const submit = () => {
    const yearNumber = Number(year)
    if (!Number.isInteger(yearNumber) || yearNumber < 2000 || yearNumber > 2100) {
      toast.error('Bitte ein gültiges Jahr angeben')
      return
    }
    if (vatRate === null || vatRate < 0 || vatRate > 100) {
      toast.error('USt.: 0 bis 100 %')
      return
    }
    const income: ManagementShareIncomeInput[] = []
    for (const [index, line] of lines.entries()) {
      const description = line.description.trim()
      const amount = amounts[index]
      if (!description && !line.amount.trim()) continue
      if (!description) {
        toast.error('Bitte bei jeder Einnahme die Art angeben')
        return
      }
      if (amount === null || amount < 0) {
        toast.error(`„${description}“: bitte einen Betrag ≥ 0 eingeben`)
        return
      }
      income.push({ description, netAmount: amount })
    }
    if (income.length === 0) {
      toast.error('Bitte mindestens eine Einnahme erfassen')
      return
    }
    createMutation.mutate({
      contractId: contract.id,
      year: yearNumber,
      quarter,
      income,
      taxRate: vatRate
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Managementbeteiligung abrechnen</DialogTitle>
          <DialogDescription>
            Netto-Einnahmen der Band laut ihrer Abrechnung. Daraus wird ein Rechnungsentwurf an die
            Band über {contract.commissionPercent.toLocaleString('de-DE')} % angelegt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div className="space-y-2">
              <Label>Quartal</Label>
              <Select value={String(quarter)} onValueChange={(value) => setQuarter(Number(value))}>
                <SelectTrigger aria-label="Quartal">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((q) => (
                    <SelectItem key={q} value={String(q)}>
                      {q}. Quartal
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ms-year">Jahr</Label>
              <Input
                id="ms-year"
                inputMode="numeric"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Einnahmen der Band (netto)</Label>
            {lines.map((line, index) => (
              <div key={line.key} className="flex items-center gap-2">
                <Input
                  aria-label={`Einnahme ${index + 1}`}
                  placeholder="z. B. Konzerte, Merchandise, Lizenzen"
                  value={line.description}
                  onChange={(e) => setLine(line.key, { description: e.target.value })}
                />
                <div className="relative w-40 shrink-0">
                  <Input
                    aria-label={`Betrag ${index + 1}`}
                    inputMode="decimal"
                    className="pr-6 text-right"
                    placeholder="0,00"
                    value={line.amount}
                    onChange={(e) => setLine(line.key, { amount: e.target.value })}
                  />
                  <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-sm text-muted-foreground">
                    €
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Zeile entfernen"
                  title="Zeile entfernen"
                  disabled={lines.length === 1}
                  onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  { key: Math.max(...prev.map((l) => l.key)) + 1, description: '', amount: '' }
                ])
              }
            >
              <Plus className="h-4 w-4" /> Einnahme
            </Button>
            {contract.excludedIncome && (
              <p className="text-xs text-muted-foreground">
                Nicht beteiligungspflichtig laut Vertrag: {contract.excludedIncome}
              </p>
            )}
          </div>

          <div className="ml-auto w-72 space-y-1 text-sm" data-testid="management-share-preview">
            <div className="flex justify-between">
              <span>Einnahmen gesamt</span>
              <span>{eur(incomeTotal)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>Beteiligung {contract.commissionPercent.toLocaleString('de-DE')} %</span>
              <span>{eur(share)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1">
                zzgl.
                <Input
                  aria-label="USt.-Satz"
                  inputMode="decimal"
                  className="h-7 w-14 px-2 text-right"
                  value={taxRate}
                  onChange={(e) => setTaxRate(e.target.value)}
                />
                % USt.
              </span>
              <span>{eur(vat)}</span>
            </div>
            <div className="flex justify-between border-t pt-1 font-semibold">
              <span>Gesamtbetrag</span>
              <span>{eur(roundMoney(share + vat))}</span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={submit} disabled={createMutation.isPending || share <= 0}>
            Entwurf anlegen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
