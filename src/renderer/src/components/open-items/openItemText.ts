// #201: the wording of one open point (pure, unit-tested).
import type { OpenItemDto } from '../../../../main/api/schemas/open_items.schema'
import { formatShortDate } from '@/lib/utils'
import { formatMoney } from '../../../../main/invoice/money'
import { t } from '../../../../main/i18n/translate'

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
      return t('Vertrag am {{formatShortDate}} verschickt, noch nicht unterschrieben zurück', {
        formatShortDate: formatShortDate(item.date)
      })
    case 'deposit': {
      const what = t('{{position}}. Vorkasse über {{amount}}', {
        position: item.depositPosition,
        amount: formatMoney(item.depositAmount ?? 0, 'EUR')
      })
      return item.date < today
        ? t('{{what}} seit {{formatShortDate}} fällig, noch nicht bezahlt', {
            what,
            formatShortDate: formatShortDate(item.date)
          })
        : t('{{what}} heute fällig', { what })
    }
    case 'invoice':
      return item.hasDraftInvoice
        ? t('Show am {{formatShortDate}} vorbei, Rechnung liegt noch als Entwurf vor', {
            formatShortDate: formatShortDate(item.date)
          })
        : t('Show am {{formatShortDate}} vorbei, noch keine Rechnung gestellt', {
            formatShortDate: formatShortDate(item.date)
          })
    case 'hotel':
      return t('Show am {{formatShortDate}}, noch kein Hotel eingetragen', {
        formatShortDate: formatShortDate(item.date)
      })
    case 'advancing':
      return item.advancingStatus === 'contacted'
        ? t('Show am {{formatShortDate}}: Advancing {{value}}angeschrieben, noch keine Antwort', {
            formatShortDate: formatShortDate(item.eventDate),
            value: item.advancingSince
              ? t('seit {{date}} ', { date: formatShortDate(item.advancingSince) })
              : ''
          })
        : item.advancingStatus === 'in_progress'
          ? t('Show am {{formatShortDate}}: Advancing im Austausch, noch nicht abgeschlossen', {
              formatShortDate: formatShortDate(item.eventDate)
            })
          : t('Show am {{formatShortDate}}: Advancing noch nicht begonnen', {
              formatShortDate: formatShortDate(item.eventDate)
            })
    case 'tickets':
      return item.lastReportAt
        ? t('Show am {{formatShortDate}}: letzte Ticketmeldung vom {{formatShortDate2}}', {
            formatShortDate: formatShortDate(item.eventDate),
            formatShortDate2: formatShortDate(item.lastReportAt)
          })
        : t('Show am {{formatShortDate}}: noch keine Ticketmeldung', {
            formatShortDate: formatShortDate(item.eventDate)
          })
  }
}

/** A row's key: the deposits of an event are one row each */
export function openItemKey(item: OpenItemDto): string {
  return `${item.kind}-${item.eventId}-${item.depositPosition ?? ''}`
}
