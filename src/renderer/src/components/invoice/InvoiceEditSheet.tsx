import { useEffect } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { FormSheet } from '@/components/form-sheet'
import { InvoiceForm } from '@/components/forms/InvoiceForm'
import { invoiceFollowUpName, invoiceNumberLabel } from '@/lib/invoiceLabels'
import { isInvoiceLocked, type InvoiceDto } from '../../../../main/api/schemas/invoice.schema'
import { FollowUpButton, RecordFollowUps } from '@/components/follow-ups/RecordFollowUps'
import { useFollowUpNudge } from '@/hooks/useFollowUpNudge'
import { useInvalidateInvoices } from '@/hooks/useInvalidateInvoices'

/**
 * Sheet for a draft invoice: the full form, where it can also be issued.
 * Issued invoices are locked and have their own page; asked to open one
 * (search, follow-ups), the sheet goes there instead.
 */
export function InvoiceEditSheet({
  invoiceId,
  onClose
}: {
  invoiceId: number | null
  onClose: () => void
}) {
  const invalidateInvoices = useInvalidateInvoices()
  const invoiceQuery = trpcReact.invoice.getById.useQuery(invoiceId ?? 0, {
    enabled: invoiceId !== null
  })
  const invoice = invoiceId !== null ? invoiceQuery.data : undefined
  const locked = invoice ? isInvoiceLocked(invoice.status) : false
  const nudgeFollowUp = useFollowUpNudge()
  const navigate = useNavigate()

  useEffect(() => {
    if (!invoice || !locked) return
    onClose()
    void navigate({ to: '/invoices/$invoiceId', params: { invoiceId: String(invoice.id) } })
  }, [invoice, locked]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateMutation = trpcReact.invoice.update.useMutation({
    onSuccess: (updated) => {
      invalidateInvoices()
      onClose()
      if (updated.status === 'draft') {
        void nudgeFollowUp('Entwurf gespeichert', {
          record: { type: 'invoice', id: updated.id, name: invoiceFollowUpName(updated) },
          note: 'Entwurf vervollständigen'
        })
      } else {
        toast.success(`Rechnung ${invoiceNumberLabel(updated.invoiceNumber)} gestellt`, {
          action: {
            label: 'Anzeigen',
            onClick: () =>
              navigate({ to: '/invoices/$invoiceId', params: { invoiceId: String(updated.id) } })
          }
        })
      }
    },
    onError: (error) =>
      toast.error('Rechnung konnte nicht gespeichert werden', { description: error.message })
  })

  return (
    <FormSheet
      isOpen={invoiceId !== null}
      onClose={onClose}
      mode="edit"
      title="Entwurf bearbeiten"
      description="Bearbeiten Sie Details, Empfänger, Verknüpfung und Positionen des Entwurfs."
    >
      {!invoice || locked ? (
        <p className="text-sm text-muted-foreground">
          {invoiceQuery.isError ? 'Rechnung nicht gefunden.' : 'Rechnung wird geladen…'}
        </p>
      ) : (
        <>
          <InvoiceFollowUps invoice={invoice} />
          <InvoiceForm
            key={`edit-${invoice.id}`}
            mode="edit"
            invoice={invoice}
            onCancel={onClose}
            onCreate={() => {}}
            onUpdate={(payload) => updateMutation.mutate(payload)}
            isSubmitting={updateMutation.isPending}
          />
        </>
      )}
    </FormSheet>
  )
}

/** The draft's follow-ups (drafts have no page of their own, so they sit here) */
function InvoiceFollowUps({ invoice }: { invoice: InvoiceDto }) {
  const record = { type: 'invoice', id: invoice.id, name: invoiceFollowUpName(invoice) } as const
  return (
    <>
      <div className="mb-4 flex justify-end">
        <FollowUpButton record={record} />
      </div>
      <RecordFollowUps record={record} />
    </>
  )
}
