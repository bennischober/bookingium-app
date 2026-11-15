import { ChevronDown } from 'lucide-react'
import { InfoLabel } from '@/components/InfoLabel'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

/**
 * Buyer reference and the XRechnung switch. Rarely needed, so the form opens
 * them folded unless in use; folded, the header shows the values. The form
 * holds `open`, so it survives switching steps.
 */
export function InvoiceEInvoiceDetails({
  open,
  onOpenChange,
  buyerReference,
  onBuyerReferenceChange,
  xrechnung,
  onXrechnungChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  buyerReference: string
  onBuyerReferenceChange: (value: string) => void
  xrechnung: boolean
  onXrechnungChange: (value: boolean) => void
}) {
  return (
    <div className="rounded-md border">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <span>
          E-Rechnung: Käuferreferenz, XRechnung
          {!open && (buyerReference || xrechnung) && (
            <span className="ml-2 font-normal text-muted-foreground">
              {[buyerReference, xrechnung && 'XRechnung'].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-4 border-t px-3 py-3">
          <div className="space-y-2">
            <InfoLabel
              htmlFor="invoice-buyer-reference"
              text="Käuferreferenz / Leitweg-ID (optional)"
              info="Bestell- oder Referenznummer des Empfängers; bei Behörden die Leitweg-ID. Steht in der E-Rechnung."
            />
            <Input
              id="invoice-buyer-reference"
              value={buyerReference}
              onChange={(e) => onBuyerReferenceChange(e.target.value)}
              placeholder="z. B. 04011000-12345-34"
            />
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="invoice-xrechnung"
              checked={xrechnung}
              onCheckedChange={onXrechnungChange}
            />
            <div className="space-y-1">
              <Label htmlFor="invoice-xrechnung">XRechnung (öffentlicher Auftraggeber)</Label>
              <p className="text-xs text-muted-foreground">
                Für Behörden und andere öffentliche Stellen: braucht die Leitweg-ID, einen
                Ansprechpartner mit Telefon und E-Mail, die IBAN und die E-Mail des Empfängers. Das
                PDF enthält dann die XRechnung; für Portale lässt sie sich auch als XML speichern.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
