import { SearchableSelect } from '@/components/ui/searchable-select'
import { useEffect, useRef, useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { useSyncedState } from '@/hooks/useSyncedState'
import { InvoiceEditSheet } from '@/components/invoice/InvoiceEditSheet'
import { InvoiceRowActions } from '@/components/invoice/InvoiceRowActions'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_STYLES,
  formatMoney,
  invoiceNumberLabel
} from '@/lib/invoiceLabels'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Euro, FileText, FileSignature } from 'lucide-react'
import { toast } from 'sonner'
import type { DealMemoDetailDto } from 'src/main/api/schemas/deal_memo.schema'
import { ReadOnlyField } from './ReadOnlyField'

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
  const [contractNotes, setContractNotes] = useSyncedState(event.contractNotes ?? '')
  // Contract "vertreten durch" override; null = band management / default
  const [representingCompanyId, setRepresentingCompanyId] = useSyncedState<number | null>(
    event.representingCompanyId ?? null
  )
  const isContractDirty =
    (parseFloat(guaranteeAmount) || null) !== event.guaranteeAmount ||
    (parseFloat(guaranteeVatRate) || null) !== event.guaranteeVatRate ||
    contractNotes !== (event.contractNotes ?? '') ||
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
      setContractNotes(event.contractNotes ?? '')
      setRepresentingCompanyId(event.representingCompanyId ?? null)
    }
  }, [cancelSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = trpcReact.dealMemo.update.useMutation({
    onSuccess: () => {
      utils.dealMemo.getById.invalidate(event.id)
      toast.success('Gespeichert')
    },
    onError: (e) => toast.error('Speichern fehlgeschlagen', { description: e.message })
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
      contractNotes: contractNotes,
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
      toast.success('Entwurf für dieses Event angelegt')
    },
    onError: (error) => {
      toast.error('Rechnung konnte nicht erstellt werden', { description: error.message })
    }
  })

  // Who represents the band when the event sets no override
  const bandManagementName = companies.data?.find(
    (c) => c.id === event.band?.managementCompanyId
  )?.name
  const defaultRepresentationName = bandManagementName
    ? `${bandManagementName} (Management der Band)`
    : (defaultCompany.data?.name ?? 'keine Standard-Firma')
  const representingCompanyName = companies.data?.find((c) => c.id === representingCompanyId)?.name

  const selectedInvoiceCompany = companies.data?.find((c) => c.id === invoiceCompanyId)
  const defaultInvoiceCompanyName = defaultCompany.data?.name ?? 'Nicht konfiguriert'

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
      {/* ── Left Column: Deal & Marketing ── */}
      <div className="space-y-6">
        {/* ── Deal terms ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Deal
          </h3>
          {isEditing ? (
            <div className="space-y-2">
              <Label htmlFor="deal-terms">Konditionen</Label>
              <Input
                id="deal-terms"
                placeholder="z. B. 70/30, Pauschale 2 000 €, Garantie 1 500 € + 80 %…"
                value={deal}
                onChange={(e) => setDeal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Die finanzielle Aufteilung oder Gagenvereinbarung für diese Show.
              </p>
            </div>
          ) : (
            <ReadOnlyField
              label="Konditionen"
              value={deal}
              placeholder="Keine Konditionen hinterlegt"
            />
          )}
        </div>

        <Separator />

        {/* ── Posters / marketing ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Marketing
          </h3>
          {isEditing ? (
            <div className="space-y-2">
              <Label htmlFor="posters">Plakate</Label>
              <Input
                id="posters"
                placeholder="z. B. 50× A1, 100× A3 Flyer…"
                value={posters}
                onChange={(e) => setPosters(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Welche Printmaterialien müssen für diese Show bereitgestellt werden?
              </p>
            </div>
          ) : (
            <ReadOnlyField label="Plakate" value={posters} placeholder="Keine Plakat-Details" />
          )}
        </div>
      </div>

      {/* ── Right Column: Ticket Prices ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Euro className="h-4 w-4" />
          Ticketpreise
        </h3>
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vvk">Vorverkauf (VVK)</Label>
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
              <Label htmlFor="ak">Abendkasse (AK)</Label>
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
              label="Vorverkauf (VVK)"
              value={vvk ? `€ ${parseFloat(vvk).toFixed(2)}` : null}
              placeholder="Nicht festgelegt"
            />
            <ReadOnlyField
              label="Abendkasse (AK)"
              value={ak ? `€ ${parseFloat(ak).toFixed(2)}` : null}
              placeholder="Nicht festgelegt"
            />
          </div>
        )}
      </div>

      <div className="md:col-span-2 space-y-4">
        <Separator />

        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <FileSignature className="h-4 w-4" />
            Vertrag (Gage)
          </h3>
          {isEditing ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <div className="space-y-2">
                <Label htmlFor="guarantee-amount">Garantiezahlung (netto, €)</Label>
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
                  Erscheint im Auftrittsvertrag als vereinbarte Gage
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="guarantee-vat">MwSt.-Satz der Gage (%)</Label>
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
                <p className="text-xs text-muted-foreground">Leer oder 0 = keine MwSt. ausweisen</p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="event-representing-company">Vertreten durch (Management)</Label>
                <SearchableSelect
                  id="event-representing-company"
                  className="max-w-md"
                  value={representingCompanyId}
                  onChange={setRepresentingCompanyId}
                  options={companyOptions}
                  noneLabel={`Standard: ${defaultRepresentationName}`}
                  searchPlaceholder="Firma suchen…"
                />
                <p className="text-xs text-muted-foreground">
                  Vertritt die Band in diesem Vertrag (Briefkopf, „vertreten durch“, Unterschrift
                  VP1). Nur setzen, wenn es vom Management der Band abweicht.
                </p>
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="contract-notes">Sondervereinbarungen (Vertrag)</Label>
                <Textarea
                  id="contract-notes"
                  rows={3}
                  placeholder="Zusätzliche vertragliche Vereinbarungen für dieses Event…"
                  value={contractNotes}
                  onChange={(e) => setContractNotes(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Wird im Vertrag als Abschnitt „Sondervereinbarungen“ angehängt.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
              <ReadOnlyField
                label="Garantiezahlung (netto)"
                value={guaranteeAmount ? `€ ${parseFloat(guaranteeAmount).toFixed(2)}` : null}
                placeholder="Nicht festgelegt"
              />
              <ReadOnlyField
                label="MwSt.-Satz der Gage"
                value={guaranteeVatRate ? `${guaranteeVatRate} %` : null}
                placeholder="Keine MwSt. ausgewiesen"
              />
              <ReadOnlyField
                label="Vertreten durch (Management)"
                value={representingCompanyName ?? null}
                placeholder={`Standard: ${defaultRepresentationName}`}
                className="md:col-span-2"
              />
              <ReadOnlyField
                label="Sondervereinbarungen"
                value={contractNotes}
                placeholder="Keine Sondervereinbarungen"
                className="md:col-span-2"
              />
            </div>
          )}
        </div>

        <Separator />

        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Rechnungsstellung
          </h3>

          {isEditing ? (
            <div className="space-y-2 max-w-md">
              <Label htmlFor="event-invoice-company">Rechnungssteller für dieses Event</Label>
              <SearchableSelect
                id="event-invoice-company"
                value={invoiceCompanyId}
                onChange={setInvoiceCompanyId}
                options={companyOptions}
                noneLabel="Keine explizite Auswahl (Standard-Fallback verwenden)"
                searchPlaceholder="Firma suchen…"
              />
              <p className="text-xs text-muted-foreground">
                Ist kein Rechnungssteller explizit gesetzt, fällt die Rechnungserstellung auf die
                Standard-Firma zurück.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <ReadOnlyField
                label="Rechnungssteller"
                value={selectedInvoiceCompany?.name ?? null}
                placeholder={`Standard: ${defaultInvoiceCompanyName}`}
              />
            </div>
          )}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Rechnungen für dieses Event</CardTitle>
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
              + Rechnung erstellen
            </Button>
          </CardHeader>
          <CardContent>
            {invoices.isLoading ? (
              <p className="text-sm text-muted-foreground">Rechnungen werden geladen...</p>
            ) : (invoices.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Noch keine Rechnungen mit diesem Event verknüpft.
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
                      title="Rechnung öffnen"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {invoiceNumberLabel(invoice.invoiceNumber)} · {invoice.companyName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {invoice.issueDate}{' '}
                          {invoice.dueDate ? `· fällig am ${invoice.dueDate}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={INVOICE_STATUS_STYLES[invoice.status]}>
                          {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
                        </Badge>
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
