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

/** One step of one show */
export const EventStepRef = z.object({ eventId: z.number().int().positive(), step: EventStep })
export type EventStepRef = z.infer<typeof EventStepRef>

/**
 * Tick (done: true) or untick several steps at once, e.g. the open points selected on the
 * dashboard; all are saved or none
 */
export const SetManyEventStepsInput = z.object({
  steps: z.array(EventStepRef).min(1).max(5000),
  done: z.boolean()
})
export type SetManyEventStepsInput = z.infer<typeof SetManyEventStepsInput>

/** The steps that changed: undoing them puts back exactly what was before */
export const SetManyEventStepsResult = z.object({ changed: z.array(EventStepRef) })
export type SetManyEventStepsResult = z.infer<typeof SetManyEventStepsResult>
