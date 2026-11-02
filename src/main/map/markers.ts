// Pure marker building for the map preview (#102): turns the rows the
// MapService queries into the markers the page draws, applying the page's
// filters (kind, band, date range) and the radius clauses (which venues an
// event blocks, what a candidate booking would collide with). Unit-tested
// directly; no database, no Electron. Rows are snake_case (straight from
// drizzle), markers camelCase - this module is the map's one seam.

import { countryCodeOf } from '../einvoice/codes'
import { DEFAULT_CLUB_RADIUS, DEFAULT_FESTIVAL_RADIUS } from '../api/schemas/radius.schema'
import { lookupPostcode, type Coordinates } from './postcodeLookup'
import {
  clauseWindow,
  defaultClause,
  distanceKm,
  effectiveClause,
  inWindow,
  windowOverlaps,
  type RadiusDefaults,
  type RadiusRow,
  type RadiusWindow
} from './radius'

/** The marker kinds the page can filter to */
export type MapKindFilter = 'venue' | 'festival'

/** The map page's filters, as the procedure receives them */
export type MapDataFilter = {
  kinds?: MapKindFilter[]
  bandId?: number
  dateFrom?: string
  dateTo?: string
  /** What-if: booking this venue on this date - what would it block, what collides? */
  candidate?: { venueId: number; date: string }
}

/** Confirmed bookings block; everything still open (pending, legacy '') is a risk */
export type MapEventStatus = 'confirmed' | 'pending'

/** An event that blocks (confirmed) or endangers (pending) a venue */
export type MapBlock = { eventId: number; name: string; date: string }

/** A marker on the map: an event (deal memo) or a venue, at postcode precision */
export type MapMarker = {
  type: 'event' | 'venue'
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
  /** The event's own clause override; absent = none */
  radius?: RadiusRow | null
  /** Its venue's clause override; absent = none */
  venue_radius?: RadiusRow | null
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
export type UnlocatedReason = 'no_venue' | 'no_address' | 'unknown_postcode'

/** A filtered event or venue without a known location */
export type MapUnlocated = {
  type: 'event' | 'venue'
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
  // already out (the service filters them, D3)
  const activeEvents = events
    .filter((event) => event.status !== 'cancelled')
    .map((event) => placeEvent(event, defaults))

  const shownEvents = activeEvents.filter(
    (event) =>
      kindShown(filter.kinds, event.kind) &&
      (filter.bandId === undefined || event.row.band_id === filter.bandId) &&
      windowOverlaps(event.ring, filter.dateFrom, filter.dateTo)
  )

  const bandsByVenue = new Map<number, number[]>()
  for (const { row } of shownEvents) {
    if (row.venue_id === null) continue
    const bands = bandsByVenue.get(row.venue_id) ?? []
    if (!bands.includes(row.band_id)) bands.push(row.band_id)
    bandsByVenue.set(row.venue_id, bands)
  }

  const markers: MapMarker[] = []
  const unlocated: MapData['unlocated'] = []

  for (const { row, kind, status, ring, coordinates } of shownEvents) {
    markers.push({
      type: 'event',
      id: row.id,
      kind,
      name: row.name,
      date: row.date,
      status,
      ring,
      bandIds: [row.band_id],
      located: coordinates !== null,
      addressLabel: row.address ? formatAddressLabel(row.address) : '',
      ...(coordinates ? { lat: coordinates.lat, lng: coordinates.lng } : {})
    })
    if (!coordinates) {
      unlocated.push({
        type: 'event',
        id: row.id,
        kind,
        name: row.name,
        reason: row.venue_id === null ? 'no_venue' : row.address ? 'unknown_postcode' : 'no_address'
      })
    }
  }

  // Rings that can block: the shown events of the chosen band with a location
  const blockingEvents =
    filter.bandId === undefined ? [] : shownEvents.filter((event) => event.coordinates !== null)

  for (const venueRow of venues) {
    const kind = venueKind(venueRow.kind)
    if (!kindShown(filter.kinds, kind)) continue
    const coordinates = locate(venueRow.address)
    const blockedBy: MapBlock[] = []
    const riskBy: MapBlock[] = []
    if (coordinates) {
      for (const event of blockingEvents) {
        if (distanceKm(coordinates, event.coordinates!) > event.ring.km) continue
        const block = { eventId: event.row.id, name: event.row.name, date: event.row.date }
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
      ? buildCandidate(filter.candidate, activeEvents, venues, filter, defaults)
      : null
  }
}

/**
 * The what-if booking: the candidate venue's clause (its own, else the kind's
 * default) applied to the date. It blocks the venues inside its ring, and
 * collides with the band's events in both directions - an event inside the
 * candidate's ring and window, or the candidate inside an event's. The band's
 * events count whatever the kind and date filters say: a clause does not care
 * what the map shows. Null for an unknown venue.
 */
function buildCandidate(
  candidate: NonNullable<MapDataFilter['candidate']>,
  events: PlacedEvent[],
  venues: MapVenueRow[],
  filter: MapDataFilter,
  defaults: RadiusDefaults
): MapCandidate | null {
  const venueRow = venues.find((row) => row.id === candidate.venueId)
  if (!venueRow) return null
  const kind = venueKind(venueRow.kind)
  const ring = clauseWindow(
    candidate.date,
    effectiveClause(null, venueRow.radius, defaultClause(defaults, kind))
  )
  const coordinates = locate(venueRow.address)

  const blocks: MapCandidateBlock[] = []
  if (coordinates) {
    for (const other of venues) {
      if (other.id === venueRow.id) continue
      const otherKind = venueKind(other.kind)
      if (!kindShown(filter.kinds, otherKind)) continue
      const otherCoordinates = locate(other.address)
      if (!otherCoordinates) continue
      const distance = distanceKm(coordinates, otherCoordinates)
      if (distance > ring.km) continue
      blocks.push({
        id: other.id,
        name: other.name,
        kind: otherKind,
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
      const base = {
        eventId: event.row.id,
        name: event.row.name,
        date: event.row.date,
        status: event.status
      }
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
