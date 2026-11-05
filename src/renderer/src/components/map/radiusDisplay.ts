// Pure helpers for the radius clause (Gebietsschutz) fields (#102): the text
// drafts of the form inputs, their parsing, and the clause as one line.
// Unit-tested directly; the components stay thin.

import type { RadiusClause, RadiusOverrideDto } from '../../../../main/api/schemas/radius.schema'
import { RADIUS_KM_MAX, RADIUS_WEEKS_MAX } from '../../../../main/map/radius'

// The defaults and their resolution per kind are the main process's (pure module)
export { defaultClause, type RadiusDefaults } from '../../../../main/map/radius'

/** The three inputs as typed; '' = inherit (override) or invalid (default) */
export type RadiusDraft = { km: string; weeksBefore: string; weeksAfter: string }

/**
 * An override over a fallback, per field (null inherits): `effectiveClause` of
 * map/radius.ts for one layer, on the camelCase DTO the renderer holds
 */
export function inheritClause(
  override: RadiusOverrideDto | null | undefined,
  fallback: RadiusClause
): RadiusClause {
  return {
    km: override?.radiusKm ?? fallback.km,
    weeksBefore: override?.radiusWeeksBefore ?? fallback.weeksBefore,
    weeksAfter: override?.radiusWeeksAfter ?? fallback.weeksAfter
  }
}

/** Whether an override sets any field */
export function hasOverride(override: RadiusOverrideDto | null | undefined): boolean {
  return (
    override?.radiusKm != null ||
    override?.radiusWeeksBefore != null ||
    override?.radiusWeeksAfter != null
  )
}

/** "100 km · 4 Wochen vorher, 4 nachher" */
export function formatClause(clause: RadiusClause): string {
  const weeks = (n: number) => (n === 1 ? '1 Woche' : `${n} Wochen`)
  return `${clause.km.toLocaleString('de-DE')} km · ${weeks(clause.weeksBefore)} vorher, ${clause.weeksAfter} nachher`
}

export function draftFromOverride(override: RadiusOverrideDto | null | undefined): RadiusDraft {
  return {
    km: override?.radiusKm?.toString() ?? '',
    weeksBefore: override?.radiusWeeksBefore?.toString() ?? '',
    weeksAfter: override?.radiusWeeksAfter?.toString() ?? ''
  }
}

export function draftFromClause(clause: RadiusClause): RadiusDraft {
  return {
    km: clause.km.toString(),
    weeksBefore: clause.weeksBefore.toString(),
    weeksAfter: clause.weeksAfter.toString()
  }
}

/** One input: '' -> null, else a whole number in range, else the error message */
function parseField(text: string, min: number, max: number): number | null | string {
  const trimmed = text.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value < min || value > max) {
    return `ganze Zahl von ${min} bis ${max.toLocaleString('de-DE')}`
  }
  return value
}

export type ParsedOverride =
  | {
      ok: true
      value: {
        radiusKm: number | null
        radiusWeeksBefore: number | null
        radiusWeeksAfter: number | null
      }
    }
  | { ok: false; error: string }

/** The drafts as an override input; empty fields inherit */
export function parseOverrideDraft(draft: RadiusDraft): ParsedOverride {
  const km = parseField(draft.km, 1, RADIUS_KM_MAX)
  const before = parseField(draft.weeksBefore, 0, RADIUS_WEEKS_MAX)
  const after = parseField(draft.weeksAfter, 0, RADIUS_WEEKS_MAX)
  if (typeof km === 'string') return { ok: false, error: `Radius: ${km}` }
  if (typeof before === 'string') return { ok: false, error: `Wochen vorher: ${before}` }
  if (typeof after === 'string') return { ok: false, error: `Wochen nachher: ${after}` }
  return { ok: true, value: { radiusKm: km, radiusWeeksBefore: before, radiusWeeksAfter: after } }
}

/** The drafts as a complete clause (the defaults); every field required */
export function parseClauseDraft(
  draft: RadiusDraft
): { ok: true; value: RadiusClause } | { ok: false; error: string } {
  const parsed = parseOverrideDraft(draft)
  if (!parsed.ok) return parsed
  const { radiusKm, radiusWeeksBefore, radiusWeeksAfter } = parsed.value
  if (radiusKm === null || radiusWeeksBefore === null || radiusWeeksAfter === null) {
    return { ok: false, error: 'Alle drei Felder ausfüllen' }
  }
  return {
    ok: true,
    value: { km: radiusKm, weeksBefore: radiusWeeksBefore, weeksAfter: radiusWeeksAfter }
  }
}
