// Radius clauses (Gebietsschutz) for the map preview (#102): which clause an
// event carries, the time window it covers, and the distance check. Pure - no
// database, no Electron; the marker builder (markers.ts) applies it.

import type { RadiusClause } from '../api/schemas/radius.schema'
import type { Coordinates } from './postcodeLookup'

/** A stored override (venue or event), snake_case as queried; null fields inherit */
export type RadiusRow = {
  radius_km: number | null
  radius_weeks_before: number | null
  radius_weeks_after: number | null
}

/** km around the venue; 2000 km covers any European clause */
export const RADIUS_KM_MAX = 2000
/** Weeks before or after the show; two years is beyond any real clause */
export const RADIUS_WEEKS_MAX = 104

/** The global defaults per venue kind (Einstellungen) */
export type RadiusDefaults = { club: RadiusClause; festival: RadiusClause }

/** A clause applied to a date: km around the venue, ISO window from-to (inclusive) */
export type RadiusWindow = { km: number; from: string; to: string }

/**
 * The clause that applies: the event's own, else its venue's, else the kind's
 * default - per field, so an event can override only the km and keep the
 * venue's weeks.
 */
export function effectiveClause(
  event: RadiusRow | null | undefined,
  venue: RadiusRow | null | undefined,
  fallback: RadiusClause
): RadiusClause {
  return {
    km: event?.radius_km ?? venue?.radius_km ?? fallback.km,
    weeksBefore: event?.radius_weeks_before ?? venue?.radius_weeks_before ?? fallback.weeksBefore,
    weeksAfter: event?.radius_weeks_after ?? venue?.radius_weeks_after ?? fallback.weeksAfter
  }
}

/** The default for a venue kind ('venue' = club) */
export function defaultClause(defaults: RadiusDefaults, kind: 'venue' | 'festival'): RadiusClause {
  return kind === 'festival' ? defaults.festival : defaults.club
}

/** Whether a string is a real calendar date as YYYY-MM-DD (2027-02-30 is not) */
export function isIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

/** ISO date shifted by whole days (UTC, so no daylight-saving drift); check isIsoDate first */
export function shiftIsoDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`)
  shifted.setUTCDate(shifted.getUTCDate() + days)
  return shifted.toISOString().slice(0, 10)
}

/** The clause applied to a show date */
export function clauseWindow(date: string, clause: RadiusClause): RadiusWindow {
  return {
    km: clause.km,
    from: shiftIsoDate(date, -7 * clause.weeksBefore),
    to: shiftIsoDate(date, 7 * clause.weeksAfter)
  }
}

/** Whether a window overlaps a date range; an undefined bound keeps that side open */
export function windowOverlaps(window: RadiusWindow, dateFrom?: string, dateTo?: string): boolean {
  if (dateFrom && window.to < dateFrom) return false
  if (dateTo && window.from > dateTo) return false
  return true
}

/** Whether a date falls inside a window */
export function inWindow(window: RadiusWindow, date: string): boolean {
  return window.from <= date && date <= window.to
}

/** Mean earth radius (IUGG), km */
const EARTH_RADIUS_KM = 6371.0088

/** Great-circle distance in km (haversine); postcode precision, so whole km are plenty */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}
