import { SearchableSelect } from '@/components/ui/searchable-select'
import { useMemo, useState } from 'react'
import { useReportUnsavedChanges } from '@/components/formGuard'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { INVOICE_STATUS_LABELS } from '@/lib/invoiceLabels'
import { Button } from '@/components/ui/button'
import { FormActions } from '@/components/forms/FormActions'
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
  InvoiceStatus
} from '../../../../main/api/schemas/invoice.schema'
import { confirmAction } from '@/lib/confirm'
import { EInvoiceStatus } from '@/components/invoice/EInvoiceStatus'
import { InvoiceEInvoiceDetails } from '@/components/invoice/InvoiceEInvoiceDetails'
import { InvoiceLineItems } from '@/components/invoice/InvoiceLineItems'
import { InvoiceRecipientFields } from '@/components/invoice/InvoiceRecipientFields'
import { InvoiceTotals } from '@/components/invoice/InvoiceTotals'
import {
  INVOICE_FORM_STATUSES,
  computeTotals,
  initialLines,
  initialRecipient,
  normalizeLineItems,
  recipientError,
  recipientPayload,
  type InvoiceLineDraft,
  type RecipientDraft
} from '@/components/invoice/invoiceFormState'
import { useInvoiceEInvoiceCheck } from '@/hooks/useInvoiceEInvoiceCheck'
import { useInvoiceLineEditor } from '@/hooks/useInvoiceLineEditor'
import { TAX_NOTE_PRESETS } from '../../../../main/einvoice/codes'
import { INVOICE_CURRENCIES } from '../../../../main/invoice/money'
import { t } from '../../../../main/i18n/translate'

type InvoiceFormStep = 'basics' | 'lines' | 'finalize'

/** What the form saves, for a new invoice and an edited draft alike */
type InvoiceFormPayload = {
  dealMemoId?: number | null
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
  buyerReference?: string
  xrechnung?: boolean
  notes?: string
}

/**
 * Create or edit an invoice draft in three steps: basics (dates, event,
 * issuer, recipient), line items, and finalize (totals, terms, e-invoice
 * check). Issuing from here asks first: it assigns the number and locks it.
 */
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
  onCreate: (payload: InvoiceFormPayload & { companyId?: number | null }) => void
  onUpdate: (payload: InvoiceFormPayload & { id: number; companyId?: number }) => void
  isSubmitting: boolean
}) {
  const companies = trpcReact.company.getListItems.useQuery()
  const events = trpcReact.dealMemo.getAllPaginated.useQuery({
    page: 1,
    pageSize: 100,
    search: undefined
  })

  // Form state initializes once from the invoice on mount. The parent remounts
  // this component (key=mode-id) when the sheet switches mode/target, so no
  // state-sync-in-effect is needed. State the steps edit lives here, not in the
  // step components: inactive tabs unmount.
  const edited = mode === 'edit' ? invoice : undefined
  const [dealMemoId, setDealMemoId] = useState<number | null>(edited?.dealMemoId ?? null)
  const [companyId, setCompanyId] = useState<number | null | undefined>(edited?.companyId)
  const [recipient, setRecipient] = useState<RecipientDraft>(() => initialRecipient(edited))
  const [periodStartDate, setPeriodStartDate] = useState(edited?.periodStartDate ?? '')
  const [periodEndDate, setPeriodEndDate] = useState(edited?.periodEndDate ?? '')
  const [periodLabel, setPeriodLabel] = useState(edited?.periodLabel ?? '')
  const [issueDate, setIssueDate] = useState(
    mode === 'edit' ? (invoice?.issueDate ?? '') : new Date().toISOString().slice(0, 10)
  )
  const [dueDate, setDueDate] = useState(edited?.dueDate ?? '')
  const [status, setStatus] = useState<InvoiceStatus>(edited?.status ?? 'draft')
  const [currency, setCurrency] = useState(edited?.currency ?? 'EUR')
  // A stored code outside the list stays selectable, so editing never changes it unasked
  const offered: readonly string[] = INVOICE_CURRENCIES
  const currencies = offered.includes(currency) ? offered : [...offered, currency]
  const [paymentTerms, setPaymentTerms] = useState(edited?.paymentTerms ?? '')
  const [reverseChargeNote, setReverseChargeNote] = useState(edited?.reverseChargeNote ?? '')
  const [buyerReference, setBuyerReference] = useState(edited?.buyerReference ?? '')
  const [xrechnung, setXrechnung] = useState(edited?.xrechnung ?? false)
  // E-invoice details are rarely needed: folded away unless in use
  const [eInvoiceDetailsOpen, setEInvoiceDetailsOpen] = useState(
    Boolean(buyerReference) || xrechnung
  )
  const [notes, setNotes] = useState(edited?.notes ?? '')
  // #246: issued here, but written in DATEV already: DATEV's number instead of the next one
  const [createdInDatev, setCreatedInDatev] = useState(false)
  const [datevNumber, setDatevNumber] = useState('')
  const [lineItems, setLineItems] = useState<InvoiceLineDraft[]>(() => initialLines(edited))
  const lineEditor = useInvoiceLineEditor(lineItems, setLineItems)
  const [step, setStep] = useState<InvoiceFormStep>('basics')

  const normalizedLines = useMemo(() => normalizeLineItems(lineItems), [lineItems])
  const totals = useMemo(() => computeTotals(normalizedLines), [normalizedLines])

  // E-invoice check with the parties as issuing would freeze them
  const eInvoice = useInvoiceEInvoiceCheck({
    parties: { dealMemoId, companyId: companyId ?? null, ...recipientPayload(recipient) },
    draft: {
      issueDate,
      dueDate: dueDate || null,
      currency,
      buyerReference,
      periodStartDate: periodStartDate || null,
      periodEndDate: periodEndDate || null,
      eventDate: events.data?.items.find((event) => event.id === dealMemoId)?.date ?? null,
      paymentTerms,
      taxNote: reverseChargeNote,
      notes,
      lines: normalizedLines,
      xrechnung
    },
    active: step === 'finalize'
  })

  const payload = {
    dealMemoId,
    companyId: companyId ?? undefined,
    ...recipientPayload(recipient),
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
    buyerReference: buyerReference.trim(),
    xrechnung,
    notes,
    ...(status === 'issued' && createdInDatev
      ? {
          createdInDatev: true,
          datevInvoiceNumber: /^d+$/.test(datevNumber.trim()) ? Number(datevNumber.trim()) : null
        }
      : {})
  }
  // what was there when the form opened, to tell the surrounding sheet about unsaved changes
  const [openedWith] = useState(() => JSON.stringify(payload))
  useReportUnsavedChanges(JSON.stringify(payload) !== openedWith)

  const handleSubmit = async () => {
    const recipientProblem = recipientError(recipient)
    if (recipientProblem) {
      toast.error(recipientProblem)
      return
    }

    if (status === 'issued' && createdInDatev && !/^d+$/.test(datevNumber.trim())) {
      toast.error(t('Bitte die Rechnungsnummer aus DATEV eintragen (nur Ziffern).'))
      return
    }

    if (
      status === 'issued' &&
      !(await confirmAction({
        title: t('Rechnung jetzt stellen?'),
        description: createdInDatev
          ? t(
              'Sie erhält die Nummer {{datevNumber}} aus DATEV und kann danach nicht mehr bearbeitet oder gelöscht werden. An DATEV wird sie nicht mehr übergeben.',
              { datevNumber: datevNumber.trim() }
            )
          : t(
              'Sie erhält die nächste Rechnungsnummer und kann danach nicht mehr bearbeitet oder gelöscht werden.'
            ),
        confirmLabel: t('Rechnung stellen')
      }))
    ) {
      return
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
      <Tabs value={step} onValueChange={(value) => setStep(value as InvoiceFormStep)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="basics">{t('1. Grunddaten')}</TabsTrigger>
          <TabsTrigger value="lines">{t('2. Positionen')}</TabsTrigger>
          <TabsTrigger value="finalize">{t('3. Abschließen')}</TabsTrigger>
        </TabsList>

        <TabsContent value="basics" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('Rechnungsstatus')}</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as InvoiceStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_FORM_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {INVOICE_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {status === 'draft'
                  ? t('Entwürfe bleiben bearbeitbar und erhalten noch keine Rechnungsnummer.')
                  : t(
                      'Beim Stellen wird die nächste Rechnungsnummer vergeben; danach ist die Rechnung gesperrt.'
                    )}
              </p>
              {status === 'issued' && (
                <div className="space-y-2 rounded-md border p-3">
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-primary"
                      checked={createdInDatev}
                      onChange={(e) => setCreatedInDatev(e.target.checked)}
                    />
                    <span>
                      {t('Rechnung schon in DATEV erstellt')}
                      <span className="block text-xs text-muted-foreground">
                        {t(
                          'Sie bekommt die Nummer aus DATEV und wird nicht mehr an DATEV übergeben. Bookingium zählt danach oberhalb dieser Nummer weiter.'
                        )}
                      </span>
                    </span>
                  </label>
                  {createdInDatev && (
                    <div className="space-y-1">
                      <Label htmlFor="invoice-datev-number">{t('Rechnungsnummer aus DATEV')}</Label>
                      <Input
                        id="invoice-datev-number"
                        inputMode="numeric"
                        value={datevNumber}
                        onChange={(e) => setDatevNumber(e.target.value)}
                        placeholder="z. B. 2026042"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('Währung')}</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t('Rechnungsdatum')}</Label>
              <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t('Fälligkeitsdatum')}</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="invoice-event">{t('Event-Verknüpfung (optional)')}</Label>
              <SearchableSelect
                id="invoice-event"
                value={dealMemoId}
                onChange={setDealMemoId}
                options={(events.data?.items ?? []).map((event) => ({
                  value: event.id,
                  label: event.name,
                  hint: event.date
                }))}
                noneLabel={t('Keine Event-Verknüpfung')}
                searchPlaceholder={t('Event suchen…')}
              />
            </div>

            <div className="space-y-2">
              <InfoLabel
                text={t('Rechnungssteller')}
                info={t(
                  'Wer bekommt das Geld? Dessen Bankdaten und Fußzeile erscheinen auf der Rechnung.'
                )}
              />
              <SearchableSelect<string>
                aria-label={t('Rechnungssteller')}
                value={
                  companyId !== undefined
                    ? companyId === null
                      ? 'none'
                      : companyId.toString()
                    : 'auto'
                }
                onChange={(value) => {
                  if (value === null || value === 'auto') setCompanyId(undefined)
                  else if (value === 'none') setCompanyId(null)
                  else setCompanyId(Number(value))
                }}
                options={[
                  { value: 'auto', label: t('Auto (Event/Standard)') },
                  { value: 'none', label: t('Keine explizite Auswahl') },
                  ...(companies.data ?? []).map((c) => ({ value: c.id.toString(), label: c.name }))
                ]}
                searchPlaceholder={t('Firma suchen…')}
              />
            </div>
          </div>

          <InvoiceRecipientFields recipient={recipient} onChange={setRecipient} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t('Zeitraum von')}</Label>
              <Input
                type="date"
                value={periodStartDate}
                onChange={(e) => setPeriodStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('Zeitraum bis')}</Label>
              <Input
                type="date"
                value={periodEndDate}
                onChange={(e) => setPeriodEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('Zeitraum-Bezeichnung')}</Label>
              <Input
                placeholder="z. B. Q4 2025"
                value={periodLabel}
                onChange={(e) => setPeriodLabel(e.target.value)}
              />
            </div>
          </div>

          <InvoiceEInvoiceDetails
            open={eInvoiceDetailsOpen}
            onOpenChange={setEInvoiceDetailsOpen}
            buyerReference={buyerReference}
            onBuyerReferenceChange={setBuyerReference}
            xrechnung={xrechnung}
            onXrechnungChange={setXrechnung}
          />

          <FormActions>
            <Button type="button" onClick={() => setStep('lines')}>
              {t('Weiter: Positionen')}
            </Button>
          </FormActions>
        </TabsContent>

        <TabsContent value="lines" className="space-y-4 mt-4">
          <InvoiceLineItems lines={lineItems} editor={lineEditor} currency={currency} />

          <FormActions className="justify-between">
            <Button type="button" variant="outline" onClick={() => setStep('basics')}>
              {t('Zurück')}
            </Button>
            <Button type="button" onClick={() => setStep('finalize')}>
              {t('Weiter: Abschließen')}
            </Button>
          </FormActions>
        </TabsContent>

        <TabsContent value="finalize" className="space-y-4 mt-4">
          <InvoiceTotals totals={totals} currency={currency} />

          <div className="space-y-2">
            <Label>{t('Zahlungsbedingungen')}</Label>
            <Input
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder={t('z. B. Zahlbar innerhalb von 14 Tagen')}
            />
          </div>

          <div className="space-y-2">
            <InfoLabel
              htmlFor="invoice-tax-note"
              text={t('Steuerhinweis')}
              info={t(
                'Steht auf der Rechnung, z. B. „Steuerschuldnerschaft des Leistungsempfängers“ oder der Grund einer Steuerbefreiung (§ 4 Nr. 20 a UStG). Die E-Rechnung übernimmt ihn als Befreiungsgrund.'
              )}
            />
            <Input
              id="invoice-tax-note"
              value={reverseChargeNote}
              onChange={(e) => setReverseChargeNote(e.target.value)}
              placeholder={t('Reverse Charge oder Grund der Steuerbefreiung')}
            />
            <div className="flex flex-wrap gap-2">
              {TAX_NOTE_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  title={preset.text}
                  onClick={() => setReverseChargeNote(preset.text)}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('Anmerkungen')}</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          {eInvoice.enabled && eInvoice.check && <EInvoiceStatus check={eInvoice.check} />}

          <FormActions className="justify-between">
            <Button type="button" variant="outline" onClick={() => setStep('lines')}>
              {t('Zurück')}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
                {t('Abbrechen')}
              </Button>
              <Button type="button" onClick={handleSubmit} disabled={isSubmitting}>
                {status === 'issued'
                  ? t('Rechnung stellen')
                  : mode === 'create'
                    ? t('Entwurf anlegen')
                    : t('Entwurf speichern')}
              </Button>
            </div>
          </FormActions>
        </TabsContent>
      </Tabs>
    </div>
  )
}
