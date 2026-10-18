import { useNavigate } from '@tanstack/react-router'
import { Eye, Pencil, Printer, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { invoiceNumberLabel } from '@/lib/invoiceLabels'
import {
  isInvoiceLocked,
  type InvoiceListItemDto
} from '../../../../main/api/schemas/invoice.schema'
import { confirmAction } from '@/lib/confirm'

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
    <RowActions>
      <RowActionButton
        icon={locked ? Eye : Pencil}
        label={locked ? 'Anzeigen' : 'Bearbeiten'}
        onClick={() => onOpen(invoice.id)}
      />
      <RowActionButton
        icon={Printer}
        label="Drucken / Als PDF speichern"
        onClick={() =>
          navigate({
            to: '/invoices/$invoiceId/print',
            params: { invoiceId: String(invoice.id) }
          })
        }
      />
      <RowActionButton
        icon={Trash2}
        label="Entwurf löschen"
        destructive
        disabled={locked || deleteMutation.isPending}
        disabledReason={
          locked
            ? 'Gestellte Rechnungen können nicht gelöscht werden – bitte stornieren'
            : undefined
        }
        onClick={async () => {
          if (
            await confirmAction({
              title: `${invoiceNumberLabel(invoice.invoiceNumber)} löschen?`,
              description: 'Der Entwurf wird endgültig entfernt.',
              confirmLabel: 'Löschen',
              destructive: true
            })
          ) {
            deleteMutation.mutate(invoice.id)
          }
        }}
      />
    </RowActions>
  )
}
