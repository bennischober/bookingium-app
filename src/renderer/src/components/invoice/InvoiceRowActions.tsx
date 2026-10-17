import { useNavigate } from '@tanstack/react-router'
import { Eye, Pencil, Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { invoiceNumberLabel } from '@/lib/invoiceLabels'
import {
  isInvoiceLocked,
  type InvoiceListItemDto
} from '../../../../main/api/schemas/invoice.schema'

/**
 * Open / print / delete buttons of an invoice row (invoice list and an
 * event's Finanzen tab). Issued invoices open read-only and can't be
 * deleted - they are cancelled from the sheet instead.
 */
export function InvoiceRowActions({
  invoice,
  onOpen
}: {
  invoice: InvoiceListItemDto
  onOpen: (invoiceId: number) => void
}) {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const locked = isInvoiceLocked(invoice.status)

  const deleteMutation = trpcReact.invoice.delete.useMutation({
    onSuccess: () => {
      void utils.invoice.invalidate()
      void utils.dealMemo.getById.invalidate()
      void utils.dashboard.invalidate()
      toast.success('Entwurf gelöscht')
    },
    onError: (error) =>
      toast.error('Rechnung konnte nicht gelöscht werden', { description: error.message })
  })

  return (
    <div className="flex items-center">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onOpen(invoice.id)}
        title={locked ? 'Anzeigen' : 'Bearbeiten'}
      >
        {locked ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() =>
          navigate({
            to: '/invoices/$invoiceId/print',
            params: { invoiceId: String(invoice.id) }
          })
        }
        title="Drucken / Als PDF speichern"
      >
        <Printer className="h-4 w-4" />
      </Button>
      {/* Disabled buttons show no tooltip, so the hint sits on a wrapper */}
      <span
        title={
          locked
            ? 'Gestellte Rechnungen können nicht gelöscht werden – bitte stornieren'
            : 'Entwurf löschen'
        }
      >
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            if (confirm(`${invoiceNumberLabel(invoice.invoiceNumber)} löschen?`)) {
              deleteMutation.mutate(invoice.id)
            }
          }}
          disabled={locked || deleteMutation.isPending}
          aria-label="Löschen"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </span>
    </div>
  )
}
