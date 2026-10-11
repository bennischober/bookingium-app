import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { INVOICE_STATUS_LABELS, formatMoney, parseNumber, roundMoney } from '@/lib/invoiceLabels'
import { Button } from '@/components/ui/button'
import { InfoLabel } from '@/components/InfoLabel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type {
  InvoiceDto,
  InvoiceLineItemInput,
  InvoiceRecipientKind,
  InvoiceStatus,
  InvoiceTaxCode
} from '../../../../main/api/schemas/invoice.schema'

export type InvoiceLineDraft = {
  description: string
  quantity: string
  unit: string
  unitPriceNet: string
  taxRate: string
  taxCode: InvoiceTaxCode
}

const INVOICE_STATUS: InvoiceStatus[] = ['draft', 'issued', 'paid', 'overdue', 'cancelled']
const INVOICE_RECIPIENT_KIND: InvoiceRecipientKind[] = ['company', 'band', 'person', 'other']
const TAX_CODES: InvoiceTaxCode[] = ['standard', 'reduced', 'reverse_charge', 'exempt', 'other']

const RECIPIENT_KIND_LABELS: Record<InvoiceRecipientKind, string> = {
  company: 'Firma',
  band: 'Band',
  person: 'Person',
  other: 'Sonstige'
}

const TAX_CODE_LABELS: Record<InvoiceTaxCode, string> = {
  standard: 'Regelsatz',
  reduced: 'ermäßigt',
  reverse_charge: 'Reverse Charge',
  exempt: 'steuerfrei',
  other: 'sonstig'
}

const EMPTY_LINE: InvoiceLineDraft = {
  description: '',
  quantity: '1',
  unit: 'service',
  unitPriceNet: '0',
  taxRate: '19',
  taxCode: 'standard'
}

function normalizeLineItems(lines: InvoiceLineDraft[]): InvoiceLineItemInput[] {
  const normalized = lines
    .map((line) => {
      const quantity = Math.max(0.000001, parseNumber(line.quantity, 1))
      const unitPriceNet = Math.max(0, parseNumber(line.unitPriceNet, 0))
      const taxRate = Math.max(0, Math.min(100, parseNumber(line.taxRate, 0)))
      const description = line.description.trim() || 'Leistungsposition'

      return {
        description,
        quantity,
        unit: line.unit.trim() || 'service',
        unitPriceNet,
        taxRate,
        taxCode: line.taxCode
      } as InvoiceLineItemInput
    })
    .filter((line) => line.description || line.unitPriceNet > 0)

  return normalized.length > 0
    ? normalized
    : [
        {
          description: 'Leistungsposition',
          quantity: 1,
          unit: 'service',
          unitPriceNet: 0,
          taxRate: 0,
          taxCode: 'other'
        }
      ]
}

function computeTotals(lines: InvoiceLineItemInput[]) {
  const subtotalNetAmount = roundMoney(
    lines.reduce((sum, line) => sum + line.quantity * line.unitPriceNet, 0)
  )
  const subtotalTaxAmount = roundMoney(
    lines.reduce((sum, line) => {
      const lineNet = line.quantity * line.unitPriceNet
      return sum + (lineNet * line.taxRate) / 100
    }, 0)
  )
  const totalGrossAmount = roundMoney(subtotalNetAmount + subtotalTaxAmount)

  return {
    subtotalNetAmount,
    subtotalTaxAmount,
    totalGrossAmount
  }
}

export function InvoiceForm({
  mode,
  invoice,
  onCancel,
  onCreate,
  onUpdate,
  isSubmitting
}: {
  mode: 'create' | 'edit'
  invoice?: InvoiceDto
  onCancel: () => void
  onCreate: (payload: {
    dealMemoId?: number | null
    companyId?: number | null
    recipientKind?: InvoiceRecipientKind
    recipientCompanyId?: number | null
    recipientBandId?: number | null
    recipientPersonId?: number | null
    recipientNameOverride?: string
    periodStartDate?: string | null
    periodEndDate?: string | null
    periodLabel?: string
    issueDate?: string
    dueDate?: string | null
    status?: InvoiceStatus
    currency?: string
    lineItems?: InvoiceLineItemInput[]
    totalAmount?: number
    paymentTerms?: string
    reverseChargeNote?: string
    notes?: string
  }) => void
  onUpdate: (payload: {
    id: number
    dealMemoId?: number | null
    companyId?: number
    recipientKind?: InvoiceRecipientKind
    recipientCompanyId?: number | null
    recipientBandId?: number | null
    recipientPersonId?: number | null
    recipientNameOverride?: string
    periodStartDate?: string | null
    periodEndDate?: string | null
    periodLabel?: string
    issueDate?: string
    dueDate?: string | null
    status?: InvoiceStatus
    currency?: string
    lineItems?: InvoiceLineItemInput[]
    totalAmount?: number
    paymentTerms?: string
    reverseChargeNote?: string
    notes?: string
  }) => void
  isSubmitting: boolean
}) {
  const companies = trpcReact.company.getListItems.useQuery()
  const bands = trpcReact.band.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const events = trpcReact.dealMemo.getAllPaginated.useQuery({
    page: 1,
    pageSize: 100,
    search: undefined
  })

  // Form state initializes once from the invoice on mount. The parent remounts
  // this component (key=mode-id) when the sheet switches mode/target, so no
  // state-sync-in-effect is needed.
  const [dealMemoId, setDealMemoId] = useState<number | null>(
    mode === 'edit' ? (invoice?.dealMemoId ?? null) : null
  )
  const [companyId, setCompanyId] = useState<number | null | undefined>(
    mode === 'edit' ? invoice?.companyId : undefined
  )
  const [recipientKind, setRecipientKind] = useState<InvoiceRecipientKind>(
    mode === 'edit' ? (invoice?.recipientKind ?? 'company') : 'company'
  )
  const [recipientCompanyId, setRecipientCompanyId] = useState<number | null>(
    mode === 'edit' ? (invoice?.recipientCompanyId ?? null) : null
  )
  const [recipientBandId, setRecipientBandId] = useState<number | null>(
    mode === 'edit' ? (invoice?.recipientBandId ?? null) : null
  )
  const [recipientPersonId, setRecipientPersonId] = useState<number | null>(
    mode === 'edit' ? (invoice?.recipientPersonId ?? null) : null
  )
  const [recipientNameOverride, setRecipientNameOverride] = useState(
    mode === 'edit' && invoice?.recipientKind === 'other' ? invoice.recipientName : ''
  )
  const [periodStartDate, setPeriodStartDate] = useState(
    mode === 'edit' ? (invoice?.periodStartDate ?? '') : ''
  )
  const [periodEndDate, setPeriodEndDate] = useState(
    mode === 'edit' ? (invoice?.periodEndDate ?? '') : ''
  )
  const [periodLabel, setPeriodLabel] = useState(
    mode === 'edit' ? (invoice?.periodLabel ?? '') : ''
  )
  const [issueDate, setIssueDate] = useState(
    mode === 'edit' ? (invoice?.issueDate ?? '') : new Date().toISOString().slice(0, 10)
  )
  const [dueDate, setDueDate] = useState(mode === 'edit' ? (invoice?.dueDate ?? '') : '')
  const [status, setStatus] = useState<InvoiceStatus>(
    mode === 'edit' ? (invoice?.status ?? 'draft') : 'draft'
  )
  const [currency, setCurrency] = useState(mode === 'edit' ? (invoice?.currency ?? 'EUR') : 'EUR')
  const [paymentTerms, setPaymentTerms] = useState(
    mode === 'edit' ? (invoice?.paymentTerms ?? '') : ''
  )
  const [reverseChargeNote, setReverseChargeNote] = useState(
    mode === 'edit' ? (invoice?.reverseChargeNote ?? '') : ''
  )
  const [notes, setNotes] = useState(mode === 'edit' ? (invoice?.notes ?? '') : '')
  const [lineItems, setLineItems] = useState<InvoiceLineDraft[]>(() => {
    if (mode === 'edit' && invoice) {
      return invoice.lineItems.length > 0
        ? invoice.lineItems.map((line) => ({
            description: line.description,
            quantity: String(line.quantity),
            unit: line.unit,
            unitPriceNet: String(line.unitPriceNet),
            taxRate: String(line.taxRate),
            taxCode: line.taxCode
          }))
        : [
            {
              ...EMPTY_LINE,
              description: 'Leistungsposition',
              unitPriceNet: String(invoice.totalAmount),
              taxRate: '0'
            }
          ]
    }
    return [EMPTY_LINE]
  })
  const [step, setStep] = useState<'basics' | 'lines' | 'finalize'>('basics')
  const [editingLineIndex, setEditingLineIndex] = useState<number | null>(null)
  const [lineEditor, setLineEditor] = useState<InvoiceLineDraft>({ ...EMPTY_LINE })

  const normalizedLines = useMemo(() => normalizeLineItems(lineItems), [lineItems])
  const totals = useMemo(() => computeTotals(normalizedLines), [normalizedLines])

  const setLine = (patch: Partial<InvoiceLineDraft>) => {
    setLineEditor((prev) => ({ ...prev, ...patch }))
  }

  const openAddLine = () => {
    setEditingLineIndex(null)
    setLineEditor({ ...EMPTY_LINE })
  }

  const openEditLine = (index: number) => {
    setEditingLineIndex(index)
    setLineEditor({ ...lineItems[index] })
  }

  const saveLineEditor = () => {
    if (!lineEditor.description.trim()) {
      toast.error('Bitte eine Positionsbeschreibung eingeben')
      return
    }

    if (editingLineIndex === null) {
      setLineItems((prev) => [...prev, { ...lineEditor }])
      setLineEditor({ ...EMPTY_LINE })
      return
    }

    setLineItems((prev) =>
      prev.map((line, idx) => (idx === editingLineIndex ? { ...lineEditor } : line))
    )
    setEditingLineIndex(null)
    setLineEditor({ ...EMPTY_LINE })
  }

  const removeLine = (index: number) => {
    setLineItems((prev) => {
      if (prev.length === 1) {
        return [{ ...EMPTY_LINE }]
      }
      return prev.filter((_, i) => i !== index)
    })
    if (editingLineIndex === index) {
      setEditingLineIndex(null)
      setLineEditor({ ...EMPTY_LINE })
    }
  }

  const handleSubmit = () => {
    if (recipientKind === 'band' && !recipientBandId) {
      toast.error('Bitte eine Empfänger-Band auswählen')
      return
    }

    if (recipientKind === 'person' && !recipientPersonId) {
      toast.error('Bitte eine Empfänger-Person auswählen')
      return
    }

    if (recipientKind === 'other' && !recipientNameOverride.trim()) {
      toast.error('Bitte einen Empfängernamen eingeben')
      return
    }

    const payload = {
      dealMemoId,
      companyId: companyId ?? undefined,
      recipientKind,
      recipientCompanyId,
      recipientBandId,
      recipientPersonId,
      recipientNameOverride: recipientKind === 'other' ? recipientNameOverride.trim() : undefined,
      periodStartDate: periodStartDate || null,
      periodEndDate: periodEndDate || null,
      periodLabel,
      issueDate: issueDate || undefined,
      dueDate: dueDate || null,
      status,
      currency,
      lineItems: normalizedLines,
      totalAmount: totals.totalGrossAmount,
      paymentTerms,
      reverseChargeNote,
      notes
    }

    if (mode === 'create') {
      onCreate(payload)
      return
    }

    if (!invoice) return

    onUpdate({
      id: invoice.id,
      ...payload,
      companyId: companyId ?? undefined
    })
  }

  return (
    <div className="space-y-4">
      <Tabs
        value={step}
        onValueChange={(value) => setStep(value as 'basics' | 'lines' | 'finalize')}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="basics">1. Grunddaten</TabsTrigger>
          <TabsTrigger value="lines">2. Positionen</TabsTrigger>
          <TabsTrigger value="finalize">3. Abschließen</TabsTrigger>
        </TabsList>

        <TabsContent value="basics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rechnungsstatus</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as InvoiceStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {INVOICE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Der Status ist nur informativ. Sie können später alles weiter bearbeiten.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Währung</Label>
              <Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rechnungsdatum</Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Fälligkeitsdatum</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Event-Verknüpfung (optional)</Label>
              <Select
                value={dealMemoId?.toString() ?? 'none'}
                onValueChange={(value) => setDealMemoId(value === 'none' ? null : Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Event auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keine Event-Verknüpfung</SelectItem>
                  {(events.data?.items ?? []).map((event) => (
                    <SelectItem key={event.id} value={event.id.toString()}>
                      {event.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <InfoLabel
                text="Rechnungssteller"
                info="Wer bekommt das Geld? Dessen Bankdaten und Fußzeile erscheinen auf der Rechnung."
              />
              <Select
                value={
                  companyId !== undefined
                    ? companyId === null
                      ? 'none'
                      : companyId.toString()
                    : 'auto'
                }
                onValueChange={(value) => {
                  if (value === 'auto') {
                    setCompanyId(undefined)
                    return
                  }
                  if (value === 'none') {
                    setCompanyId(null)
                    return
                  }
                  setCompanyId(Number(value))
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Event/Standard)</SelectItem>
                  <SelectItem value="none">Keine explizite Auswahl</SelectItem>
                  {(companies.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <InfoLabel text="Rechnungsempfänger" info="Wer wird belastet? Zahlt diese Rechnung." />
            <Select
              value={recipientKind}
              onValueChange={(value) => {
                const nextKind = value as InvoiceRecipientKind
                setRecipientKind(nextKind)
                setRecipientCompanyId(null)
                setRecipientBandId(null)
                setRecipientPersonId(null)
                setRecipientNameOverride('')
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVOICE_RECIPIENT_KIND.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {RECIPIENT_KIND_LABELS[kind]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {recipientKind === 'company' && (
            <div className="space-y-2">
              <Label>Empfänger-Firma</Label>
              <Select
                value={recipientCompanyId === null ? 'none' : recipientCompanyId.toString()}
                onValueChange={(value) =>
                  setRecipientCompanyId(value === 'none' ? null : Number(value))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Automatisch" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Automatisch</SelectItem>
                  {(companies.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id.toString()}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {recipientKind === 'band' && (
            <div className="space-y-2">
              <Label>Empfänger-Band</Label>
              <Select
                value={recipientBandId?.toString() ?? ''}
                onValueChange={(value) => setRecipientBandId(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Band auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {(bands.data ?? []).map((b) => (
                    <SelectItem key={b.id} value={b.id.toString()}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {recipientKind === 'person' && (
            <div className="space-y-2">
              <Label>Empfänger-Person</Label>
              <Select
                value={recipientPersonId?.toString() ?? ''}
                onValueChange={(value) => setRecipientPersonId(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Person auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {(persons.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>
                      {p.firstName} {p.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {recipientKind === 'other' && (
            <div className="space-y-2">
              <Label>Empfängername</Label>
              <Input
                value={recipientNameOverride}
                onChange={(e) => setRecipientNameOverride(e.target.value)}
                placeholder="Empfängername eingeben"
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Zeitraum von</Label>
              <Input
                type="date"
                value={periodStartDate}
                onChange={(e) => setPeriodStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Zeitraum bis</Label>
              <Input
                type="date"
                value={periodEndDate}
                onChange={(e) => setPeriodEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Zeitraum-Bezeichnung</Label>
              <Input
                placeholder="z. B. Q4 2025"
                value={periodLabel}
                onChange={(e) => setPeriodLabel(e.target.value)}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="button" onClick={() => setStep('lines')}>
              Weiter: Positionen
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="lines" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <Label>Positionen</Label>
            <Button type="button" variant="outline" size="sm" onClick={openAddLine}>
              <Plus className="h-4 w-4 mr-1" />
              Position hinzufügen
            </Button>
          </div>

          <div className="space-y-2">
            {lineItems.map((line, index) => {
              const quantity = parseNumber(line.quantity, 1)
              const unitPrice = parseNumber(line.unitPriceNet, 0)
              const taxRate = parseNumber(line.taxRate, 0)
              const net = roundMoney(quantity * unitPrice)
              const gross = roundMoney(net + (net * taxRate) / 100)

              return (
                <div
                  key={`line-card-${index}`}
                  className="border rounded-md p-3 flex items-start justify-between gap-3"
                >
                  <div>
                    <p className="font-medium text-sm">{line.description || 'Ohne Bezeichnung'}</p>
                    <p className="text-xs text-muted-foreground">
                      {quantity} x {formatMoney(unitPrice, currency)} ({taxRate}% MwSt.,{' '}
                      {TAX_CODE_LABELS[line.taxCode]})
                    </p>
                    <p className="text-xs mt-1">
                      Netto {formatMoney(net, currency)} · Brutto {formatMoney(gross, currency)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openEditLine(index)}
                    >
                      Bearbeiten
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeLine(index)}
                    >
                      Entfernen
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="border rounded-md p-3 space-y-3">
            <p className="text-sm font-medium">
              {editingLineIndex === null
                ? 'Position hinzufügen'
                : `Position #${editingLineIndex + 1} bearbeiten`}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1 md:col-span-2">
                <Label>Beschreibung</Label>
                <Input
                  value={lineEditor.description}
                  onChange={(e) => setLine({ description: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Menge</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={lineEditor.quantity}
                  onChange={(e) => setLine({ quantity: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Einheit</Label>
                <Input
                  value={lineEditor.unit}
                  onChange={(e) => setLine({ unit: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Netto-Einzelpreis</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={lineEditor.unitPriceNet}
                  onChange={(e) => setLine({ unitPriceNet: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>MwSt. %</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={lineEditor.taxRate}
                  onChange={(e) => setLine({ taxRate: e.target.value })}
                />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Steuerschlüssel</Label>
                <Select
                  value={lineEditor.taxCode}
                  onValueChange={(value) => setLine({ taxCode: value as InvoiceTaxCode })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TAX_CODES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {TAX_CODE_LABELS[code]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditingLineIndex(null)
                  setLineEditor({ ...EMPTY_LINE })
                }}
              >
                Zurücksetzen
              </Button>
              <Button type="button" onClick={saveLineEditor}>
                {editingLineIndex === null ? 'Position hinzufügen' : 'Position speichern'}
              </Button>
            </div>
          </div>

          <div className="flex justify-between">
            <Button type="button" variant="outline" onClick={() => setStep('basics')}>
              Zurück
            </Button>
            <Button type="button" onClick={() => setStep('finalize')}>
              Weiter: Abschließen
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="finalize" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Zwischensumme netto</Label>
              <Input value={formatMoney(totals.subtotalNetAmount, currency)} readOnly />
            </div>
            <div className="space-y-2">
              <Label>Steuerbetrag</Label>
              <Input value={formatMoney(totals.subtotalTaxAmount, currency)} readOnly />
            </div>
            <div className="space-y-2">
              <Label>Gesamt brutto</Label>
              <Input value={formatMoney(totals.totalGrossAmount, currency)} readOnly />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Zahlungsbedingungen</Label>
            <Input
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="z. B. Zahlbar innerhalb von 14 Tagen"
            />
          </div>

          <div className="space-y-2">
            <Label>Reverse-Charge-Hinweis</Label>
            <Input
              value={reverseChargeNote}
              onChange={(e) => setReverseChargeNote(e.target.value)}
              placeholder="Optionaler Steuerhinweis"
            />
          </div>

          <div className="space-y-2">
            <Label>Anmerkungen</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          <div className="flex justify-between gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setStep('lines')}>
              Zurück
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                Abbrechen
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
                {mode === 'create' ? 'Rechnung anlegen' : 'Rechnung speichern'}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
