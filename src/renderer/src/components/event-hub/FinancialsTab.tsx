import { useEffect, useRef } from 'react'
import { trpcReact } from '@/lib/trpc'
import { useSyncedState } from '@/hooks/useSyncedState'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Euro, FileText, Plus } from 'lucide-react'
import { toast } from 'sonner'
import type { DealMemoDetailDto } from 'src/main/api/schemas/deal_memo.schema'
import { ReadOnlyField } from './ReadOnlyField'

const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: 'Entwurf',
  issued: 'gestellt',
  paid: 'bezahlt',
  overdue: 'überfällig',
  cancelled: 'storniert'
}

export interface FinancialsTabProps {
  event: DealMemoDetailDto
  isEditing: boolean
  saveSignal: number
  cancelSignal: number
}

export function FinancialsTab({ event, isEditing, saveSignal, cancelSignal }: FinancialsTabProps) {
  const utils = trpcReact.useUtils()
  const lastSaveSignal = useRef(saveSignal)

  const [deal, setDeal] = useSyncedState(event.deal ?? '')
  const [vvk, setVvk] = useSyncedState(event.ticketPriceVvk?.toString() ?? '')
  const [ak, setAk] = useSyncedState(event.ticketPriceAk?.toString() ?? '')
  const [posters, setPosters] = useSyncedState(event.posters ?? '')
  const [invoiceCompanyId, setInvoiceCompanyId] = useSyncedState<number | null>(
    event.invoiceCompanyId ?? null
  )

  const companies = trpcReact.company.getListItems.useQuery()
  const defaultCompany = trpcReact.company.getDefaultForInvoicing.useQuery()
  const invoices = trpcReact.invoice.getByDealMemoId.useQuery(event.id)

  const isDealDirty = deal !== (event.deal ?? '')
  const isPricesDirty =
    (parseFloat(vvk) || null) !== event.ticketPriceVvk ||
    (parseFloat(ak) || null) !== event.ticketPriceAk
  const isPostersDirty = posters !== (event.posters ?? '')
  const isInvoiceCompanyDirty = invoiceCompanyId !== (event.invoiceCompanyId ?? null)
  const isDirty = isDealDirty || isPricesDirty || isPostersDirty || isInvoiceCompanyDirty

  // Reset to server values when cancel is triggered
  useEffect(() => {
    if (cancelSignal > 0) {
      setDeal(event.deal ?? '')
      setVvk(event.ticketPriceVvk?.toString() ?? '')
      setAk(event.ticketPriceAk?.toString() ?? '')
      setPosters(event.posters ?? '')
      setInvoiceCompanyId(event.invoiceCompanyId ?? null)
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
      invoiceCompanyId
    })
  }

  // Save when the page-level "Save All" fires
  useEffect(() => {
    if (saveSignal === lastSaveSignal.current) return
    lastSaveSignal.current = saveSignal
    if (isDirty) handleSaveAll()
  }, [saveSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const createInvoiceMutation = trpcReact.invoice.createForDealMemo.useMutation({
    onSuccess: () => {
      utils.invoice.getByDealMemoId.invalidate(event.id)
      utils.invoice.getAllPaginated.invalidate()
      utils.dealMemo.getById.invalidate(event.id)
      toast.success('Rechnung für dieses Event erstellt')
    },
    onError: (error) => {
      toast.error('Rechnung konnte nicht erstellt werden', { description: error.message })
    }
  })

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
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Rechnungsstellung
          </h3>

          {isEditing ? (
            <div className="space-y-2 max-w-md">
              <Label>Rechnungssteller für dieses Event</Label>
              <Select
                value={invoiceCompanyId === null ? 'none' : invoiceCompanyId.toString()}
                onValueChange={(value) => {
                  if (value === 'none') {
                    setInvoiceCompanyId(null)
                    return
                  }
                  setInvoiceCompanyId(Number(value))
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Rechnungssteller auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    Keine explizite Auswahl (Standard-Fallback verwenden)
                  </SelectItem>
                  {(companies.data ?? []).map((company) => (
                    <SelectItem key={company.id} value={company.id.toString()}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              className="gap-1.5"
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
              <Plus className="h-3.5 w-3.5" />
              Rechnung erstellen
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
                    className="border rounded-md px-3 py-2 flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        #{invoice.invoiceNumber} · {invoice.companyName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {invoice.issueDate}{' '}
                        {invoice.dueDate ? `· fällig am ${invoice.dueDate}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {INVOICE_STATUS_LABELS[invoice.status] ?? invoice.status}
                      </Badge>
                      <span className="text-sm font-semibold">
                        {new Intl.NumberFormat('de-DE', {
                          style: 'currency',
                          currency: invoice.currency || 'EUR'
                        }).format(invoice.totalAmount)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
