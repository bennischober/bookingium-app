// Pure marker building for the map preview (#102): turns the rows the
// MapService queries into the markers the page draws, applying the page's
// filters (kind, band, date range) and the radius clauses (which venues an
// event blocks, what a candidate booking would collide with). Unit-tested
// directly; no database, no Electron. Rows are snake_case (straight from
// drizzle), markers camelCase - this module is the map's one seam.

import { countryCodeOf } from '../einvoice/codes'
import { DEFAULT_CLUB_RADIUS, DEFAULT_FESTIVAL_RADIUS } from '../api/schemas/radius.schema'
import type { MapKindFilter } from '../api/schemas/map.schema'
import { lookupPostcode, type Coordinates } from './postcodeLookup'
import {
  clauseWindow,
  defaultClause,
  distanceKm,
  effectiveClause,
  inWindow,
  isIsoDate,
  windowOverlaps,
  type RadiusDefaults,
  type RadiusRow,
  type RadiusWindow
} from './radius'

/** The map page's filters, as the procedure receives them */
export type MapDataFilter = {
  kinds?: MapKindFilter[]
  bandId?: number
  dateFrom?: string
  dateTo?: string
  /** Only the events of this tour (agency bookings have none, so they drop out) */
  tour?: string
  /** What-if: booking this venue on this date - what would it block, what collides? */
  candidate?: { venueId: number; date: string }
}

/** Confirmed bookings block; everything still open (pending, legacy '') is a risk */
export type MapEventStatus = 'confirmed' | 'pending'

/**
 * An event that blocks (confirmed) or endangers (pending) a venue. `agency`
 * marks an agency booking (#103): `eventId` is then its booking id, and it has
 * no event page to link to.
 */
export type MapBlock = { eventId: number; name: string; date: string; agency?: string }

/**
 * A marker on the map: an event (deal memo), an agency booking (#103, read-only,
 * booked by someone else) or a venue, at postcode precision
 */
export type MapMarker = {
  type: 'event' | 'agency' | 'venue'
  id: number
  /** Venue kind of the marker (or of the event's venue): 'venue' = club */
  kind: 'venue' | 'festival'
  name: string
  /** Event date (ISO YYYY-MM-DD); venues have none */
  date?: string
  /** Events: confirmed or still open */
  status?: MapEventStatus
  /** Events: the radius clause that applies (event ?? venue ?? default), as km and window */
  ring?: RadiusWindow
  /** Agency bookings: who booked it */
  agency?: string
  /** Events: the tour it belongs to, '' for none */
  tour?: string
  /**
   * Shows: the band's other shows (events and agency bookings) it collides with - one lies in
   * the other's radius clause, in distance and time. The clause binds a band, so only the
   * same band's shows count.
   */
  conflicts?: MapBlock[]
  /** Venues: the km of their own clause, else their kind's default - the ring "Umkreis aller Orte" */
  radiusKm?: number
  /** Bands of the event / bands that played at the venue (per the filters) */
  bandIds: number[]
  /** Venues, with a band chosen: the band's confirmed events whose ring covers it */
  blockedBy?: MapBlock[]
  /** Venues, with a band chosen: the band's open offers whose ring covers it */
  riskBy?: MapBlock[]
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

/**
 * An event (deal memo) with its venue's kind and address, as queried. An
 * agency booking (#103) comes as one too: `agency` set, no venue, its own
 * kind and address, the kind's default clause.
 */
export type MapEventRow = {
  id: number
  name: string
  date: string
  status: string
  band_id: number
  venue_id: number | null
  venue_kind: string | null
  address: MapAddressRow | null
  /** The event's own clause override; absent = none */
  radius?: RadiusRow | null
  /** Its venue's clause override; absent = none */
  venue_radius?: RadiusRow | null
  /** Set for an agency booking: the agency that booked it */
  agency?: string
  /** The event's tour, '' for none; agency bookings have none */
  tour?: string
}

/** A venue with its address, as queried */
export type MapVenueRow = {
  id: number
  name: string
  kind: string
  address: MapAddressRow | null
  /** The venue's clause override; absent = none */
  radius?: RadiusRow | null
}

/** Why an entry is not on the map - the page says so, so the user knows what to fix */
export type UnlocatedReason = 'no_venue' | 'no_address' | 'unknown_postcode' | 'invalid_date'

/** A filtered event or venue without a known location */
export type MapUnlocated = {
  type: 'event' | 'agency' | 'venue'
  id: number
  /** Venue kind, so the page links a venue to its Clubs or Festivals page */
  kind: 'venue' | 'festival'
  name: string
  reason: UnlocatedReason
}

/**
 * How an existing event of the band collides with the candidate:
 * candidate_covers - the event lies inside the candidate's ring and window;
 * event_covers     - the candidate lies inside the event's ring and window;
 * both             - each covers the other;
 * unknown_location - the dates collide, but a location is unknown: check by hand.
 */
export type MapConflictKind = 'candidate_covers' | 'event_covers' | 'both' | 'unknown_location'

export type MapConflict = {
  eventId: number
  name: string
  date: string
  status: MapEventStatus
  /** An agency booking (#103): eventId is its booking id */
  agency?: string
  /** Whole km between the two venues; null when a location is unknown */
  distanceKm: number | null
  kind: MapConflictKind
}

/** A venue inside the candidate's ring */
export type MapCandidateBlock = {
  id: number
  name: string
  kind: 'venue' | 'festival'
  distanceKm: number
}

/** The what-if booking: its ring, the venues it would block, the band's events it collides with */
export type MapCandidate = {
  venueId: number
  name: string
  kind: 'venue' | 'festival'
  date: string
  ring: RadiusWindow
  located: boolean
  lat?: number
  lng?: number
  /** Venues inside the ring, nearest first (the candidate itself left out) */
  blocks: MapCandidateBlock[]
  /** The chosen band's events that collide, by date; empty without a band */
  conflicts: MapConflict[]
}

/** What the map procedure returns: drawn markers, the not-located list, the what-if */
export type MapData = {
  markers: MapMarker[]
  unlocated: MapUnlocated[]
  candidate: MapCandidate | null
}

/** Defaults when no settings are passed (tests, a fresh install) */
const FALLBACK_DEFAULTS: RadiusDefaults = {
  club: DEFAULT_CLUB_RADIUS,
  festival: DEFAULT_FESTIVAL_RADIUS
}

/** "Street 1, 10115 Berlin" from the address parts; empty parts are left out */
export function formatAddressLabel(address: MapAddressRow): string {
  const street = [address.street, address.street_number].filter(Boolean).join(' ')
  const place = [address.zip_code, address.city].filter(Boolean).join(' ')
  return [street, place].filter(Boolean).join(', ')
}

/** Whether the kind filter lets the kind through (no kinds given = no filter) */
export function kindShown(kinds: MapKindFilter[] | undefined, kind: 'venue' | 'festival'): boolean {
  if (!kinds || kinds.length === 0) return true
  return kinds.includes(kind)
}

/**
 * The address's country for the lookup: the stored code, else the country name
 * ("Deutschland", "Austria"), as the e-invoice check reads it. country_code
 * defaults to '' and is often left empty, so without the name fallback such an
 * address silently dropped off the map. With neither, a five-digit postcode
 * counts as German - the app's home market and the import's default; the
 * four-digit AT/CH codes stay ambiguous and unlocated.
 */
export function countryOf(address: MapAddressRow): string | null {
  const code = countryCodeOf(address.country_code, address.country)
  if (code) return code
  const unnamed = !address.country.trim() && !address.country_code.trim()
  return unnamed && /^\d{5}$/.test(address.zip_code.trim()) ? 'DE' : null
}

/** Coordinates for an address row, or null without a usable postcode */
export function locate(address: MapAddressRow | null): Coordinates | null {
  if (!address) return null
  const country = countryOf(address)
  return country ? lookupPostcode(country, address.zip_code) : null
}

const venueKind = (kind: string | null): 'venue' | 'festival' =>
  kind === 'festival' ? 'festival' : 'venue'

const eventStatus = (status: string): MapEventStatus =>
  status === 'confirmed' ? 'confirmed' : 'pending'

/** An event with what the clause checks need: its window and its location */
type PlacedEvent = {
  row: MapEventRow
  kind: 'venue' | 'festival'
  status: MapEventStatus
  ring: RadiusWindow
  coordinates: Coordinates | null
}

/** A venue with its kind and location, looked up once per query */
type PlacedVenue = {
  row: MapVenueRow
  kind: 'venue' | 'festival'
  coordinates: Coordinates | null
}

/** The block (or conflict) entry for an event or agency booking */
function blockOf(row: MapEventRow): MapBlock {
  return {
    eventId: row.id,
    name: row.name,
    date: row.date,
    ...(row.agency !== undefined ? { agency: row.agency } : {})
  }
}

function placeEvent(event: MapEventRow, defaults: RadiusDefaults): PlacedEvent {
  const kind = venueKind(event.venue_kind)
  const clause = effectiveClause(event.radius, event.venue_radius, defaultClause(defaults, kind))
  return {
    row: event,
    kind,
    status: eventStatus(event.status),
    ring: clauseWindow(event.date, clause),
    coordinates: locate(event.address)
  }
}

/**
 * Builds the map's markers from the queried rows: one marker per event and one
 * per venue, filters applied.
 *
 * An event shows while its clause window overlaps the date range - a show three
 * weeks before the range still blocks the start of it. Each event marker
 * carries its ring: the event's clause, else its venue's, else the kind's
 * default (Einstellungen).
 *
 * With a band chosen, every venue shows and says whether the band is free
 * there: venues inside a confirmed event's ring are blocked by it, inside an
 * open offer's ring at risk. Without a band there is nothing to block - the
 * clause binds a band - so venues only collect the bands that played there.
 *
 * Events without a venue and addresses without a known postcode come back
 * `located: false` - not drawn, but listed as „nicht auf der Karte".
 */
export function buildMapData(
  events: MapEventRow[],
  venues: MapVenueRow[],
  filter: MapDataFilter,
  defaults: RadiusDefaults = FALLBACK_DEFAULTS
): MapData {
  // A cancelled gig never happens, so it draws no ring and blocks nothing; archived events are
  // already out (the service filters them, D3). An event whose date is not YYYY-MM-DD has no
  // window: it is listed as „nicht auf der Karte“ instead of failing the whole query.
  const live = events.filter((event) => event.status !== 'cancelled')
  const activeEvents = live
    .filter((event) => isIsoDate(event.date))
    .map((event) => placeEvent(event, defaults))
  const placedVenues: PlacedVenue[] = venues.map((row) => ({
    row,
    kind: venueKind(row.kind),
    coordinates: locate(row.address)
  }))

  // The band's events in the date range, whatever their kind: a festival's ring blocks the
  // clubs inside it even while the map shows only clubs
  const bandEventsInRange = activeEvents.filter(
    (event) =>
      (filter.bandId === undefined || event.row.band_id === filter.bandId) &&
      (filter.tour === undefined || (event.row.tour ?? '') === filter.tour) &&
      windowOverlaps(event.ring, filter.dateFrom, filter.dateTo)
  )
  const shownEvents = bandEventsInRange.filter((event) => kindShown(filter.kinds, event.kind))

  const bandsByVenue = new Map<number, number[]>()
  for (const { row } of shownEvents) {
    if (row.venue_id === null) continue
    const bands = bandsByVenue.get(row.venue_id) ?? []
    if (!bands.includes(row.band_id)) bands.push(row.band_id)
    bandsByVenue.set(row.venue_id, bands)
  }

  const markers: MapMarker[] = []
  const unlocated: MapData['unlocated'] = []

  const conflictsOf = showConflicts(activeEvents)
  for (const event of shownEvents) {
    const { row, kind, status, ring, coordinates } = event
    const type = row.agency !== undefined ? 'agency' : 'event'
    markers.push({
      type,
      id: row.id,
      kind,
      name: row.name,
      date: row.date,
      status,
      ring,
      ...(row.agency !== undefined ? { agency: row.agency } : { tour: row.tour ?? '' }),
      conflicts: conflictsOf.get(event) ?? [],
      bandIds: [row.band_id],
      located: coordinates !== null,
      addressLabel: row.address ? formatAddressLabel(row.address) : '',
      ...(coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : {})
    })
    if (!coordinates) {
      unlocated.push({
        type,
        id: row.id,
        kind,
        name: row.name,
        // An agency booking has no venue record, only the address its export gave
        reason:
          row.venue_id === null && row.agency === undefined
            ? 'no_venue'
            : row.address
              ? 'unknown_postcode'
              : 'no_address'
      })
    }
  }
  for (const row of live) {
    if (isIsoDate(row.date)) continue
    const kind = venueKind(row.venue_kind)
    if (!kindShown(filter.kinds, kind)) continue
    if (filter.bandId !== undefined && row.band_id !== filter.bandId) continue
    if (filter.tour !== undefined && (row.tour ?? '') !== filter.tour) continue
    unlocated.push({
      type: row.agency !== undefined ? 'agency' : 'event',
      id: row.id,
      kind,
      name: row.name,
      reason: 'invalid_date'
    })
  }

  // Rings that can block: the chosen band's events in the range with a location, any kind
  const blockingEvents =
    filter.bandId === undefined
      ? []
      : bandEventsInRange.flatMap((event) =>
          event.coordinates ? [{ ...event, coordinates: event.coordinates }] : []
        )

  for (const { row: venueRow, kind, coordinates } of placedVenues) {
    if (!kindShown(filter.kinds, kind)) continue
    const venueClause = effectiveClause(null, venueRow.radius, defaultClause(defaults, kind))
    const blockedBy: MapBlock[] = []
    const riskBy: MapBlock[] = []
    if (coordinates) {
      for (const event of blockingEvents) {
        if (distanceKm(coordinates, event.coordinates) > event.ring.km) continue
        const block = blockOf(event.row)
        if (event.status === 'confirmed') blockedBy.push(block)
        else riskBy.push(block)
      }
    }
    markers.push({
      type: 'venue',
      id: venueRow.id,
      kind,
      name: venueRow.name,
      bandIds: bandsByVenue.get(venueRow.id) ?? [],
      radiusKm: venueClause.km,
      ...(filter.bandId !== undefined ? { blockedBy, riskBy } : {}),
      located: coordinates !== null,
      addressLabel: venueRow.address ? formatAddressLabel(venueRow.address) : '',
      ...(coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : {})
    })
    if (!coordinates) {
      unlocated.push({
        type: 'venue',
        id: venueRow.id,
        kind,
        name: venueRow.name,
        reason: venueRow.address ? 'unknown_postcode' : 'no_address'
      })
    }
  }

  return {
    markers,
    unlocated,
    candidate: filter.candidate
      ? buildCandidate(filter.candidate, activeEvents, placedVenues, filter, defaults)
      : null
  }
}

/**
 * For each show, the same band's other shows it collides with: one lies inside the other's
 * ring (distance) while its date falls in the other's window. Cancelled shows are already out;
 * shows without a location cannot be checked. Every pair of a band is checked once (windows differ
 * in size, so no early stop), in date order.
 */
export function showConflicts(events: PlacedEvent[]): Map<PlacedEvent, MapBlock[]> {
  const conflicts = new Map<PlacedEvent, MapBlock[]>()
  const byBand = new Map<number, PlacedEvent[]>()
  for (const event of events) {
    if (!event.coordinates) continue
    byBand.set(event.row.band_id, [...(byBand.get(event.row.band_id) ?? []), event])
  }
  for (const shows of byBand.values()) {
    shows.sort((a, b) => a.row.date.localeCompare(b.row.date))
    for (let i = 0; i < shows.length; i++) {
      for (let j = i + 1; j < shows.length; j++) {
        const a = shows[i]
        const b = shows[j]
        const distance = distanceKm(a.coordinates!, b.coordinates!)
        const aCovers = inWindow(a.ring, b.row.date) && distance <= a.ring.km
        const bCovers = inWindow(b.ring, a.row.date) && distance <= b.ring.km
        if (!aCovers && !bCovers) continue
        conflicts.set(a, [...(conflicts.get(a) ?? []), blockOf(b.row)])
        conflicts.set(b, [...(conflicts.get(b) ?? []), blockOf(a.row)])
      }
    }
  }
  for (const list of conflicts.values()) list.sort((a, b) => a.date.localeCompare(b.date))
  return conflicts
}

/**
 * The what-if booking: the candidate venue's clause (its own, else the kind's
 * default) applied to the date. It blocks the venues inside its ring, and
 * collides with the band's events in both directions - an event inside the
 * candidate's ring and window, or the candidate inside an event's. The band's
 * events count whatever the kind and date filters say: a clause does not care
 * what the map shows. Null for an unknown venue or a date that is not YYYY-MM-DD.
 */
function buildCandidate(
  candidate: NonNullable<MapDataFilter['candidate']>,
  events: PlacedEvent[],
  venues: PlacedVenue[],
  filter: MapDataFilter,
  defaults: RadiusDefaults
): MapCandidate | null {
  const venue = venues.find(({ row }) => row.id === candidate.venueId)
  if (!venue || !isIsoDate(candidate.date)) return null
  const { row: venueRow, kind, coordinates } = venue
  const ring = clauseWindow(
    candidate.date,
    effectiveClause(null, venueRow.radius, defaultClause(defaults, kind))
  )

  const blocks: MapCandidateBlock[] = []
  if (coordinates) {
    for (const other of venues) {
      if (other.row.id === venueRow.id) continue
      if (!kindShown(filter.kinds, other.kind)) continue
      if (!other.coordinates) continue
      const distance = distanceKm(coordinates, other.coordinates)
      if (distance > ring.km) continue
      blocks.push({
        id: other.row.id,
        name: other.row.name,
        kind: other.kind,
        distanceKm: Math.round(distance)
      })
    }
    blocks.sort((a, b) => a.distanceKm - b.distanceKm || a.name.localeCompare(b.name))
  }

  const conflicts: MapConflict[] = []
  if (filter.bandId !== undefined) {
    for (const event of events) {
      if (event.row.band_id !== filter.bandId) continue
      const datesCollide = inWindow(ring, event.row.date) || inWindow(event.ring, candidate.date)
      const base = { ...blockOf(event.row), status: event.status }
      if (!coordinates || !event.coordinates) {
        if (datesCollide) conflicts.push({ ...base, distanceKm: null, kind: 'unknown_location' })
        continue
      }
      const distance = distanceKm(coordinates, event.coordinates)
      const candidateCovers = inWindow(ring, event.row.date) && distance <= ring.km
      const eventCovers = inWindow(event.ring, candidate.date) && distance <= event.ring.km
      if (!candidateCovers && !eventCovers) continue
      conflicts.push({
        ...base,
        distanceKm: Math.round(distance),
        kind:
          candidateCovers && eventCovers
            ? 'both'
            : candidateCovers
              ? 'candidate_covers'
              : 'event_covers'
      })
    }
    conflicts.sort((a, b) => a.date.localeCompare(b.date) || a.eventId - b.eventId)
  }

  return {
    venueId: venueRow.id,
    name: venueRow.name,
    kind,
    date: candidate.date,
    ring,
    located: coordinates !== null,
    ...(coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : {}),
    blocks,
    conflicts
  }
}
