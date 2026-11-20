import { SearchableSelect } from '@/components/ui/searchable-select'
import { useEffect, useRef, useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { useSyncedState, useSyncedStateByKey } from '@/hooks/useSyncedState'
import { InvoiceEditSheet } from '@/components/invoice/InvoiceEditSheet'
import { InvoiceRowActions } from '@/components/invoice/InvoiceRowActions'
import { formatMoney, invoiceNumberLabel } from '@/lib/invoiceLabels'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { InvoiceStatusBadge } from '@/components/invoice/InvoiceStatusBadge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Euro, FileText, FileSignature, Plus, Trash2 } from 'lucide-react'
import { formatShortDate } from '@/lib/utils'
import { toast } from '@/lib/toast'
import type { DealMemoDetailDto } from 'src/main/api/schemas/deal_memo.schema'
import { ReadOnlyField } from './ReadOnlyField'
import { ExternalDoneToggle } from './ExternalDoneToggle'
import {
  depositsChanged,
  depositSummary,
  fromDepositDrafts,
  toDepositDrafts,
  type DepositDraft
} from './depositDrafts'
import { t } from '../../../../main/i18n/translate'

export interface FinancialsTabProps {
  event: DealMemoDetailDto
  isEditing: boolean
  saveSignal: number
  cancelSignal: number
}

export function FinancialsTab({ event, isEditing, saveSignal, cancelSignal }: FinancialsTabProps) {
  const utils = trpcReact.useUtils()
  const lastSaveSignal = useRef(saveSignal)
  const [openInvoiceId, setOpenInvoiceId] = useState<number | null>(null)

  const [deal, setDeal] = useSyncedState(event.deal ?? '')
  const [vvk, setVvk] = useSyncedState(event.ticketPriceVvk?.toString() ?? '')
  const [ak, setAk] = useSyncedState(event.ticketPriceAk?.toString() ?? '')
  const [posters, setPosters] = useSyncedState(event.posters ?? '')
  const [invoiceCompanyId, setInvoiceCompanyId] = useSyncedState<number | null>(
    event.invoiceCompanyId ?? null
  )

  const companies = trpcReact.company.getListItems.useQuery()
  const companyOptions = (companies.data ?? []).map((company) => ({
    value: company.id,
    label: company.name
  }))
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery()
  const invoices = trpcReact.invoice.getByDealMemoId.useQuery(event.id)

  const isDealDirty = deal !== (event.deal ?? '')
  const isPricesDirty =
    (parseFloat(vvk) || null) !== event.ticketPriceVvk ||
    (parseFloat(ak) || null) !== event.ticketPriceAk
  const isPostersDirty = posters !== (event.posters ?? '')
  const isInvoiceCompanyDirty = invoiceCompanyId !== (event.invoiceCompanyId ?? null)
  const [guaranteeAmount, setGuaranteeAmount] = useSyncedState(
    event.guaranteeAmount?.toString() ?? ''
  )
  const [guaranteeVatRate, setGuaranteeVatRate] = useSyncedState(
    event.guaranteeVatRate?.toString() ?? ''
  )
  // Contract "Vorkasse": any number of prepayments on the fee; an empty due date = on signing
  const [deposits, setDeposits] = useSyncedStateByKey(
    toDepositDrafts(event.deposits),
    JSON.stringify(event.deposits)
  )
  const updateDeposit = (index: number, change: Partial<DepositDraft>) =>
    setDeposits((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)))
  const [contractNotes, setContractNotes] = useSyncedState(event.contractNotes ?? '')
  // #201: contract sent / back signed; a contract sent but not back is an open point
  const [contractSentAt, setContractSentAt] = useSyncedState(event.contractSentAt ?? '')
  const [contractReturnedAt, setContractReturnedAt] = useSyncedState(event.contractReturnedAt ?? '')
  // Contract "vertreten durch" override; null = band management / default
  const [representingCompanyId, setRepresentingCompanyId] = useSyncedState<number | null>(
    event.representingCompanyId ?? null
  )
  const isContractDirty =
    (parseFloat(guaranteeAmount) || null) !== event.guaranteeAmount ||
    (parseFloat(guaranteeVatRate) || null) !== event.guaranteeVatRate ||
    depositsChanged(deposits, event.deposits) ||
    contractNotes !== (event.contractNotes ?? '') ||
    contractSentAt !== (event.contractSentAt ?? '') ||
    contractReturnedAt !== (event.contractReturnedAt ?? '') ||
    representingCompanyId !== (event.representingCompanyId ?? null)
  const isDirty =
    isDealDirty || isPricesDirty || isPostersDirty || isInvoiceCompanyDirty || isContractDirty

  // Reset to server values when cancel is triggered
  useEffect(() => {
    if (cancelSignal > 0) {
      setDeal(event.deal ?? '')
      setVvk(event.ticketPriceVvk?.toString() ?? '')
      setAk(event.ticketPriceAk?.toString() ?? '')
      setPosters(event.posters ?? '')
      setInvoiceCompanyId(event.invoiceCompanyId ?? null)
      setGuaranteeAmount(event.guaranteeAmount?.toString() ?? '')
      setGuaranteeVatRate(event.guaranteeVatRate?.toString() ?? '')
      setDeposits(toDepositDrafts(event.deposits))
      setContractNotes(event.contractNotes ?? '')
      setContractSentAt(event.contractSentAt ?? '')
      setContractReturnedAt(event.contractReturnedAt ?? '')
      setRepresentingCompanyId(event.representingCompanyId ?? null)
    }
  }, [cancelSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = trpcReact.dealMemo.update.useMutation({
    onSuccess: () => {
      utils.dealMemo.getById.invalidate(event.id)
      utils.dashboard.openItems.invalidate()
      toast.success(t('Gespeichert'))
    },
    onError: (e) => toast.error(t('Speichern fehlgeschlagen'), { description: e.message })
  })

  // Batched save triggered by "Save All" in the page header
  const handleSaveAll = () => {
    updateMutation.mutate({
      id: event.id,
      deal: deal || undefined,
      ticketPriceVvk: vvk ? parseFloat(vvk) : null,
      ticketPriceAk: ak ? parseFloat(ak) : null,
      posters: posters || undefined,
      invoiceCompanyId,
      guaranteeAmount: guaranteeAmount ? parseFloat(guaranteeAmount) : null,
      guaranteeVatRate: guaranteeVatRate ? parseFloat(guaranteeVatRate) : null,
      deposits: fromDepositDrafts(deposits),
      contractNotes: contractNotes,
      contractSentAt: contractSentAt || null,
      contractReturnedAt: contractReturnedAt || null,
      representingCompanyId
    })
  }

  // Save when the page-level "Save All" fires
  useEffect(() => {
    if (saveSignal === lastSaveSignal.current) return
    lastSaveSignal.current = saveSignal
    if (isDirty) handleSaveAll()
  }, [saveSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Creates an empty draft (no number yet) and opens it right away
  const createInvoiceMutation = trpcReact.invoice.createForDealMemo.useMutation({
    onSuccess: (created) => {
      utils.invoice.invalidate()
      utils.dealMemo.getById.invalidate(event.id)
      utils.dashboard.invalidate()
      setOpenInvoiceId(created.id)
      toast.success(t('Entwurf für dieses Event angelegt'))
    },
    onError: (error) => {
      toast.error(t('Rechnung konnte nicht erstellt werden'), { description: error.message })
    }
  })

  // Who represents the band when the event sets no override
  const bandManagementName = companies.data?.find(
    (c) => c.id === event.band?.managementCompanyId
  )?.name
  const defaultRepresentationName = bandManagementName
    ? t('{{bandManagementName}} (Management der Band)', { bandManagementName })
    : (defaultCompany.data?.name ?? t('keine Standard-Firma'))
  const representingCompanyName = companies.data?.find((c) => c.id === representingCompanyId)?.name

  const selectedInvoiceCompany = companies.data?.find((c) => c.id === invoiceCompanyId)
  const defaultInvoiceCompanyName = defaultCompany.data?.name ?? t('Nicht konfiguriert')

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* ── Left Column: Deal & Marketing ── */}
      <div className="space-y-6">
        {/* ── Deal terms ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            {t('Deal')}
          </h3>
          {isEditing ? (
            <div className="space-y-2">
              <Label htmlFor="deal-terms">{t('Konditionen')}</Label>
              <Input
                id="deal-terms"
                placeholder={t('z. B. 70/30, Pauschale 2 000 €, Garantie 1 500 € + 80 %…')}
                value={deal}
                onChange={(e) => setDeal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('Die finanzielle Aufteilung oder Gagenvereinbarung für diese Show.')}
              </p>
            </div>
          ) : (
            <ReadOnlyField
              label={t('Konditionen')}
              value={deal}
              placeholder={t('Keine Konditionen hinterlegt')}
            />
          )}
        </div>

        <Separator />

        {/* ── Posters / marketing ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            {t('Marketing')}
          </h3>
          {isEditing ? (
            <div className="space-y-2">
              <Label htmlFor="posters">{t('Plakate')}</Label>
              <Input
                id="posters"
                placeholder={t('z. B. 50× A1, 100× A3 Flyer…')}
                value={posters}
                onChange={(e) => setPosters(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {t('Welche Printmaterialien müssen für diese Show bereitgestellt werden?')}
              </p>
            </div>
          ) : (
            <ReadOnlyField
              label={t('Plakate')}
              value={posters}
              placeholder={t('Keine Plakat-Details')}
            />
          )}
        </div>
      </div>

      {/* ── Right Column: Ticket Prices ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Euro className="h-4 w-4" />
          {t('Ticketpreise')}
        </h3>
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vvk">{t('Vorverkauf (VVK)')}</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  €
                </span>
                <Input
                  id="vvk"
                  type="number"
                  step="0.01"
                  min="0"
                  className="pl-7"
                  placeholder="0.00"
                  value={vvk}
                  onChange={(e) => setVvk(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ak">{t('Abendkasse (AK)')}</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  €
                </span>
                <Input
                  id="ak"
                  type="number"
                  step="0.01"
                  min="0"
                  className="pl-7"
                  placeholder="0.00"
                  value={ak}
                  onChange={(e) => setAk(e.target.value)}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <ReadOnlyField
              label={t('Vorverkauf (VVK)')}
              value={vvk ? formatMoney(parseFloat(vvk), 'EUR') : null}
              placeholder={t('Nicht festgelegt')}
            />
            <ReadOnlyField
              label={t('Abendkasse (AK)')}
              value={ak ? formatMoney(parseFloat(ak), 'EUR') : null}
              placeholder={t('Nicht festgelegt')}
            />
          </div>
        )}
      </div>

      <div className="md:col-span-2 space-y-4">
        <Separator />

        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <FileSignature className="h-4 w-4" />
            {t('Vertrag (Gage)')}
          </h3>
          <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
            <ExternalDoneToggle eventId={event.id} step="contract" />
            <ExternalDoneToggle eventId={event.id} step="deposit" />
          </div>
          {isEditing ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <div className="space-y-2">
                <Label htmlFor="guarantee-amount">{t('Garantiezahlung (netto, €)')}</Label>
                <Input
                  id="guarantee-amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="z. B. 4000"
                  value={guaranteeAmount}
                  onChange={(e) => setGuaranteeAmount(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Erscheint im Auftrittsvertrag als vereinbarte Gage')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="guarantee-vat">{t('MwSt.-Satz der Gage (%)')}</Label>
                <Input
                  id="guarantee-vat"
                  type="number"
                  step="0.5"
                  min="0"
                  max="100"
                  placeholder="z. B. 7"
                  value={guaranteeVatRate}
                  onChange={(e) => setGuaranteeVatRate(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Leer oder 0 = keine MwSt. ausweisen')}
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                {/* A heading, not a <Label>: it labels no single control, and the inline
                    <label> put the add button next to it */}
                <p className="text-sm font-medium leading-none">{t('Vorkasse')}</p>
                {deposits.map((deposit, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label
                        htmlFor={`deposit-${index}-amount`}
                        className="text-xs text-muted-foreground"
                      >
                        {index + 1}
                        {t('. Vorkasse (netto, €)')}
                      </Label>
                      <Input
                        id={`deposit-${index}-amount`}
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="z. B. 1000"
                        value={deposit.amount}
                        onChange={(e) => updateDeposit(index, { amount: e.target.value })}
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label
                        htmlFor={`deposit-${index}-due`}
                        className="text-xs text-muted-foreground"
                      >
                        {t('Fällig am (leer = bei Vertragsabschluss)')}
                      </Label>
                      <Input
                        id={`deposit-${index}-due`}
                        type="date"
                        value={deposit.dueDate}
                        onChange={(e) => updateDeposit(index, { dueDate: e.target.value })}
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label
                        htmlFor={`deposit-${index}-paid`}
                        className="text-xs text-muted-foreground"
                      >
                        {t('Bezahlt am (leer = offen)')}
                      </Label>
                      <Input
                        id={`deposit-${index}-paid`}
                        type="date"
                        value={deposit.paidAt}
                        onChange={(e) => updateDeposit(index, { paidAt: e.target.value })}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`${index + 1}. Vorkasse entfernen`}
                      title={t('Vorkasse entfernen')}
                      onClick={() => setDeposits((rows) => rows.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDeposits((rows) => [...rows, { amount: '', dueDate: '', paidAt: '' }])
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  {t('Vorkasse hinzufügen')}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'Mit einer Vorkasse erhält der Vertrag den Abschnitt „Vorkasse“ nach der Abrechnung; ohne entfällt er und die folgenden Punkte rücken auf. Zeilen ohne Betrag werden nicht gespeichert.'
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-sent-at">{t('Vertrag verschickt am')}</Label>
                <Input
                  id="contract-sent-at"
                  type="date"
                  value={contractSentAt}
                  onChange={(e) => setContractSentAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Wird gesetzt, wenn der Vertrag aus Bookingium verschickt wird')}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-returned-at">{t('Unterschrieben zurück am')}</Label>
                <Input
                  id="contract-returned-at"
                  type="date"
                  value={contractReturnedAt}
                  onChange={(e) => setContractReturnedAt(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Bis dahin steht der Vertrag unter „Offene Punkte“')}
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="event-representing-company">
                  {t('Vertreten durch (Management)')}
                </Label>
                <SearchableSelect
                  id="event-representing-company"
                  className="max-w-md"
                  value={representingCompanyId}
                  onChange={setRepresentingCompanyId}
                  options={companyOptions}
                  noneLabel={t('Standard: {{defaultRepresentationName}}', {
                    defaultRepresentationName
                  })}
                  searchPlaceholder={t('Firma suchen…')}
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    'Vertritt die Band in diesem Vertrag (Briefkopf, „vertreten durch“, Unterschrift VP1). Nur setzen, wenn es vom Management der Band abweicht.'
                  )}
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="contract-notes">{t('Sondervereinbarungen (Vertrag)')}</Label>
                <Textarea
                  id="contract-notes"
                  rows={3}
                  placeholder={t('Zusätzliche vertragliche Vereinbarungen für dieses Event…')}
                  value={contractNotes}
                  onChange={(e) => setContractNotes(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Wird im Vertrag als Abschnitt „Sondervereinbarungen“ angehängt.')}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <ReadOnlyField
                label={t('Garantiezahlung (netto)')}
                value={guaranteeAmount ? formatMoney(parseFloat(guaranteeAmount), 'EUR') : null}
                placeholder={t('Nicht festgelegt')}
              />
              <ReadOnlyField
                label={t('MwSt.-Satz der Gage')}
                value={guaranteeVatRate ? `${guaranteeVatRate} %` : null}
                placeholder={t('Keine MwSt. ausgewiesen')}
              />
              <ReadOnlyField
                label={t('Vertrag verschickt')}
                value={event.contractSentAt ? formatShortDate(event.contractSentAt) : null}
                placeholder={t('Noch nicht verschickt')}
              />
              <ReadOnlyField
                label={t('Unterschrieben zurück')}
                value={event.contractReturnedAt ? formatShortDate(event.contractReturnedAt) : null}
                placeholder={t('Noch nicht zurück')}
              />
              <ReadOnlyField
                label={t('Vorkasse (netto)')}
                value={depositSummary(event.deposits)}
                placeholder={t('Keine Vorkasse')}
                className="md:col-span-2"
              />
              <ReadOnlyField
                label={t('Vertreten durch (Management)')}
                value={representingCompanyName ?? null}
                placeholder={t('Standard: {{defaultRepresentationName}}', {
                  defaultRepresentationName
                })}
                className="md:col-span-2"
              />
              <ReadOnlyField
                label={t('Sondervereinbarungen')}
                value={contractNotes}
                placeholder={t('Keine Sondervereinbarungen')}
                className="md:col-span-2"
              />
            </div>
          )}
        </div>

        <Separator />

        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            {t('Rechnungsstellung')}
          </h3>
          <ExternalDoneToggle eventId={event.id} step="invoice" className="mb-4" />

          {isEditing ? (
            <div className="space-y-2 max-w-md">
              <Label htmlFor="event-invoice-company">
                {t('Rechnungssteller für dieses Event')}
              </Label>
              <SearchableSelect
                id="event-invoice-company"
                value={invoiceCompanyId}
                onChange={setInvoiceCompanyId}
                options={companyOptions}
                noneLabel={t('Keine explizite Auswahl (Standard-Fallback verwenden)')}
                searchPlaceholder={t('Firma suchen…')}
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  'Ist kein Rechnungssteller explizit gesetzt, fällt die Rechnungserstellung auf die Standard-Firma zurück.'
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <ReadOnlyField
                label={t('Rechnungssteller')}
                value={selectedInvoiceCompany?.name ?? null}
                placeholder={t('Standard: {{defaultInvoiceCompanyName}}', {
                  defaultInvoiceCompanyName
                })}
              />
            </div>
          )}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">{t('Rechnungen für dieses Event')}</CardTitle>
            <Button
              size="sm"
              onClick={() =>
                createInvoiceMutation.mutate({
                  dealMemoId: event.id,
                  companyId: invoiceCompanyId,
                  status: 'draft',
                  currency: 'EUR',
                  totalAmount: 0,
                  notes: ''
                })
              }
              disabled={createInvoiceMutation.isPending}
            >
              {t('+ Rechnung erstellen')}
            </Button>
          </CardHeader>
          <CardContent>
            {invoices.isLoading ? (
              <p className="text-sm text-muted-foreground">{t('Rechnungen werden geladen…')}</p>
            ) : (invoices.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {t('Noch keine Rechnungen mit diesem Event verknüpft.')}
              </div>
            ) : (
              <div className="space-y-2">
                {(invoices.data ?? []).map((invoice) => (
                  <div
                    key={invoice.id}
                    className="border rounded-md pl-3 pr-1 py-1 flex items-center justify-between gap-3"
                  >
                    {/* The row itself opens the invoice for editing */}
                    <button
                      type="button"
                      className="flex flex-1 items-center justify-between gap-3 py-1 text-left hover:opacity-80"
                      onClick={() => setOpenInvoiceId(invoice.id)}
                      title={t('Rechnung öffnen')}
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {invoiceNumberLabel(invoice.invoiceNumber)} · {invoice.companyName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatShortDate(invoice.issueDate)}{' '}
                          {invoice.dueDate
                            ? t('· fällig am {{formatShortDate}}', {
                                formatShortDate: formatShortDate(invoice.dueDate)
                              })
                            : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <InvoiceStatusBadge
                          status={invoice.status}
                          kind={invoice.kind}
                          cancelsInvoiceNumber={invoice.cancelsInvoiceNumber}
                        />
                        <span className="text-sm font-semibold">
                          {formatMoney(invoice.totalAmount, invoice.currency)}
                        </span>
                      </div>
                    </button>
                    <InvoiceRowActions invoice={invoice} onOpen={setOpenInvoiceId} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <InvoiceEditSheet invoiceId={openInvoiceId} onClose={() => setOpenInvoiceId(null)} />
    </div>
  )
}
