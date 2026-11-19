import { useEffect, useRef, useState } from 'react'
import { Building2, FileText } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { openCompanyEnrichment } from '@/components/company/companyEnrichmentEvents'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { SearchableSelect } from '@/components/ui/searchable-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { EInvoiceCompanyDialog } from '@/components/company/EInvoiceCompanyDialog'
import {
  RECEIPT_CATEGORIES,
  RECEIPT_CATEGORY_LABELS,
  type ReceiptCategory,
  type ReceiptDraft,
  type ReceiptDto,
  type ReceiptSource
} from '../../../../main/api/schemas/receipt.schema'
import { fieldsOf, formStateOf, formStateOfReceipt, type ReceiptFormState } from './receiptForm'

// #225: one receipt - new from a file (dropped, picked, or a mail attachment) or an existing one
// to correct. A new one is read first: an e-invoice fills date, amount, number and supplier.

const DEFAULT_COMPANY = 0

export function ReceiptDialog({
  open,
  onOpenChange,
  source,
  receipt,
  position,
  onSaved
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A new receipt from this file */
  source?: ReceiptSource | null
  /** An existing receipt to edit */
  receipt?: ReceiptDto | null
  /** "2 von 3" while several dropped files are taken in turn */
  position?: { index: number; count: number }
  onSaved?: (receipt: ReceiptDto) => void
}) {
  const utils = trpcReact.useUtils()
  const companies = trpcReact.company.getListItems.useQuery(undefined, { enabled: open })
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery(undefined, {
    enabled: open
  })
  const [draft, setDraft] = useState<ReceiptDraft | null>(null)
  const [state, setState] = useState<ReceiptFormState | null>(null)
  const [creatingCompany, setCreatingCompany] = useState(false)

  const read = trpcReact.receipt.read.useMutation({
    onSuccess: (result) => {
      setDraft(result)
      setState(formStateOf(result.fields))
    },
    onError: (error) => {
      toast.error('Datei kann kein Beleg werden', { description: error.message })
      onOpenChange(false)
    }
  })

  const done = (saved: ReceiptDto, message: string) => {
    void utils.receipt.invalidate()
    toast.success(message, { description: saved.fileName })
    onSaved?.(saved)
    onOpenChange(false)
  }
  const failed = (error: { message: string }) =>
    toast.error('Beleg konnte nicht gespeichert werden', { description: error.message })
  /** #236: the invoice may complete its sender's company; asked after the dialog closed */
  const suggestEnrichment = (from: ReceiptSource): void => {
    if (from.kind === 'file' && !/.(pdf|xml)$/i.test(from.path)) return
    const enrichmentSource =
      from.kind === 'file'
        ? { kind: 'file' as const, path: from.path }
        : {
            kind: 'attachment' as const,
            accountId: from.accountId,
            messageId: from.messageId,
            partId: from.partId
          }
    void utils.companyEnrichment.check
      .fetch({ source: enrichmentSource, senderEmail: '' })
      .then((enrichment) => {
        if (!enrichment) return
        toast(`${enrichment.companyName}: ${enrichment.fills.length} Angaben aus der Rechnung`, {
          description: enrichment.fills.map((fill) => fill.label).join(', '),
          duration: 15000,
          action: { label: 'Ergänzen…', onClick: () => openCompanyEnrichment(enrichment) }
        })
      })
      .catch(() => {})
  }
  const create = trpcReact.receipt.create.useMutation({
    onSuccess: (saved) => {
      done(saved, 'Beleg gespeichert')
      if (source) suggestEnrichment(source)
    },
    onError: failed
  })
  const update = trpcReact.receipt.update.useMutation({
    onSuccess: (saved) => done(saved, 'Beleg geändert'),
    onError: failed
  })

  // Each opened file or receipt starts the form over; Strict Mode runs the effect twice
  const key = source ? JSON.stringify(source) : receipt ? `receipt-${receipt.id}` : ''
  const startedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      startedFor.current = null
      return
    }
    if (startedFor.current === key) return
    startedFor.current = key
    setDraft(null)
    setState(receipt ? formStateOfReceipt(receipt) : null)
    if (source) read.mutate(source)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opened file or receipt
  }, [open, key])

  const set = (patch: Partial<ReceiptFormState>) =>
    setState((current) => (current ? { ...current, ...patch } : current))

  const save = () => {
    if (!state) return
    const fields = fieldsOf(state)
    if ('error' in fields) {
      toast.error(fields.error)
      return
    }
    if (receipt) update.mutate({ ...fields, id: receipt.id })
    else if (source) create.mutate({ ...fields, source })
  }

  const saving = create.isPending || update.isPending
  const companyOptions = (companies.data ?? []).map((c) => ({ value: c.id, label: c.name }))
  const defaultName = defaultCompany.data?.name
  const extension = receipt?.fileName.toLowerCase().endsWith('.xml') ? '.xml' : '.pdf'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>
            {receipt ? 'Beleg bearbeiten' : 'Beleg speichern'}
            {position && position.count > 1 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {position.index + 1} von {position.count}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            Belege gehen unter ihrer Belegart an die DATEV-Adresse der eigenen Firma. Fotos werden
            als PDF gespeichert.
          </DialogDescription>
        </DialogHeader>

        {!state && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
            <Spinner /> Datei wird gelesen…
          </div>
        )}

        {state && (
          <div className="-mx-6 flex-1 space-y-4 overflow-y-auto px-6">
            {draft && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                {draft.sourceName && <span>{draft.sourceName}</span>}
                {draft.isEInvoice && <Badge variant="secondary">E-Rechnung</Badge>}
                {draft.isImage && <Badge variant="outline">wird als PDF gespeichert</Badge>}
              </div>
            )}

            <div>
              <Label htmlFor="receipt-file-name" className="mb-1 block">
                Dateiname
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="receipt-file-name"
                  value={state.fileName}
                  onChange={(e) => set({ fileName: e.target.value })}
                />
                <span className="text-sm text-muted-foreground">{extension}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Unter diesem Namen erscheint der Beleg in DATEV.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="receipt-category" className="mb-1 block">
                  Belegart
                </Label>
                <Select
                  value={state.category}
                  onValueChange={(value) => set({ category: value as ReceiptCategory })}
                >
                  <SelectTrigger id="receipt-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RECEIPT_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {RECEIPT_CATEGORY_LABELS[category]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="receipt-company" className="mb-1 block">
                  Eigene Firma
                </Label>
                <SearchableSelect<number>
                  id="receipt-company"
                  value={state.companyId ?? DEFAULT_COMPANY}
                  onChange={(value) =>
                    set({ companyId: value === null || value === DEFAULT_COMPANY ? null : value })
                  }
                  options={[
                    {
                      value: DEFAULT_COMPANY,
                      label: receipt
                        ? `Unverändert (${receipt.companyName || 'keine'})`
                        : `Standardfirma${defaultName ? ` (${defaultName})` : ''}`
                    },
                    ...companyOptions
                  ]}
                  searchPlaceholder="Firma suchen…"
                />
              </div>
              <div>
                <Label htmlFor="receipt-date" className="mb-1 block">
                  Belegdatum
                </Label>
                <Input
                  id="receipt-date"
                  type="date"
                  value={state.receiptDate}
                  onChange={(e) => set({ receiptDate: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <Label htmlFor="receipt-amount" className="mb-1 block">
                    Betrag (brutto)
                  </Label>
                  <Input
                    id="receipt-amount"
                    inputMode="decimal"
                    placeholder="0,00"
                    value={state.amount}
                    onChange={(e) => set({ amount: e.target.value })}
                  />
                </div>
                <div>
                  <Label htmlFor="receipt-currency" className="mb-1 block">
                    Währung
                  </Label>
                  <Input
                    id="receipt-currency"
                    maxLength={3}
                    value={state.currency}
                    onChange={(e) => set({ currency: e.target.value.toUpperCase() })}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="receipt-supplier" className="mb-1 block">
                  Lieferant (Firma)
                </Label>
                <SearchableSelect<number>
                  id="receipt-supplier"
                  value={state.supplierCompanyId}
                  onChange={(value) => set({ supplierCompanyId: value })}
                  options={companyOptions}
                  noneLabel="Keine Firma"
                  placeholder="Keine Firma"
                  searchPlaceholder="Firma suchen…"
                />
              </div>
              <div>
                <Label htmlFor="receipt-supplier-name" className="mb-1 block">
                  {state.supplierCompanyId
                    ? 'Lieferant (Name, falls abweichend)'
                    : 'Lieferant (Name)'}
                </Label>
                <Input
                  id="receipt-supplier-name"
                  value={state.supplierName}
                  placeholder="z. B. Deutsche Bahn"
                  onChange={(e) => set({ supplierName: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label htmlFor="receipt-reference" className="mb-1 block">
                  Rechnungs- / Belegnummer
                </Label>
                <Input
                  id="receipt-reference"
                  value={state.reference}
                  onChange={(e) => set({ reference: e.target.value })}
                />
              </div>
            </div>

            {draft?.isEInvoice && !state.supplierCompanyId && source && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-3 text-sm">
                <span className="flex-1 text-muted-foreground">
                  Der Rechnungssteller ist noch keine Firma in Bookingium.
                </span>
                <Button variant="outline" size="sm" onClick={() => setCreatingCompany(true)}>
                  <Building2 className="h-4 w-4" />
                  Firma aus E-Rechnung anlegen…
                </Button>
              </div>
            )}

            <div>
              <Label htmlFor="receipt-notes" className="mb-1 block">
                Notiz
              </Label>
              <Textarea
                id="receipt-notes"
                rows={2}
                value={state.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </div>

            {/* #246: uploaded in DATEV already, so it is not offered for a hand-over */}
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={state.inDatev}
                onChange={(e) => set({ inDatev: e.target.checked })}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                Schon direkt in DATEV hochgeladen
                <span className="block text-xs text-muted-foreground">
                  Der Beleg steht dann nicht mehr unter „Noch nicht an DATEV übergeben“.
                </span>
              </span>
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {position && position.count > 1 ? 'Überspringen' : 'Abbrechen'}
          </Button>
          <Button onClick={save} disabled={!state || saving}>
            {saving ? 'Wird gespeichert…' : 'Speichern'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {creatingCompany && source && (
        <EInvoiceCompanyDialog
          open
          onOpenChange={(next) => {
            if (!next) setCreatingCompany(false)
          }}
          source={source}
          onSaved={(companyId) => set({ supplierCompanyId: companyId })}
        />
      )}
    </Dialog>
  )
}
