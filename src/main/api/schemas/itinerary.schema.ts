import { z } from 'zod'
import { TimestampFields } from './base.schema'

/**
 * Full DTO for an itinerary record.
 * An itinerary is always 1-to-1 with a deal_memo and holds the
 * day-of running-order schedule.
 */
export const ItineraryDto = z.object({
  id: z.number(),
  dealMemoId: z.number(),
  notes: z.string(),
  getIn: z.string(),
  loadIn: z.string(),
  soundCheckMainAct: z.string(),
  soundCheckSupport: z.string(),
  dinner: z.string(),
  doors: z.string(),
  showTimeMainAct: z.string(),
  showTimeSupport: z.string(),
  curfewStage: z.string(),
  curfewVenue: z.string(),
  showLength: z.string()
}).extend(TimestampFields.shape)

export type ItineraryDto = z.infer<typeof ItineraryDto>

/**
 * Input for creating or replacing the itinerary of a deal memo.
 * All schedule fields are optional so callers can save partial drafts.
 */
export const UpsertItineraryInput = z.object({
  dealMemoId: z.number(),
  notes: z.string().optional(),
  getIn: z.string().optional(),
  loadIn: z.string().optional(),
  soundCheckMainAct: z.string().optional(),
  soundCheckSupport: z.string().optional(),
  dinner: z.string().optional(),
  doors: z.string().optional(),
  showTimeMainAct: z.string().optional(),
  showTimeSupport: z.string().optional(),
  curfewStage: z.string().optional(),
  curfewVenue: z.string().optional(),
  showLength: z.string().optional()
})

export type UpsertItineraryInput = z.infer<typeof UpsertItineraryInput>
