// Pure helpers for the map page (#102): colours per marker kind, the radius
// clause rings, free and blocked venues, and the what-if labels. Unit-tested
// directly; the Leaflet code stays thin.

import type {
  MapConflictDto,
  MapMarkerDto,
  MapUnlocatedDto
} from '../../../../main/api/schemas/map.schema'

/** Ring for an event marker, in metres: its radius clause; venues draw none */
export function ringMetres(marker: Pick<MapMarkerDto, 'type' | 'ring'>): number | null {
  if (marker.type !== 'event' || !marker.ring) return null
  return marker.ring.km * 1000
}

/** Tailwind-independent colours for Leaflet, per marker kind and state */
export const MARKER_COLORS = {
  event: '#22c55e',
  venue: '#3b82f6',
  festival: '#a855f7',
  /** A venue inside a confirmed ring of the chosen band */
  blocked: '#9ca3af',
  /** A venue inside an open offer's ring: outline only */
  risk: '#f59e0b',
  /** The what-if booking */
  candidate: '#f97316'
} as const

/** With a band chosen: whether a venue is free, at risk (open offer) or blocked */
export type VenueAvailability = 'free' | 'risk' | 'blocked'

/** A venue's availability for the chosen band; null without one (or for events) */
export function venueAvailability(
  marker: Pick<MapMarkerDto, 'type' | 'blockedBy' | 'riskBy'>
): VenueAvailability | null {
  if (marker.type !== 'venue' || !marker.blockedBy) return null
  if (marker.blockedBy.length > 0) return 'blocked'
  return (marker.riskBy?.length ?? 0) > 0 ? 'risk' : 'free'
}

/** Colour of a marker dot, per type and kind; a blocked venue is grey */
export function markerColor(
  marker: Pick<MapMarkerDto, 'type' | 'kind'> & Partial<Pick<MapMarkerDto, 'blockedBy'>>
): string {
  if (marker.type === 'event') return MARKER_COLORS.event
  if ((marker.blockedBy?.length ?? 0) > 0) return MARKER_COLORS.blocked
  return marker.kind === 'festival' ? MARKER_COLORS.festival : MARKER_COLORS.venue
}

/**
 * Colour of an event's radius ring: the venue kind's colour (blue club ring,
 * purple festival ring), so ring size and colour read as one. Venues draw no
 * ring.
 */
export function ringColor(marker: Pick<MapMarkerDto, 'type' | 'kind'>): string | null {
  if (marker.type !== 'event') return null
  return marker.kind === 'festival' ? MARKER_COLORS.festival : MARKER_COLORS.venue
}

/** One-line label for a marker: name, then the date for events */
export function markerTitle(marker: MapMarkerDto): string {
  if (marker.type === 'event') {
    const date = marker.date ? new Date(`${marker.date}T00:00:00`).toLocaleDateString('de-DE') : ''
    return date ? `${marker.name} · ${date}` : marker.name
  }
  return marker.name
}

/** km label for the ring legend, German notation */
export function ringLabel(metres: number): string {
  return `${(metres / 1000).toLocaleString('de-DE')} km`
}

/** ISO date in German notation */
function germanDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('de-DE')
}

/** "100 km, 3.4.2026 – 29.5.2026": a clause applied to a show */
export function ringWindowLabel(ring: { km: number; from: string; to: string }): string {
  return `${ring.km.toLocaleString('de-DE')} km, ${germanDate(ring.from)} – ${germanDate(ring.to)}`
}

/** How an existing event collides with the what-if booking */
export const CONFLICT_KIND_LABELS: Record<MapConflictDto['kind'], string> = {
  both: 'gegenseitig im Gebietsschutz',
  candidate_covers: 'liegt im Gebietsschutz der Anfrage',
  event_covers: 'Anfrage liegt in seinem Gebietsschutz',
  unknown_location: 'Ort unbekannt, Zeitraum überschneidet sich – bitte prüfen'
}

/** Escapes user data for Leaflet's HTML popups and tooltips */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/** Why an entry is not on the map, as the page's list says it */
export const UNLOCATED_REASON_LABELS: Record<MapUnlocatedDto['reason'], string> = {
  no_venue: 'kein Club/Festival',
  no_address: 'keine Adresse',
  unknown_postcode: 'PLZ unbekannt'
}

/** Hash link to a marker's detail page; venues live under the list of their kind */
export function markerHref(marker: Pick<MapMarkerDto, 'type' | 'kind' | 'id'>): string {
  if (marker.type === 'event') return `#/events/${marker.id}`
  return `#/${marker.kind === 'festival' ? 'festivals' : 'clubs'}/${marker.id}`
}

/**
 * Everything at one map point. Postcode precision puts an event exactly on its
 * venue, and every event at a venue on the same spot - drawn one by one, only
 * the top dot could be hovered and the rings stacked. A point draws one dot
 * pair, one ring per size and one popup listing all of it.
 */
export type MapPoint = {
  key: string
  lat: number
  lng: number
  venues: MapMarkerDto[]
  /** Sorted by date */
  events: MapMarkerDto[]
}

/** Located markers grouped by their coordinates, venues before events per point */
export function groupByPoint(markers: MapMarkerDto[]): MapPoint[] {
  const points = new Map<string, MapPoint>()
  for (const marker of markers) {
    if (marker.lat === undefined || marker.lng === undefined) continue
    const key = `${marker.lat},${marker.lng}`
    const point = points.get(key) ?? {
      key,
      lat: marker.lat,
      lng: marker.lng,
      venues: [],
      events: []
    }
    if (marker.type === 'venue') point.venues.push(marker)
    else point.events.push(marker)
    points.set(key, point)
  }
  for (const point of points.values()) {
    point.events.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  }
  return [...points.values()]
}

/**
 * The point's rings: one per size its events need, in the venue kind's colour. Dashed for
 * open offers (a risk, not a block) - unless a confirmed event already draws that size.
 */
export function pointRings(
  point: MapPoint
): Array<{ metres: number; color: string; dashed: boolean }> {
  const rings = new Map<number, { color: string; dashed: boolean }>()
  for (const event of point.events) {
    const metres = ringMetres(event)
    const color = ringColor(event)
    if (metres === null || color === null) continue
    const dashed = event.status === 'pending'
    const drawn = rings.get(metres)
    if (!drawn || (drawn.dashed && !dashed)) rings.set(metres, { color, dashed })
  }
  return [...rings.entries()].map(([metres, ring]) => ({ metres, ...ring }))
}

/** Tooltip of a point: the venue (or first event), and how many more entries sit there */
export function pointTitle(point: MapPoint): string {
  const [first, ...rest] = [...point.venues, ...point.events]
  const title = markerTitle(first)
  if (point.venues.length === 1 && point.events.length > 0) {
    return `${title} · ${point.events.length} ${point.events.length === 1 ? 'Event' : 'Events'}`
  }
  return rest.length > 0 ? `${title} · +${rest.length}` : title
}

/** How many events a popup lists before it sums up the rest */
export const POPUP_EVENT_LIMIT = 8

/** Popup of a point: venues with their address, then the events by date, each a link */
export function pointPopupHtml(point: MapPoint): string {
  const link = (marker: MapMarkerDto, text: string) =>
    `<a href="${markerHref(marker)}">${escapeHtml(text)}</a>`
  const parts: string[] = []
  const blocks = (label: string, list: MapMarkerDto['blockedBy']) =>
    list && list.length > 0
      ? `<br>${label}: ${list
          .map(
            (block) =>
              `<a href="#/events/${block.eventId}">${escapeHtml(block.name)} · ${germanDate(block.date)}</a>`
          )
          .join(', ')}`
      : ''
  for (const venue of point.venues) {
    const availability = venueAvailability(venue)
    parts.push(
      `<strong>${link(venue, venue.name)}</strong>${
        venue.addressLabel ? `<br>${escapeHtml(venue.addressLabel)}` : ''
      }${availability === 'free' ? '<br>Frei für die Band' : ''}${blocks(
        'Blockiert durch',
        venue.blockedBy
      )}${blocks('Risiko (ausstehend)', venue.riskBy)}`
    )
  }
  if (point.venues.length === 0 && point.events[0]?.addressLabel) {
    parts.push(escapeHtml(point.events[0].addressLabel))
  }
  if (point.events.length > 0) {
    const shown = point.events.slice(0, POPUP_EVENT_LIMIT)
    const rows = shown.map(
      (event) =>
        `${link(event, markerTitle(event))}${event.status === 'pending' ? ' (ausstehend)' : ''}${
          event.ring ? `<br><small>Gebietsschutz: ${ringWindowLabel(event.ring)}</small>` : ''
        }`
    )
    const more = point.events.length - shown.length
    if (more > 0) rows.push(`+ ${more} weitere`)
    parts.push(rows.join('<br>'))
  }
  // Tailwind's preflight zeroes the margins of hr
  return parts.join('<hr style="margin: 6px 0">')
}
