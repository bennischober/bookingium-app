import { Badge } from '@/components/ui/badge'
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_STYLES } from '@/lib/invoiceLabels'
import type { InvoiceKind, InvoiceStatus } from '../../../../main/api/schemas/invoice.schema'

/**
 * Status of an invoice; a Stornorechnung has no status of its own and shows
 * "Stornorechnung" (with the number it cancels, when known)
 */
export function InvoiceStatusBadge({
  status,
  kind,
  cancelsInvoiceNumber
}: {
  status: InvoiceStatus
  kind: InvoiceKind
  cancelsInvoiceNumber?: number | null
}) {
  if (kind === 'cancellation') {
    return (
      <Badge variant="outline" className="border-red-200 bg-red-50 text-red-800">
        {cancelsInvoiceNumber ? `Storno zu #${cancelsInvoiceNumber}` : 'Stornorechnung'}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={INVOICE_STATUS_STYLES[status]}>
      {INVOICE_STATUS_LABELS[status] ?? status}
    </Badge>
  )
}
