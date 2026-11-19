// #232: advancing and ticket quota of a show - what a sheet's cells say, and the numbers the
// tabs show. Pure: no database, no Electron; the renderer imports it too.

import type { AdvancingStatus } from '../api/schemas/advancing.schema'

const normalize = (raw: string): string => raw.toLowerCase().replace(/\s+/g, ' ').trim()

// Words in a sheet's status cell, checked in this order (the furthest stage wins)
const STAGES: Array<[AdvancingStatus, string[]]> = [
  ['done', ['abgeschlossen', 'erledigt', 'fertig', 'done', 'advanced', 'komplett', 'geklärt']],
  ['in_progress', ['austausch', 'in klärung', 'in arbeit', 'läuft', 'rückmeldung', 'telefoniert']],
  [
    'contacted',
    ['angeschrieben', 'kontaktiert', 'angefragt', 'mail raus', 'gemailt', 'geschrieben']
  ],
  ['open', ['offen', 'open', 'todo', 'noch nicht']]
]

/** "angeschrieben am 05.10." → contacted; null for a cell that names no stage */
export function advancingStatusOf(raw: string): AdvancingStatus | null {
  const text = normalize(raw)
  if (!text) return null
  for (const [status, words] of STAGES) {
    if (words.some((word) => text.includes(word))) return status
  }
  return null
}

/**
 * The day a status cell names ("am 05.10.", "05.10.2026"), as ISO. A day without a year is the
 * last one on or before the show (advancing happens before it); null for none.
 */
export function advancingDateOf(raw: string, showDate: string): string | null {
  const match = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/.exec(raw)
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  if (day < 1 || day > 31 || month < 1 || month > 12) return null
  const iso = (year: number): string =>
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (match[3]) {
    const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3])
    return iso(year)
  }
  const showYear = Number(showDate.slice(0, 4))
  const sameYear = iso(showYear)
  return sameYear <= showDate ? sameYear : iso(showYear - 1)
}

/** A quota cell: "200" → 200; anything else ("warten auf Bestätigung", "none") as note */
export function quotaOf(raw: string): { quota: number | null; note: string } {
  const text = raw.trim()
  const compact = text.replace(/[.\s]/g, '')
  if (/^\d+$/.test(compact)) return { quota: Number(compact), note: '' }
  return { quota: null, note: text }
}

/** A sold-tickets cell: "143" → 143, null for anything else */
export function soldOf(raw: string): number | null {
  const compact = raw.trim().replace(/[.\s]/g, '')
  return /^\d+$/.test(compact) ? Number(compact) : null
}

/** Sold of quota in percent, rounded; null when either is unknown or the quota is 0 */
export function utilizationPercent(sold: number | null, quota: number | null): number | null {
  if (sold === null || quota === null || quota === 0) return null
  return Math.round((sold / quota) * 100)
}
