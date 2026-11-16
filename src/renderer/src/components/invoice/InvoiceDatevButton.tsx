import { useState } from 'react'
import { CheckCircle2, Landmark } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { datevTransferLabel } from './datevTransfer'
import { PRODUCT_NAMES } from '../../../../main/api/terms'
import { Button } from '@/components/ui/button'

/**
 * "An DATEV übergeben" of the invoice print page: the main process mails this page's PDF (with
 * e-invoice) to the DATEV Upload Mail address of the issuing company, from the "Senden von"
 * account. DATEV files each mail as a document, so a second hand-over asks first: it would
 * be a second copy of the same Beleg there.
 */
export function InvoiceDatevButton({
  invoiceId,
  fileName
}: {
  invoiceId: number
  fileName: string
}) {
  const [sending, setSending] = useState(false)
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const transfers = trpcReact.datev.listForInvoice.useQuery(invoiceId)
  const latest = transfers.data?.[0]

  const send = async () => {
    if (
      latest &&
      !(await confirmAction({
        title: 'Erneut an DATEV übergeben?',
        description: `${datevTransferLabel(latest)}. DATEV legt dann einen zweiten Beleg an.`,
        confirmLabel: 'Erneut übergeben'
      }))
    ) {
      return
    }
    setSending(true)
    try {
      const result = await window.api.sendInvoiceToDatev(invoiceId, fileName)
      if (!result.success) {
        const tab = result.setup === 'datev' ? 'invoices' : 'email'
        toast.error('Übergabe an DATEV fehlgeschlagen', {
          description: result.error,
          ...(result.setup
            ? {
                action: {
                  label: 'Einstellungen öffnen',
                  onClick: () => void navigate({ to: '/settings', search: { tab } })
                }
              }
            : {})
        })
        return
      }
      if (result.eInvoice?.state === 'incomplete') {
        toast.warning('An DATEV übergeben', {
          description: `PDF ohne E-Rechnung – es fehlt: ${result.eInvoice.missing.join('; ')}`
        })
      } else {
        toast.success('An DATEV übergeben', { description: result.to })
      }
    } finally {
      // An unclear send stays pending: the list shows it as still being confirmed
      void utils.datev.listForInvoice.invalidate(invoiceId)
      setSending(false)
    }
  }

  return (
    <Button
      variant="outline"
      onClick={() => void send()}
      disabled={sending || transfers.isLoading}
      title={latest ? datevTransferLabel(latest) : `PDF an ${PRODUCT_NAMES.datevOnline} übergeben`}
    >
      {latest?.sentAt ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <Landmark className="h-4 w-4" />
      )}
      {sending ? 'Wird übergeben…' : 'An DATEV übergeben'}
    </Button>
  )
}
