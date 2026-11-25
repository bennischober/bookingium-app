// The calendar page's filter: which calendars it shows, and only some artists or tours.
// Pure, so it is unit-tested; the page keeps the chosen filter in localStorage.

/** The calendars the page can show; a subscribed one is `sub:<id>` */
export type CalendarSource = 'events' | 'agency' | 'appointments' | 'followUps' | `sub:${number}`

export type CalendarFilter = {
  /** The calendars to show; empty = all */
  sources: string[]
  /** Band ids as strings; empty = every artist */
  bands: string[]
  /** Tour names; empty = every tour (and events without one) */
  tours: string[]
}

export const EMPTY_CALENDAR_FILTER: CalendarFilter = { sources: [], bands: [], tours: [] }

export const subscriptionSource = (id: number): CalendarSource => `sub:${id}`

export function isFiltered(filter: CalendarFilter): boolean {
  return filter.sources.length > 0 || filter.bands.length > 0 || filter.tours.length > 0
}

/** An artist or a tour is chosen: the view narrows to what belongs to them */
const narrowed = (filter: CalendarFilter): boolean =>
  filter.bands.length > 0 || filter.tours.length > 0

/**
 * Whether a calendar is shown. Chosen calendars always are. With an artist or a tour chosen
 * and no calendar picked, only events and (for an artist) agency bookings remain: appointments,
 * follow-ups and subscribed calendars belong to no artist or tour.
 */
export function showsSource(filter: CalendarFilter, source: CalendarSource): boolean {
  if (filter.sources.length > 0) return filter.sources.includes(source)
  if (!narrowed(filter)) return true
  if (source === 'events') return true
  if (source === 'agency') return filter.tours.length === 0
  return false
}

/** Events of the chosen artists and tours, when the events calendar is shown */
export function filterEvents<E extends { bandId: number; tour: string }>(
  events: E[],
  filter: CalendarFilter
): E[] {
  if (!showsSource(filter, 'events')) return []
  return events.filter(
    (event) =>
      (filter.bands.length === 0 || filter.bands.includes(String(event.bandId))) &&
      (filter.tours.length === 0 || filter.tours.includes(event.tour))
  )
}

/** Other agencies' bookings of the chosen artists; they have no tour */
export function filterAgencyBookings<B extends { bandId: number }>(
  bookings: B[],
  filter: CalendarFilter
): B[] {
  if (!showsSource(filter, 'agency')) return []
  return bookings.filter(
    (booking) => filter.bands.length === 0 || filter.bands.includes(String(booking.bandId))
  )
}

/** Entries of the shown subscribed calendars */
export function filterSubscribed<S extends { subscriptionId: number }>(
  entries: S[],
  filter: CalendarFilter
): S[] {
  return entries.filter((entry) => showsSource(filter, subscriptionSource(entry.subscriptionId)))
}

/** A stored filter, read leniently: anything unreadable is no filter */
export function parseCalendarFilter(raw: string | null): CalendarFilter {
  if (!raw) return EMPTY_CALENDAR_FILTER
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof CalendarFilter, unknown>>
    const strings = (list: unknown): string[] =>
      Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : []
    return {
      sources: strings(value.sources),
      bands: strings(value.bands),
      tours: strings(value.tours)
    }
  } catch {
    return EMPTY_CALENDAR_FILTER
  }
}
