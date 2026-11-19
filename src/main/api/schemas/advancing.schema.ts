import { z } from 'zod'

// ========================================
// #232: advancing and ticket quota of a show
// ========================================
// Advancing: agreeing the show with the promoter before it - the contact on site and how far
// it is. Tickets: the quota the band plays to and the sales the promoter reports over time.

export const AdvancingStatus = z.enum(['open', 'contacted', 'in_progress', 'done'])
export type AdvancingStatus = z.infer<typeof AdvancingStatus>

export const ADVANCING_STATUS_LABELS: Record<AdvancingStatus, string> = {
  open: 'Offen',
  contacted: 'Angeschrieben',
  in_progress: 'Im Austausch',
  done: 'Abgeschlossen'
}

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum als JJJJ-MM-TT')

export const SaveAdvancingInput = z.object({
  eventId: z.number().int().positive(),
  status: AdvancingStatus,
  /** When the status was reached ("angeschrieben am 05.10."), null for unknown */
  statusDate: IsoDate.nullable(),
  /** The contact on site (Kontakt vor Ort), a person */
  localContactId: z.number().int().positive().nullable(),
  notes: z.string().max(5000)
})
export type SaveAdvancingInput = z.infer<typeof SaveAdvancingInput>

export const SaveTicketQuotaInput = z.object({
  eventId: z.number().int().positive(),
  /** Tickets for sale, null for not known yet */
  quota: z.number().int().min(0).max(1_000_000).nullable(),
  /** What the sheet said instead of a number ("warten auf Bestätigung") */
  quotaNote: z.string().max(500)
})
export type SaveTicketQuotaInput = z.infer<typeof SaveTicketQuotaInput>

export const SaveTicketReportInput = z.object({
  eventId: z.number().int().positive(),
  reportDate: IsoDate,
  /** Tickets sold so far, as of that day */
  sold: z.number().int().min(0).max(1_000_000),
  note: z.string().max(500).default('')
})
export type SaveTicketReportInput = z.infer<typeof SaveTicketReportInput>

export const TicketReportDto = z.object({
  id: z.number(),
  reportDate: z.string(),
  sold: z.number(),
  note: z.string()
})
export type TicketReportDto = z.infer<typeof TicketReportDto>

export const PersonRefDto = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string(),
  phone: z.string()
})
export type PersonRefDto = z.infer<typeof PersonRefDto>

/** Advancing and tickets of one show, as the event tabs and the tour overview show them */
export const ShowAdvancingDto = z.object({
  eventId: z.number(),
  status: AdvancingStatus,
  statusDate: z.string().nullable(),
  localContact: PersonRefDto.nullable(),
  /** No contact yet: the one of the latest show at the same club, to take over */
  suggestedContact: PersonRefDto.nullable(),
  notes: z.string(),
  quota: z.number().nullable(),
  quotaNote: z.string(),
  /** Newest first */
  reports: z.array(TicketReportDto),
  /** The newest report's count, null without reports */
  sold: z.number().nullable(),
  /** sold / quota in percent (0-100+, rounded), null when either is unknown */
  utilization: z.number().nullable()
})
export type ShowAdvancingDto = z.infer<typeof ShowAdvancingDto>

/** One row of the tour overview */
export const TourShowDto = ShowAdvancingDto.omit({ suggestedContact: true }).extend({
  date: z.string(),
  bandName: z.string(),
  venueName: z.string(),
  city: z.string(),
  eventStatus: z.string(),
  promoterName: z.string(),
  /** The report before the newest, for "+12 since" */
  previousSold: z.number().nullable()
})
export type TourShowDto = z.infer<typeof TourShowDto>

export const TourOverviewInput = z.object({
  tour: z.string().max(200),
  bandId: z.number().int().positive().nullable().default(null)
})
export type TourOverviewInput = z.infer<typeof TourOverviewInput>
