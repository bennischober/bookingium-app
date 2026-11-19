// #201: the wording of one open point (pure, unit-tested).
import type { OpenItemDto } from '../../../../main/api/schemas/open_items.schema'
import { formatShortDate } from '@/lib/utils'
import { formatMoney } from '../../../../main/invoice/money'

/** The event tab where the point is resolved */
export function openItemTab(
  item: OpenItemDto
): 'financials' | 'itinerary' | 'advancing' | 'tickets' {
  if (item.kind === 'hotel') return 'itinerary'
  if (item.kind === 'advancing' || item.kind === 'tickets') return item.kind
  return 'financials'
}

/** What is open, in one line; `today` is the local date as 2026-11-18 */
export function openItemText(item: OpenItemDto, today: string): string {
  switch (item.kind) {
    case 'contract':
      return `Vertrag am ${formatShortDate(item.date)} verschickt, noch nicht unterschrieben zurück`
    case 'deposit': {
      const what = `${item.depositPosition}. Vorkasse über ${formatMoney(item.depositAmount ?? 0, 'EUR')}`
      return item.date < today
        ? `${what} seit ${formatShortDate(item.date)} fällig, noch nicht bezahlt`
        : `${what} heute fällig`
    }
    case 'invoice':
      return item.hasDraftInvoice
        ? `Show am ${formatShortDate(item.date)} vorbei, Rechnung liegt noch als Entwurf vor`
        : `Show am ${formatShortDate(item.date)} vorbei, noch keine Rechnung gestellt`
    case 'hotel':
      return `Show am ${formatShortDate(item.date)}, noch kein Hotel eingetragen`
    case 'advancing':
      return item.advancingStatus === 'contacted'
        ? `Show am ${formatShortDate(item.eventDate)}: Advancing ${item.advancingSince ? `seit ${formatShortDate(item.advancingSince)} ` : ''}angeschrieben, noch keine Antwort`
        : item.advancingStatus === 'in_progress'
          ? `Show am ${formatShortDate(item.eventDate)}: Advancing im Austausch, noch nicht abgeschlossen`
          : `Show am ${formatShortDate(item.eventDate)}: Advancing noch nicht begonnen`
    case 'tickets':
      return item.lastReportAt
        ? `Show am ${formatShortDate(item.eventDate)}: letzte Ticketmeldung vom ${formatShortDate(item.lastReportAt)}`
        : `Show am ${formatShortDate(item.eventDate)}: noch keine Ticketmeldung`
  }
}
