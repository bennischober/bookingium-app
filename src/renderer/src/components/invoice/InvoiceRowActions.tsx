import { useNavigate } from '@tanstack/react-router'
import { Eye, Pencil, Printer, Trash2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { RowActionButton, RowActions } from '@/components/row-action-button'
import { invoiceNumberLabel } from '@/lib/invoiceLabels'
import {
  isInvoiceLocked,
  type InvoiceListItemDto
} from '../../../../main/api/schemas/invoice.schema'
import { confirmAction } from '@/lib/confirm'
import { t } from '../../../../main/i18n/translate'

/**
 * Open / print / delete buttons of an invoice row (invoice list and an
 * event's Finanzen tab). Drafts open in the caller's sheet; issued invoices
 * open on their page and can't be deleted - they are cancelled there.
 */
export function InvoiceRowActions({
  invoice,
  onOpen
}: {
  invoice: InvoiceListItemDto
  /** Opens a draft */
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
      toast.success(t('Entwurf gelöscht'))
    },
    onError: (error) =>
      toast.error(t('Rechnung konnte nicht gelöscht werden'), { description: error.message })
  })

  return (
    <RowActions>
      <RowActionButton
        icon={locked ? Eye : Pencil}
        label={locked ? t('Anzeigen') : t('Bearbeiten')}
        onClick={() =>
          locked
            ? navigate({ to: '/invoices/$invoiceId', params: { invoiceId: String(invoice.id) } })
            : onOpen(invoice.id)
        }
      />
      <RowActionButton
        icon={Printer}
        label={t('Drucken / Als PDF speichern')}
        onClick={() =>
          navigate({
            to: '/invoices/$invoiceId/print',
            params: { invoiceId: String(invoice.id) }
          })
        }
      />
      <RowActionButton
        icon={Trash2}
        label={t('Entwurf löschen')}
        destructive
        disabled={locked || deleteMutation.isPending}
        disabledReason={
          locked
            ? t('Gestellte Rechnungen können nicht gelöscht werden – bitte stornieren')
            : undefined
        }
        onClick={async () => {
          if (
            await confirmAction({
              title: t('{{invoiceNumberLabel}} löschen?', {
                invoiceNumberLabel: invoiceNumberLabel(invoice.invoiceNumber)
              }),
              description: t('Der Entwurf wird endgültig entfernt.'),
              confirmLabel: t('Löschen'),
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
