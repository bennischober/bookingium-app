import { useNavigate } from '@tanstack/react-router'
import { BellRing } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { germanDate, localIsoDate } from '@/lib/followUps'
import { useOpenInvoice } from '@/hooks/useOpenInvoice'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  REMINDER_ACTION_LABELS,
  formatMoney,
  invoiceMomentLabel,
  invoiceNumberLabel
} from '@/lib/invoiceLabels'
import {
  nextReminderKind,
  type OverdueInvoiceDto
} from '../../../../main/api/schemas/invoice.schema'

/** "Mahnung am 15.10.2026, 14:32" for the latest reminder, '' before the first */
function lastReminderLabel(emails: OverdueInvoiceDto['emails']): string {
  const last = emails.at(-1)
  if (!last) return ''
  const dunnings = emails.filter((email) => email.kind === 'dunning').length
  const noun =
    last.kind === 'reminder'
      ? 'Zahlungserinnerung'
      : dunnings > 1
        ? `${dunnings}. Mahnung`
        : 'Mahnung'
  return `${noun} am ${invoiceMomentLabel(last.createdAt)}`
}

/**
 * Dashboard card: open invoices past their due date (or marked überfällig),
 * longest overdue first, each with its next step – the Zahlungserinnerung,
 * after it a Mahnung – sent from the print page. Hidden while there are none.
 */
export function OverdueInvoicesCard() {
  const navigate = useNavigate()
  const openInvoice = useOpenInvoice()
  const today = localIsoDate()
  const query = trpcReact.invoice.listOverdue.useQuery(today)
  const invoices = query.data ?? []
  if (invoices.length === 0) return null

  return (
    <Card role="region" aria-labelledby="overdue-invoices-title">
      <CardHeader>
        <CardTitle id="overdue-invoices-title">Überfällige Rechnungen</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {invoices.map((invoice) => {
            const next = nextReminderKind(invoice, today)
            return (
              <li
                key={invoice.id}
                className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {invoiceNumberLabel(invoice.invoiceNumber)} · {invoice.recipientName}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[
                      // Marked by hand, the due date may not have passed
                      invoice.dueDate && invoice.dueDate < today
                        ? `Fällig seit ${germanDate(invoice.dueDate)}`
                        : 'Als überfällig markiert',
                      lastReminderLabel(invoice.emails)
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-semibold">
                    {formatMoney(invoice.totalAmount, invoice.currency)}
                  </span>
                  {next && (
                    <Button
                      className="gap-1.5"
                      onClick={() =>
                        navigate({
                          to: '/invoices/$invoiceId/print',
                          params: { invoiceId: String(invoice.id) },
                          search: { email: next }
                        })
                      }
                    >
                      <BellRing className="h-4 w-4" />
                      {REMINDER_ACTION_LABELS[next]}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => openInvoice(invoice)}>
                    Rechnung öffnen
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
