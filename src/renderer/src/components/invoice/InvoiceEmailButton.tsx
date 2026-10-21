import { useState } from 'react'
import { Mail } from 'lucide-react'
import { toast } from 'sonner'
import { useInvalidateInvoices } from '@/hooks/useInvalidateInvoices'
import { Button } from '@/components/ui/button'
import type { MailMethod } from '../../../../main/mail/mailProgram'
import type { ReminderKind } from '../../../../main/api/schemas/invoice.schema'

const LABELS: Record<ReminderKind, string> = {
  reminder: 'Zahlungserinnerung per E-Mail senden',
  dunning: 'Mahnung per E-Mail senden'
}

const TITLES: Record<MailMethod, string> = {
  outlook: 'E-Mail in Outlook geöffnet',
  thunderbird: 'E-Mail in Thunderbird geöffnet',
  mailto: 'E-Mail geöffnet – PDF bitte anhängen',
  files: 'E-Mail gespeichert'
}

const HINTS: Record<MailMethod, string> = {
  outlook: 'Prüfen und senden.',
  thunderbird: 'Prüfen und senden.',
  mailto: 'Das PDF liegt im geöffneten Ordner – in die E-Mail ziehen.',
  files: 'Kein Mailprogramm gefunden. Die E-Mail (.eml) und das PDF liegen im geöffneten Ordner.'
}

/**
 * "Per E-Mail senden" of the invoice print page: the main process writes the
 * PDF (with e-invoice) and an email draft from the template in the settings
 * and opens it in the mail program. With `kind` the email is a
 * Zahlungserinnerung or Mahnung, with the invoice attached again.
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

  const send = async () => {
    setSending(true)
    try {
      const result = await window.api.sendInvoiceEmail(invoiceId, fileName, lang, kind)
      if (!result.success || !result.method || !result.pdfPath) {
        toast.error('E-Mail konnte nicht erstellt werden', { description: result.error })
        return
      }
      invalidateInvoices()
      const pdfPath = result.pdfPath
      const action = {
        label: 'Ordner öffnen',
        onClick: () => void window.api.showEmailFile(pdfPath)
      }
      const incomplete = result.eInvoice?.state === 'incomplete'
      const notes = [
        result.to ? `An ${result.to}.` : 'Beim Empfänger ist keine E-Mail-Adresse hinterlegt.',
        HINTS[result.method],
        incomplete ? `PDF ohne E-Rechnung – es fehlt: ${result.eInvoice?.missing.join('; ')}` : ''
      ]
      const show = !result.to || incomplete ? toast.warning : toast.success
      show(TITLES[result.method], { description: notes.filter(Boolean).join(' '), action })
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
