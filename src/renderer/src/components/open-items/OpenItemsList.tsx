import { Link } from '@tanstack/react-router'
import { BedDouble, ClipboardList, FileSignature, Receipt, Ticket, Wallet } from 'lucide-react'
import type { OpenItemDto } from '../../../../main/api/schemas/open_items.schema'
import { localIsoDate } from '@/lib/followUps'
import { openItemKey, openItemTab, openItemText } from './openItemText'
import { t } from '../../../../main/i18n/translate'

/** The row: a link to the event tab, or a checkbox label while selecting */
function Row({
  item,
  selected,
  onToggle,
  children
}: {
  item: OpenItemDto
  selected?: ReadonlySet<string>
  onToggle?: (item: OpenItemDto) => void
  children: React.ReactNode
}) {
  if (selected) {
    return (
      <label className="group flex cursor-pointer items-start gap-3 rounded-sm text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
          checked={selected.has(openItemKey(item))}
          onChange={() => onToggle?.(item)}
        />
        {children}
      </label>
    )
  }
  return (
    <Link
      to="/events/$eventId"
      params={{ eventId: String(item.eventId) }}
      search={{ tab: openItemTab(item) }}
      className="group flex items-start gap-3 rounded-sm text-sm"
    >
      {children}
    </Link>
  )
}

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
 * With `selected` each row gets a checkbox instead of its link (the dashboard's "Auswählen").
 */
export function OpenItemsList({
  items,
  showEvent = false,
  selected,
  onToggle
}: {
  items: OpenItemDto[]
  showEvent?: boolean
  selected?: ReadonlySet<string>
  onToggle?: (item: OpenItemDto) => void
}) {
  const today = localIsoDate()
  return (
    <ul className="divide-y" aria-label={t('Offene Punkte')}>
      {items.map((item) => {
        const Icon = ICONS[item.kind]
        const overdue = item.date < today && item.kind !== 'hotel' && item.kind !== 'advancing'
        return (
          <li key={openItemKey(item)} className="py-2 first:pt-0 last:pb-0">
            <Row item={item} selected={selected} onToggle={onToggle}>
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
            </Row>
          </li>
        )
      })}
    </ul>
  )
}
