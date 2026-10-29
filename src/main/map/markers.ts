// Pure marker building for the map preview (#102): turns the rows the
// MapService queries into the markers the page draws, applying the page's
// filters (kind, band, date range). Unit-tested directly; no database, no
// Electron. Rows are snake_case (straight from drizzle), markers camelCase -
// this module is the map's one seam.

import { lookupPostcode, type Coordinates } from './postcodeLookup'

/** The marker kinds the page can filter to */
export type MapKindFilter = 'venue' | 'festival'

/** The map page's filters, as the procedure receives them */
export type MapDataFilter = {
  kinds?: MapKindFilter[]
  bandId?: number
  dateFrom?: string
  dateTo?: string
}

/** A marker on the map: an event (deal memo) or a venue, at postcode precision */
export type MapMarker = {
  type: 'event' | 'venue'
  id: number
  /** Venue kind of the marker (or of the event's venue): 'venue' = club */
  kind: 'venue' | 'festival'
  name: string
  /** Event date (ISO YYYY-MM-DD); venues have none */
  date?: string
  /** Bands of the event / bands that played at the venue (per the filters) */
  bandIds: number[]
  /** false for an address without a known postcode - not drawn, but listed */
  located: boolean
  /** "Street 1, 10115 Berlin" - how the address reads, not the stored columns */
  addressLabel: string
  lat?: number
  lng?: number
}

/** An address as the service queries it (snake_case columns) */
export type MapAddressRow = {
  street: string
  street_number: string
  zip_code: string
  city: string
  country: string
  country_code: string
}

/** An event (deal memo) with its venue's kind and address, as queried */
export type MapEventRow = {
  id: number
  name: string
  date: string
  status: string
  band_id: number
  venue_id: number | null
  venue_kind: string | null
  address: MapAddressRow | null
}

/** A venue with its address, as queried */
export type MapVenueRow = {
  id: number
  name: string
  kind: string
  address: MapAddressRow | null
}

/** What the map procedure returns: drawn markers plus the not-located list */
export type MapData = {
  markers: MapMarker[]
  /** The filtered events and venues without a known location */
  unlocated: Array<{ type: 'event' | 'venue'; id: number; name: string }>
}

/** "Street 1, 10115 Berlin" from the address parts; empty parts are left out */
export function formatAddressLabel(address: MapAddressRow): string {
  const street = [address.street, address.street_number].filter(Boolean).join(' ')
  const place = [address.zip_code, address.city].filter(Boolean).join(' ')
  return [street, place].filter(Boolean).join(', ')
}

/** Filters events by ISO date range; an undefined bound keeps that side open */
export function eventInDateRange(date: string, dateFrom?: string, dateTo?: string): boolean {
  if (dateFrom && date < dateFrom) return false
  if (dateTo && date > dateTo) return false
  return true
}

/** Whether the kind filter lets the kind through (no kinds given = no filter) */
export function kindShown(kinds: MapKindFilter[] | undefined, kind: 'venue' | 'festival'): boolean {
  if (!kinds || kinds.length === 0) return true
  return kinds.includes(kind)
}

/** Coordinates for an address row, or null without a usable postcode */
export function locate(address: MapAddressRow | null): Coordinates | null {
  if (!address) return null
  return lookupPostcode(address.country_code, address.zip_code)
}

/**
 * Builds the map's markers from the queried rows: one marker per event and one
 * per venue, filters applied. Venues collect the bands that played there (the
 * shown events at them), so the band filter narrows venues too: a venue stays
 * visible only when a shown event took place at it. Events without a venue and
 * addresses without a known postcode come back `located: false` - not drawn,
 * but listed as „nicht auf der Karte".
 */
export function buildMapData(
  events: MapEventRow[],
  venues: MapVenueRow[],
  filter: MapDataFilter
): MapData {
  const shownEvents = events.filter(
    (event) =>
      // A cancelled gig never happens, so it draws no ring; archived events are
      // already out (the service filters them, D3)
      event.status !== 'cancelled' &&
      kindShown(filter.kinds, event.venue_kind === 'festival' ? 'festival' : 'venue') &&
      (filter.bandId === undefined || event.band_id === filter.bandId) &&
      eventInDateRange(event.date, filter.dateFrom, filter.dateTo)
  )

  const bandsByVenue = new Map<number, number[]>()
  for (const event of shownEvents) {
    if (event.venue_id === null) continue
    const bands = bandsByVenue.get(event.venue_id) ?? []
    if (!bands.includes(event.band_id)) bands.push(event.band_id)
    bandsByVenue.set(event.venue_id, bands)
  }

  const markers: MapMarker[] = []
  const unlocated: MapData['unlocated'] = []

  for (const event of shownEvents) {
    const coordinates = locate(event.address)
    markers.push({
      type: 'event',
      id: event.id,
      kind: event.venue_kind === 'festival' ? 'festival' : 'venue',
      name: event.name,
      date: event.date,
      bandIds: [event.band_id],
      located: coordinates !== null,
      addressLabel: event.address ? formatAddressLabel(event.address) : '',
      ...(coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : {})
    })
    if (!coordinates) {
      unlocated.push({ type: 'event', id: event.id, name: event.name })
    }
  }

  for (const venueRow of venues) {
    const kind = venueRow.kind === 'festival' ? 'festival' : 'venue'
    if (!kindShown(filter.kinds, kind)) continue
    const bands = bandsByVenue.get(venueRow.id) ?? []
    // With a band filter, only venues where a shown event took place remain
    if (filter.bandId !== undefined && !bands.includes(filter.bandId)) continue
    const coordinates = locate(venueRow.address)
    markers.push({
      type: 'venue',
      id: venueRow.id,
      kind,
      name: venueRow.name,
      bandIds: bands,
      located: coordinates !== null,
      addressLabel: venueRow.address ? formatAddressLabel(venueRow.address) : '',
      ...(coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : {})
    })
    if (!coordinates) {
      unlocated.push({ type: 'venue', id: venueRow.id, name: venueRow.name })
    }
  }

  return { markers, unlocated }
}
