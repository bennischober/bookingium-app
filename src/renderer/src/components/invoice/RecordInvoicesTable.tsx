import { RowTable, type ListQuery } from '@/components/detail/DetailParts'
import { InvoiceStatusBadge } from '@/components/invoice/InvoiceStatusBadge'
import { useOpenInvoice } from '@/hooks/useOpenInvoice'
import { formatMoney, invoiceNumberLabel } from '@/lib/invoiceLabels'
import { formatShortDate } from '@/lib/utils'
import type { InvoiceListItemDto } from '../../../../main/api/schemas/invoice.schema'
import { t } from '../../../../main/i18n/translate'

/**
 * The invoices of one record (company, band, person) as a detail-page tab, with
 * the invoice list's columns: who issued it, who receives it. A click opens the
 * print view.
 */
export function RecordInvoicesTable({
  label,
  query,
  empty,
  recipient = true
}: {
  label: string
  query: ListQuery<InvoiceListItemDto>
  empty: string
  /** Off where the record is always the recipient (a person's invoices) */
  recipient?: boolean
}) {
  const openInvoice = useOpenInvoice()
  return (
    <RowTable
      label={label}
      query={query}
      loading={t('Rechnungen werden geladen…')}
      empty={empty}
      itemLabel={{ singular: t('Rechnung'), plural: t('Rechnungen') }}
      columns={[
        {
          header: t('Nr.'),
          cell: (invoice) => invoiceNumberLabel(invoice.invoiceNumber),
          className: 'whitespace-nowrap font-medium',
          sortValue: (invoice) => invoice.invoiceNumber ?? ''
        },
        {
          header: t('Datum'),
          cell: (invoice) => formatShortDate(invoice.issueDate),
          className: 'whitespace-nowrap',
          sortValue: (invoice) => invoice.issueDate
        },
        { header: t('Rechnungssteller'), cell: (invoice) => invoice.companyName },
        ...(recipient
          ? [
              {
                header: t('Rechnungsempfänger'),
                cell: (invoice: InvoiceListItemDto) => invoice.recipientName
              }
            ]
          : []),
        { header: t('Event'), cell: (invoice) => invoice.dealMemoName ?? '–' },
        {
          header: t('Status'),
          cell: (invoice) => (
            <InvoiceStatusBadge
              status={invoice.status}
              kind={invoice.kind}
              cancelsInvoiceNumber={invoice.cancelsInvoiceNumber}
            />
          )
        },
        {
          header: t('Betrag'),
          cell: (invoice) => formatMoney(invoice.totalAmount, invoice.currency),
          className: 'whitespace-nowrap text-right'
        }
      ]}
      onRowClick={openInvoice}
    />
  )
}
