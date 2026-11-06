import { useState } from 'react'
import { Mail } from 'lucide-react'
import { toast } from '@/lib/toast'
import { useInvalidateInvoices } from '@/hooks/useInvalidateInvoices'
import { Button } from '@/components/ui/button'
import { useNavigate } from '@tanstack/react-router'
import { showSendSetupError } from '@/components/mail/sendSetupToast'
import type { ReminderKind } from '../../../../main/api/schemas/invoice.schema'

const LABELS: Record<ReminderKind, string> = {
  reminder: 'Zahlungserinnerung per E-Mail senden',
  dunning: 'Mahnung per E-Mail senden'
}

/**
 * "Per E-Mail senden" of the invoice print page: the main process writes the PDF (with
 * e-invoice), fills the template of Einstellungen › E-Mail and opens bookingum's compose
 * window on the "Senden von" account (#136, the only way since the mail program is gone).
 * Sent there, the invoice counts as sent. With `kind` the email is a Zahlungserinnerung or
 * Mahnung, with the invoice attached again.
 */
export function InvoiceEmailButton({
  invoiceId,
  fileName,
  lang,
  kind
}: {
  invoiceId: number
  fileName: string
  lang: 'de' | 'en'
  kind?: ReminderKind
}) {
  const [sending, setSending] = useState(false)
  const invalidateInvoices = useInvalidateInvoices()
  const navigate = useNavigate()

  const send = async () => {
    setSending(true)
    try {
      const result = await window.api.sendInvoiceEmail(invoiceId, fileName, lang, kind)
      if (!result.success) {
        showSendSetupError(
          result.error,
          () => void navigate({ to: '/settings', search: { tab: 'email' } }),
          result.setup
        )
        return
      }
      if (!result.sent) {
        toast.info('E-Mail nicht gesendet')
        return
      }
      invalidateInvoices()
      if (result.eInvoice?.state === 'incomplete') {
        toast.warning('E-Mail gesendet', {
          description: `PDF ohne E-Rechnung – es fehlt: ${result.eInvoice.missing.join('; ')}`
        })
      } else toast.success('E-Mail gesendet')
    } finally {
      setSending(false)
    }
  }

  return (
    <Button variant={kind ? 'default' : 'outline'} onClick={() => void send()} disabled={sending}>
      <Mail className="h-4 w-4" /> {kind ? LABELS[kind] : 'Per E-Mail senden'}
    </Button>
  )
}
