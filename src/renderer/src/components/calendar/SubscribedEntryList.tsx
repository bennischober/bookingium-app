import { cn } from '@/lib/utils'
import type { SubscribedEntryDto } from '../../../../main/api/schemas/calendar_subscription.schema'
import { t } from '../../../../main/i18n/translate'

function timeLabel(entry: SubscribedEntryDto, day: string): string {
  if (entry.startTime === null) return t('ganztägig')
  const starts = entry.startDate === day
  const ends = entry.endDate === day
  if (starts && ends) {
    return entry.endTime && entry.endTime !== entry.startTime
      ? `${entry.startTime}–${entry.endTime}`
      : entry.startTime
  }
  if (starts) return t('ab {{time}}', { time: entry.startTime })
  if (ends && entry.endTime) return t('bis {{time}}', { time: entry.endTime })
  return t('ganztägig')
}

/**
 * #53: entries of subscribed calendars on a day. Read-only: they change in the calendar they
 * come from. The dot has the subscription's color; a cancelled entry stays, struck through.
 */
export function SubscribedEntryList({
  entries,
  day
}: {
  entries: SubscribedEntryDto[]
  day: string
}) {
  return (
    <ul className="space-y-2" aria-label={t('Abonnierte Kalender')}>
      {entries.map((entry) => (
        <li
          key={entry.key}
          className="flex gap-2 text-sm"
          title={entry.description || undefined}
          data-testid="subscribed-entry"
        >
          <span
            aria-hidden
            className="mt-1.5 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <div className="min-w-0">
            <p
              className={cn('font-medium', entry.cancelled && 'line-through text-muted-foreground')}
            >
              <span className="mr-1.5 font-normal tabular-nums text-muted-foreground">
                {timeLabel(entry, day)}
              </span>
              {entry.title || t('(ohne Titel)')}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {[entry.location, entry.subscriptionName].filter(Boolean).join(' · ')}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}
