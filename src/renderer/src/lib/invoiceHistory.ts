import type { InvoiceDto } from '../../../main/api/schemas/invoice.schema'
import {
  DATEV_CATEGORY_LABELS,
  type DatevTransferDto
} from '../../../main/api/schemas/datev.schema'
import { INVOICE_EMAIL_LABELS, invoiceNumberLabel } from './invoiceLabels'
import { t } from '../../../main/i18n/translate'

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
 * Zahlungserinnerungen, Mahnungen), each hand-over to DATEV, each status it moved to. Same-moment
 * entries keep that order, as a Zahlungserinnerung is recorded before the
 * „überfällig“ it causes (a plain date counts as the start of its day; older
 * rows have whole seconds, newer ones milliseconds).
 */
export function invoiceHistory(
  invoice: HistorySource,
  datevTransfers: readonly Pick<DatevTransferDto, 'createdAt' | 'sentAt' | 'to' | 'category'>[] = []
): InvoiceHistoryEntry[] {
  let issuedBefore = false
  const statuses = invoice.statusChanges.map((change): InvoiceHistoryEntry => {
    switch (change.status) {
      case 'issued': {
        const entry: InvoiceHistoryEntry = {
          at: change.createdAt,
          label: issuedBefore ? t('Wieder offen (gestellt)') : t('Gestellt')
        }
        if (!issuedBefore && invoice.kind === 'cancellation' && invoice.cancelsInvoiceId) {
          entry.label = t('Gestellt als Storno zu')
          entry.link = {
            invoiceId: invoice.cancelsInvoiceId,
            label: t('Rechnung {{invoiceNumberLabel}}', {
              invoiceNumberLabel: invoiceNumberLabel(invoice.cancelsInvoiceNumber)
            })
          }
        }
        issuedBefore = true
        return entry
      }
      case 'paid':
        return { at: change.createdAt, label: t('Als bezahlt markiert') }
      case 'overdue':
        return { at: change.createdAt, label: t('Als überfällig markiert') }
      case 'cancelled':
        return {
          at: change.createdAt,
          label: t('Storniert'),
          ...(invoice.cancelledByInvoiceId && {
            link: {
              invoiceId: invoice.cancelledByInvoiceId,
              label: t('Stornorechnung {{invoiceNumberLabel}}', {
                invoiceNumberLabel: invoiceNumberLabel(invoice.cancelledByInvoiceNumber)
              })
            }
          })
        }
      default:
        return { at: change.createdAt, label: t('Entwurf') }
    }
  })
  const emails = [...invoice.emails].reverse().map(
    (email): InvoiceHistoryEntry => ({
      at: email.createdAt,
      label: INVOICE_EMAIL_LABELS[email.kind],
      ...(email.to && { detail: `an ${email.to}` })
    })
  )
  // A hand-over still waiting for its send to be confirmed shows when it started
  const datev = datevTransfers.map(
    (transfer): InvoiceHistoryEntry => ({
      at: transfer.sentAt ?? transfer.createdAt,
      label: transfer.sentAt ? t('An DATEV übergeben') : t('Übergabe an DATEV wird bestätigt'),
      detail: t('{{value}}, an {{to}}', {
        value: DATEV_CATEGORY_LABELS[transfer.category],
        to: transfer.to
      })
    })
  )
  const later = [...emails, ...datev, ...statuses].sort((a, b) =>
    a.at < b.at ? -1 : a.at > b.at ? 1 : 0
  )
  return [{ at: invoice.createdAt, label: t('Angelegt') }, ...later]
}
