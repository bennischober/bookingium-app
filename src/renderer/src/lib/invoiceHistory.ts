import type { InvoiceDto } from '../../../main/api/schemas/invoice.schema'
import { INVOICE_EMAIL_LABELS, invoiceNumberLabel } from './invoiceLabels'

/** One line of an invoice's Verlauf */
export type InvoiceHistoryEntry = {
  /** SQLite UTC datetime (maybe with milliseconds), or a plain date (issue dates from before the Verlauf) */
  at: string
  label: string
  /** e.g. the email's recipient */
  detail?: string
  /** Another invoice the entry is about (the Stornorechnung, the original) */
  link?: { invoiceId: number; label: string }
}

type HistorySource = Pick<
  InvoiceDto,
  | 'createdAt'
  | 'kind'
  | 'statusChanges'
  | 'emails'
  | 'cancelsInvoiceId'
  | 'cancelsInvoiceNumber'
  | 'cancelledByInvoiceId'
  | 'cancelledByInvoiceNumber'
>

/**
 * The invoice's Verlauf, oldest first: created, each email (the invoice's,
 * Zahlungserinnerungen, Mahnungen), each status it moved to. Same-moment
 * entries keep that order, as a Zahlungserinnerung is recorded before the
 * „überfällig“ it causes (a plain date counts as the start of its day; older
 * rows have whole seconds, newer ones milliseconds).
 */
export function invoiceHistory(invoice: HistorySource): InvoiceHistoryEntry[] {
  let issuedBefore = false
  const statuses = invoice.statusChanges.map((change): InvoiceHistoryEntry => {
    switch (change.status) {
      case 'issued': {
        const entry: InvoiceHistoryEntry = {
          at: change.createdAt,
          label: issuedBefore ? 'Wieder offen (gestellt)' : 'Gestellt'
        }
        if (!issuedBefore && invoice.kind === 'cancellation' && invoice.cancelsInvoiceId) {
          entry.label = 'Gestellt als Storno zu'
          entry.link = {
            invoiceId: invoice.cancelsInvoiceId,
            label: `Rechnung ${invoiceNumberLabel(invoice.cancelsInvoiceNumber)}`
          }
        }
        issuedBefore = true
        return entry
      }
      case 'paid':
        return { at: change.createdAt, label: 'Als bezahlt markiert' }
      case 'overdue':
        return { at: change.createdAt, label: 'Als überfällig markiert' }
      case 'cancelled':
        return {
          at: change.createdAt,
          label: 'Storniert',
          ...(invoice.cancelledByInvoiceId && {
            link: {
              invoiceId: invoice.cancelledByInvoiceId,
              label: `Stornorechnung ${invoiceNumberLabel(invoice.cancelledByInvoiceNumber)}`
            }
          })
        }
      default:
        return { at: change.createdAt, label: 'Entwurf' }
    }
  })
  const emails = [...invoice.emails].reverse().map(
    (email): InvoiceHistoryEntry => ({
      at: email.createdAt,
      label: INVOICE_EMAIL_LABELS[email.kind],
      ...(email.to && { detail: `an ${email.to}` })
    })
  )
  const later = [...emails, ...statuses].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  return [{ at: invoice.createdAt, label: 'Angelegt' }, ...later]
}
