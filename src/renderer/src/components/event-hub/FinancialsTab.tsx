import { useState, useEffect, useRef } from 'react'
import { trpcReact } from '@/main'
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

export interface FinancialsTabProps {
  event: DealMemoDetailDto
  isEditing: boolean
  saveSignal: number
  cancelSignal: number
}

export function FinancialsTab({ event, isEditing, saveSignal, cancelSignal }: FinancialsTabProps) {
  const utils = trpcReact.useUtils()
  const lastSaveSignal = useRef(saveSignal)

  const [deal, setDeal] = useState(event.deal ?? '')
  const [vvk, setVvk] = useState(event.ticketPriceVvk?.toString() ?? '')
  const [ak, setAk] = useState(event.ticketPriceAk?.toString() ?? '')
  const [posters, setPosters] = useState(event.posters ?? '')
  const [invoiceCompanyId, setInvoiceCompanyId] = useState<number | null>(event.invoiceCompanyId ?? null)

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

  useEffect(() => {
    setDeal(event.deal ?? '')
    setVvk(event.ticketPriceVvk?.toString() ?? '')
    setAk(event.ticketPriceAk?.toString() ?? '')
    setPosters(event.posters ?? '')
    setInvoiceCompanyId(event.invoiceCompanyId ?? null)
  }, [event.deal, event.ticketPriceVvk, event.ticketPriceAk, event.posters])

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

  // Save when the page-level "Save All" fires
  useEffect(() => {
    if (saveSignal === lastSaveSignal.current) return
    lastSaveSignal.current = saveSignal
    if (isDirty) handleSaveAll()
  }, [saveSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = trpcReact.dealMemo.update.useMutation({
    onSuccess: () => {
      utils.dealMemo.getById.invalidate(event.id)
      toast.success('Saved')
    },
    onError: (e) => toast.error('Failed to save', { description: e.message })
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

  const createInvoiceMutation = trpcReact.invoice.createForDealMemo.useMutation({
    onSuccess: () => {
      utils.invoice.getByDealMemoId.invalidate(event.id)
      utils.invoice.getAllPaginated.invalidate()
      utils.dealMemo.getById.invalidate(event.id)
      toast.success('Invoice created for this event')
    },
    onError: (error) => {
      toast.error('Failed to create invoice', { description: error.message })
    }
  })

  const selectedInvoiceCompany = companies.data?.find((c) => c.id === invoiceCompanyId)
  const defaultInvoiceCompanyName = defaultCompany.data?.name ?? 'None configured'

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
              <Label htmlFor="deal-terms">Deal Terms</Label>
              <Input
                id="deal-terms"
                placeholder="e.g. 70/30, flat fee €2 000, guarantee €1 500 + 80%…"
                value={deal}
                onChange={(e) => setDeal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The financial split or fee arrangement for this show.
              </p>
            </div>
          ) : (
            <ReadOnlyField label="Deal Terms" value={deal} placeholder="No deal terms specified" />
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
              <Label htmlFor="posters">Posters</Label>
              <Input
                id="posters"
                placeholder="e.g. 50× A1, 100× A3 flyers…"
                value={posters}
                onChange={(e) => setPosters(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                What print materials need to be provided for this show?
              </p>
            </div>
          ) : (
            <ReadOnlyField label="Posters" value={posters} placeholder="No poster details" />
          )}
        </div>
      </div>

      {/* ── Right Column: Ticket Prices ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Euro className="h-4 w-4" />
          Ticket Prices
        </h3>
        {isEditing ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="vvk">Advance Sale (VVK)</Label>
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
              <Label htmlFor="ak">Box Office (AK)</Label>
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
              label="Advance Sale (VVK)"
              value={vvk ? `€ ${parseFloat(vvk).toFixed(2)}` : null}
              placeholder="Not set"
            />
            <ReadOnlyField
              label="Box Office (AK)"
              value={ak ? `€ ${parseFloat(ak).toFixed(2)}` : null}
              placeholder="Not set"
            />
          </div>
        )}
      </div>

      <div className="md:col-span-2 space-y-4">
        <Separator />

        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Invoicing
          </h3>

          {isEditing ? (
            <div className="space-y-2 max-w-md">
              <Label>Invoice Company for this Event</Label>
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
                  <SelectValue placeholder="Select invoice company" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No explicit company (use default fallback)</SelectItem>
                  {(companies.data ?? []).map((company) => (
                    <SelectItem key={company.id} value={company.id.toString()}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                If no explicit company is set, invoice creation falls back to the default invoicing company.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <ReadOnlyField
                label="Invoice Company"
                value={selectedInvoiceCompany?.name ?? null}
                placeholder={`Using default: ${defaultInvoiceCompanyName}`}
              />
            </div>
          )}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Invoices for this Event</CardTitle>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => createInvoiceMutation.mutate({
                dealMemoId: event.id,
                companyId: invoiceCompanyId,
                status: 'draft',
                currency: 'EUR',
                totalAmount: 0,
                notes: ''
              })}
              disabled={createInvoiceMutation.isPending}
            >
              <Plus className="h-3.5 w-3.5" />
              Create Invoice
            </Button>
          </CardHeader>
          <CardContent>
            {invoices.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading invoices...</p>
            ) : (invoices.data?.length ?? 0) === 0 ? (
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <FileText className="h-4 w-4" />
                No invoices linked to this event yet.
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
                        {invoice.issueDate} {invoice.dueDate ? `· due ${invoice.dueDate}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">
                        {invoice.status}
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
