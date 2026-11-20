import { Link } from '@tanstack/react-router'
import { BedDouble, ClipboardList, FileSignature, Receipt, Ticket, Wallet } from 'lucide-react'
import type { OpenItemDto } from '../../../../main/api/schemas/open_items.schema'
import { localIsoDate } from '@/lib/followUps'
import { openItemTab, openItemText } from './openItemText'
import { t } from '../../../../main/i18n/translate'

const ICONS: Record<OpenItemDto['kind'], typeof Wallet> = {
  contract: FileSignature,
  deposit: Wallet,
  invoice: Receipt,
  hotel: BedDouble,
  advancing: ClipboardList,
  tickets: Ticket
}

/**
 * #201: open points as rows, each a link to the event tab where it is resolved. With
 * `showEvent` (dashboard) each row names its event; on the event page it would repeat the title.
 */
export function OpenItemsList({
  items,
  showEvent = false
}: {
  items: OpenItemDto[]
  showEvent?: boolean
}) {
  const today = localIsoDate()
  return (
    <ul className="divide-y" aria-label={t('Offene Punkte')}>
      {items.map((item) => {
        const Icon = ICONS[item.kind]
        const overdue = item.date < today && item.kind !== 'hotel' && item.kind !== 'advancing'
        return (
          <li
            key={`${item.kind}-${item.eventId}-${item.depositPosition ?? ''}`}
            className="py-2 first:pt-0 last:pb-0"
          >
            <Link
              to="/events/$eventId"
              params={{ eventId: String(item.eventId) }}
              search={{ tab: openItemTab(item) }}
              className="group flex items-start gap-3 rounded-sm text-sm"
            >
              <Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${overdue ? 'text-amber-600' : 'text-muted-foreground'}`}
                aria-hidden
              />
              <span className="min-w-0">
                {showEvent && (
                  <span className="block font-medium group-hover:underline">
                    {item.eventName}
                    {item.bandName && (
                      <span className="font-normal text-muted-foreground"> · {item.bandName}</span>
                    )}
                  </span>
                )}
                <span className={showEvent ? 'text-muted-foreground' : 'group-hover:underline'}>
                  {openItemText(item, today)}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
