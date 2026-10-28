import { Mail, MailCheck, Reply } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { formatShortDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { InfoCard } from '@/components/detail/DetailParts'
import { INVOICE_EMAIL_LABELS } from '@/lib/invoiceLabels'
import { useMailClientEnabled } from '@/hooks/useMailClientEnabled'
import type { InvoiceMailDto } from '../../../../main/api/schemas/invoice.schema'

/**
 * C4: the invoice's mails. What bookingum sent (with the time it was sent) and every
 * answer that quotes one of those Message-IDs. The status is never changed from here -
 * an answer only shows, the user decides what it means for the invoice. Hidden with the mail
 * client off.
 */
export function InvoiceMailsCard({ invoiceId }: { invoiceId: number }) {
  const mailClientEnabled = useMailClientEnabled()
  const mails = trpcReact.invoice.mails.useQuery(invoiceId, {
    enabled: mailClientEnabled && Number.isInteger(invoiceId) && invoiceId > 0
  })
  if (!mailClientEnabled || !mails.data || mails.data.mails.length === 0) return null

  const open = (mail: InvoiceMailDto) => {
    if (mail.storeId !== null && mail.accountId) {
      void window.api.openMailWindow(mail.accountId, mail.storeId)
    }
  }

  return (
    <InfoCard label="E-Mails">
      <div className="space-y-2">
        {mails.data.answered && (
          <Badge variant="secondary" className="gap-1.5">
            <MailCheck className="size-3" aria-hidden />
            Antwort erhalten
          </Badge>
        )}
        <ul className="divide-y rounded-md border" aria-label="E-Mails zur Rechnung">
          {mails.data.mails.map((mail, index) => (
            <li key={`${mail.role}-${mail.messageId ?? index}`} className="px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                {mail.role === 'reply' ? (
                  <Reply className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <Mail className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate font-medium">
                  {mail.role === 'reply'
                    ? (mail.subject ?? 'Antwort')
                    : mail.kind
                      ? INVOICE_EMAIL_LABELS[mail.kind]
                      : 'Gesendet'}
                </span>
                {mail.storeId !== null && mail.accountId && (
                  <button
                    type="button"
                    className="shrink-0 text-xs text-primary hover:underline"
                    onClick={() => open(mail)}
                  >
                    Öffnen
                  </button>
                )}
              </div>
              <div className="text-muted-foreground">
                {mail.role === 'reply'
                  ? [mail.fromName || mail.fromEmail, mail.date && formatShortDate(mail.date)]
                      .filter(Boolean)
                      .join(' · ')
                  : [
                      mail.fromEmail && `An ${mail.fromEmail}`,
                      mail.sentAt && formatShortDate(mail.sentAt)
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </InfoCard>
  )
}
