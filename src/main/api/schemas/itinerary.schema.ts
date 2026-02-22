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
  notes: z.string().optional().default(''),
  getIn: z.string().optional().default(''),
  loadIn: z.string().optional().default(''),
  soundCheckMainAct: z.string().optional().default(''),
  soundCheckSupport: z.string().optional().default(''),
  dinner: z.string().optional().default(''),
  doors: z.string().optional().default(''),
  showTimeMainAct: z.string().optional().default(''),
  showTimeSupport: z.string().optional().default(''),
  curfewStage: z.string().optional().default(''),
  curfewVenue: z.string().optional().default(''),
  showLength: z.string().optional().default('')
})

export type UpsertItineraryInput = z.infer<typeof UpsertItineraryInput>
