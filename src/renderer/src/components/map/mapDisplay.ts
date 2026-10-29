// Pure helpers for the map page (#102): colours per marker kind and the
// radius-ring defaults. Unit-tested directly; the Leaflet code stays thin.

import type { MapMarkerDto } from '../../../../main/api/schemas/map.schema'

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
