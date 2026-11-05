import { RowTable, type ListQuery } from '@/components/detail/DetailParts'
import { InvoiceStatusBadge } from '@/components/invoice/InvoiceStatusBadge'
import { useOpenInvoice } from '@/hooks/useOpenInvoice'
import { formatMoney, invoiceNumberLabel } from '@/lib/invoiceLabels'
import { formatShortDate } from '@/lib/utils'
import type { InvoiceListItemDto } from '../../../../main/api/schemas/invoice.schema'

/**
 * The invoices of one record (company, band) as a detail-page tab, with the
 * invoice list's columns: who issued it, who receives it. A click opens the
 * print view.
 */
export function RecordInvoicesTable({
  label,
  query,
  empty
}: {
  label: string
  query: ListQuery<InvoiceListItemDto>
  empty: string
}) {
  const openInvoice = useOpenInvoice()
  return (
    <RowTable
      label={label}
      query={query}
      loading="Rechnungen werden geladen…"
      empty={empty}
      itemLabel={{ singular: 'Rechnung', plural: 'Rechnungen' }}
      columns={[
        {
          header: 'Nr.',
          cell: (invoice) => invoiceNumberLabel(invoice.invoiceNumber),
          className: 'whitespace-nowrap font-medium',
          sortValue: (invoice) => invoice.invoiceNumber ?? ''
        },
        {
          header: 'Datum',
          cell: (invoice) => formatShortDate(invoice.issueDate),
          className: 'whitespace-nowrap',
          sortValue: (invoice) => invoice.issueDate
        },
        { header: 'Rechnungssteller', cell: (invoice) => invoice.companyName },
        { header: 'Rechnungsempfänger', cell: (invoice) => invoice.recipientName },
        { header: 'Event', cell: (invoice) => invoice.dealMemoName ?? '–' },
        {
          header: 'Status',
          cell: (invoice) => (
            <InvoiceStatusBadge
              status={invoice.status}
              kind={invoice.kind}
              cancelsInvoiceNumber={invoice.cancelsInvoiceNumber}
            />
          )
        },
        {
          header: 'Betrag',
          cell: (invoice) => formatMoney(invoice.totalAmount, invoice.currency),
          className: 'whitespace-nowrap text-right'
        }
      ]}
      onRowClick={openInvoice}
    />
  )
}
