import { z } from 'zod'

// ========================================
// Radius clause (Gebietsschutz), #102
// ========================================
// How far around a show, and how long before and after it, the band may not
// play elsewhere. Layered: the event's own clause, else its venue's, else the
// global default for the venue kind (Einstellungen). Each field falls back on
// its own, so an event can override only the km and keep the venue's weeks.

/** km around the venue; 2000 km covers any European clause */
export const RadiusKm = z.number().int().min(1).max(2000)
/** Weeks before or after the show; two years is beyond any real clause */
export const RadiusWeeks = z.number().int().min(0).max(104)

/** A complete clause, as the global defaults store it */
export const RadiusClause = z.object({
  km: RadiusKm,
  weeksBefore: RadiusWeeks,
  weeksAfter: RadiusWeeks
})
export type RadiusClause = z.infer<typeof RadiusClause>

/** Suggested defaults, to confirm with the bookers: clubs 100 km ±4 weeks, festivals 300 km ±8 weeks */
export const DEFAULT_CLUB_RADIUS: RadiusClause = { km: 100, weeksBefore: 4, weeksAfter: 4 }
export const DEFAULT_FESTIVAL_RADIUS: RadiusClause = { km: 300, weeksBefore: 8, weeksAfter: 8 }

/** An override on a venue or event: each field null = inherit */
export const RadiusOverrideDto = z.object({
  radiusKm: z.number().nullable(),
  radiusWeeksBefore: z.number().nullable(),
  radiusWeeksAfter: z.number().nullable()
})
export type RadiusOverrideDto = z.infer<typeof RadiusOverrideDto>

/** The override fields of a create/update input; undefined = keep (update), null = inherit */
export const RadiusOverrideInput = z.object({
  radiusKm: RadiusKm.nullable().optional(),
  radiusWeeksBefore: RadiusWeeks.nullable().optional(),
  radiusWeeksAfter: RadiusWeeks.nullable().optional()
})
export type RadiusOverrideInput = z.infer<typeof RadiusOverrideInput>
