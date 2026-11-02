// Pure helpers for the map page (#102): colours per marker kind and the
// radius-ring defaults. Unit-tested directly; the Leaflet code stays thin.

import type { MapMarkerDto, MapUnlocatedDto } from '../../../../main/api/schemas/map.schema'

/** Ring around each event in metres: the radius clause reading (to confirm) */
export const CLUB_RING_METRES = 100_000
export const FESTIVAL_RING_METRES = 300_000

/** Ring for an event marker, in metres; venues draw none */
export function ringMetres(marker: Pick<MapMarkerDto, 'type' | 'kind'>): number | null {
  if (marker.type !== 'event') return null
  return marker.kind === 'festival' ? FESTIVAL_RING_METRES : CLUB_RING_METRES
}

/** Tailwind-independent colours for Leaflet, per marker kind */
export const MARKER_COLORS = {
  event: '#22c55e',
  venue: '#3b82f6',
  festival: '#a855f7'
} as const

/** Colour of a marker dot, per type and kind */
export function markerColor(marker: Pick<MapMarkerDto, 'type' | 'kind'>): string {
  if (marker.type === 'event') return MARKER_COLORS.event
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

/** The point's rings: one per size its events need, in the venue kind's colour */
export function pointRings(point: MapPoint): Array<{ metres: number; color: string }> {
  const rings = new Map<number, string>()
  for (const event of point.events) {
    const metres = ringMetres(event)
    const color = ringColor(event)
    if (metres !== null && color !== null && !rings.has(metres)) rings.set(metres, color)
  }
  return [...rings.entries()].map(([metres, color]) => ({ metres, color }))
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
  for (const venue of point.venues) {
    parts.push(
      `<strong>${link(venue, venue.name)}</strong>${
        venue.addressLabel ? `<br>${escapeHtml(venue.addressLabel)}` : ''
      }`
    )
  }
  if (point.venues.length === 0 && point.events[0]?.addressLabel) {
    parts.push(escapeHtml(point.events[0].addressLabel))
  }
  if (point.events.length > 0) {
    const shown = point.events.slice(0, POPUP_EVENT_LIMIT)
    const rows = shown.map((event) => link(event, markerTitle(event)))
    const more = point.events.length - shown.length
    if (more > 0) rows.push(`+ ${more} weitere`)
    parts.push(rows.join('<br>'))
  }
  // Tailwind's preflight zeroes the margins of hr
  return parts.join('<hr style="margin: 6px 0">')
}
