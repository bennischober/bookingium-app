import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  EXTERNAL_BOOKING_STATUS_LABELS,
  type ExternalBookingDto
} from '../../../../main/api/schemas/external_booking.schema'
import { t } from '../../../../main/i18n/translate'

/**
 * #103: agency bookings of a day, as the calendar lists them. Plain entries,
 * not links: they are read-only, and there is no page to open. A cancelled
 * one stays listed, struck through - it frees the day.
 */
export function AgencyBookingList({ bookings }: { bookings: ExternalBookingDto[] }) {
  return (
    <ul className="space-y-2" aria-label={t('Agenturbuchungen')}>
      {bookings.map((booking) => {
        const place = [booking.venueName, [booking.zipCode, booking.city].filter(Boolean).join(' ')]
          .filter(Boolean)
          .join(', ')
        const cancelled = booking.status === 'cancelled'
        return (
          <li key={booking.id} className="text-sm" title={booking.notes || undefined}>
            <p className={cn('font-medium', cancelled && 'line-through text-muted-foreground')}>
              {booking.bandName}
              {place && <span className="font-normal text-muted-foreground"> @ {place}</span>}
            </p>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-800">
                {t('Agenturbuchung')}
              </Badge>
              {booking.agency}
              {booking.status !== 'confirmed' &&
                ` · ${EXTERNAL_BOOKING_STATUS_LABELS[booking.status]}`}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
