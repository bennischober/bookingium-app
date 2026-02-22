import { useState, useEffect, useRef } from 'react'
import { trpcReact } from '@/main'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Euro } from 'lucide-react'
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

  const isDealDirty = deal !== (event.deal ?? '')
  const isPricesDirty =
    (parseFloat(vvk) || null) !== event.ticketPriceVvk ||
    (parseFloat(ak) || null) !== event.ticketPriceAk
  const isPostersDirty = posters !== (event.posters ?? '')
  const isDirty = isDealDirty || isPricesDirty || isPostersDirty

  useEffect(() => {
    setDeal(event.deal ?? '')
    setVvk(event.ticketPriceVvk?.toString() ?? '')
    setAk(event.ticketPriceAk?.toString() ?? '')
    setPosters(event.posters ?? '')
  }, [event.deal, event.ticketPriceVvk, event.ticketPriceAk, event.posters])

  // Reset to server values when cancel is triggered
  useEffect(() => {
    if (cancelSignal > 0) {
      setDeal(event.deal ?? '')
      setVvk(event.ticketPriceVvk?.toString() ?? '')
      setAk(event.ticketPriceAk?.toString() ?? '')
      setPosters(event.posters ?? '')
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
      posters: posters || undefined
    })
  }

  return (
    <div className="space-y-8 max-w-lg">
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

      {/* ── Ticket prices ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Euro className="h-4 w-4" />
          Ticket Prices
        </h3>
        {isEditing ? (
          <div className="grid grid-cols-2 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
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
  )
}
