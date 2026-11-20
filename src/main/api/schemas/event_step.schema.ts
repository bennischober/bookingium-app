import { z } from 'zod'
import { OpenItemKind } from './open_items.schema'

/**
 * The steps of a show that the app tracks and that can be done outside the program
 * ("extern erledigt"): the contract signed on paper, deposits and the invoice settled by the
 * accounting, a hotel booked by the band, advancing by phone, ticket sales known elsewhere,
 * the promoter's settlement done by the accounting. All but the settlement are the kinds of
 * open points, so a ticked step is no open point any more.
 */
export const EventStep = z.enum([...OpenItemKind.options, 'settlement'])
export type EventStep = z.infer<typeof EventStep>

/** One ticked step of a show */
export const EventStepDoneDto = z.object({
  step: EventStep,
  /** When it was ticked (UTC timestamp, `YYYY-MM-DD HH:MM:SS`) */
  doneAt: z.string()
})
export type EventStepDoneDto = z.infer<typeof EventStepDoneDto>

export const ListEventStepsInput = z.object({ eventId: z.number().int().positive() })
export type ListEventStepsInput = z.infer<typeof ListEventStepsInput>

/** Tick (done: true) or untick a step of a show */
export const SetEventStepInput = z.object({
  eventId: z.number().int().positive(),
  step: EventStep,
  done: z.boolean()
})
export type SetEventStepInput = z.infer<typeof SetEventStepInput>
