import { z } from 'zod'

/**
 * #201: what an open point is about. Each one is resolved on one tab of its event:
 * contract and deposit in Finanzen, invoice there too, hotel in Tagesablauf.
 */
// #235: advancing not done for a show soon; a quota whose last sales report is old
export const OpenItemKind = z.enum([
  'contract',
  'deposit',
  'invoice',
  'hotel',
  'advancing',
  'tickets'
])
export type OpenItemKind = z.infer<typeof OpenItemKind>

export const OpenItemDto = z.object({
  kind: OpenItemKind,
  eventId: z.number(),
  eventName: z.string(),
  eventDate: z.string(),
  bandName: z.string().nullable(),
  /** The date the point is about (sent, due, show date), for ordering and the text */
  date: z.string(),
  /** deposit: its position (1-based) and net amount in euros */
  depositPosition: z.number().nullable(),
  depositAmount: z.number().nullable(),
  /** invoice: a draft exists but has not been issued */
  hasDraftInvoice: z.boolean(),
  /** advancing: its stage and since when ('open' without a row) */
  advancingStatus: z.string().nullable().default(null),
  advancingSince: z.string().nullable().default(null),
  /** tickets: the newest report's day, null for none */
  lastReportAt: z.string().nullable().default(null)
})
export type OpenItemDto = z.infer<typeof OpenItemDto>

/** All open points, or those of one event */
export const ListOpenItemsInput = z.object({ eventId: z.number().int().positive().optional() })
export type ListOpenItemsInput = z.infer<typeof ListOpenItemsInput>
