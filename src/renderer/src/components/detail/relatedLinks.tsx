// Link list entries for the relations a detail page overview lists (events, invoices, bands,
// clubs/festivals), and the hook that picks the shows still to come
import { Link } from '@tanstack/react-router'
import { formatShortDate } from '@/lib/utils'
import { localIsoDate } from '@/lib/followUps'
import { formatMoney, INVOICE_STATUS_LABELS, invoiceNumberLabel } from '@/lib/invoiceLabels'
import { useOpenInvoice } from '@/hooks/useOpenInvoice'
import { STATUS_LABELS } from '@/components/event-hub/constants'
import type { LinkItem } from './CompactParts'
import type { DealMemoListItemDto } from '../../../../main/api/schemas/deal_memo.schema'
import type { InvoiceListItemDto } from '../../../../main/api/schemas/invoice.schema'

/** Shows from today on, soonest first */
export function upcoming<T extends { date: string }>(events: T[] | undefined): T[] | undefined {
  if (!events) return undefined
  const today = localIsoDate()
  return events.filter((event) => event.date >= today).sort((a, b) => a.date.localeCompare(b.date))
}

export function eventItems(
  events: DealMemoListItemDto[] | undefined,
  detail: (event: DealMemoListItemDto) => string | null | undefined = (event) => event.venueName
): LinkItem[] | undefined {
  return events?.map((event) => ({
    key: `event-${event.id}`,
    label: (
      <Link
        to="/events/$eventId"
        params={{ eventId: String(event.id) }}
        className="hover:underline"
      >
        {formatShortDate(event.date)} · {event.name}
      </Link>
    ),
    detail: [detail(event), STATUS_LABELS[event.status] ?? event.status].filter(Boolean).join(' · ')
  }))
}

/** Invoices not yet paid or cancelled */
export function openInvoices(invoices: InvoiceListItemDto[] | undefined) {
  return invoices?.filter((invoice) => invoice.status !== 'paid' && invoice.status !== 'cancelled')
}

export function useInvoiceItems(
  invoices: InvoiceListItemDto[] | undefined
): LinkItem[] | undefined {
  const openInvoice = useOpenInvoice()
  return invoices?.map((invoice) => ({
    key: `invoice-${invoice.id}`,
    label: (
      <button type="button" className="hover:underline" onClick={() => openInvoice(invoice)}>
        {invoiceNumberLabel(invoice.invoiceNumber)} · {invoice.recipientName}
      </button>
    ),
    detail: [
      formatMoney(invoice.totalAmount, invoice.currency),
      INVOICE_STATUS_LABELS[invoice.status],
      invoice.dealMemoName
    ]
      .filter(Boolean)
      .join(' · ')
  }))
}

export function bandItems(
  bands: Array<{ id: number; name: string }> | undefined,
  detail?: (band: { id: number; name: string }) => string | null | undefined
): LinkItem[] | undefined {
  return bands?.map((band) => ({
    key: `band-${band.id}`,
    label: (
      <Link to="/band/$bandId" params={{ bandId: String(band.id) }} className="hover:underline">
        {band.name}
      </Link>
    ),
    detail: detail?.(band)
  }))
}

export function venueItems(
  venues: Array<{ id: number; name: string }> | undefined,
  detail?: (venue: { id: number; name: string }) => string | null | undefined
): LinkItem[] | undefined {
  return venues?.map((venue) => ({
    key: `venue-${venue.id}`,
    label: (
      <Link
        to="/venues/$venueId"
        params={{ venueId: String(venue.id) }}
        className="hover:underline"
      >
        {venue.name}
      </Link>
    ),
    detail: detail?.(venue)
  }))
}

export function companyItems(
  companies: Array<{ id: number; name: string }> | undefined,
  detail?: (company: { id: number; name: string }) => string | null | undefined
): LinkItem[] | undefined {
  return companies?.map((company) => ({
    key: `company-${company.id}`,
    label: (
      <Link
        to="/companies/$companyId"
        params={{ companyId: String(company.id) }}
        className="hover:underline"
      >
        {company.name}
      </Link>
    ),
    detail: detail?.(company)
  }))
}
