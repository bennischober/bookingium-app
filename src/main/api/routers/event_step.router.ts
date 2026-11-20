import { initTRPC, TRPCError } from '@trpc/server'
import { container } from 'tsyringe'
import { EventStepService } from '../../services/EventStepService'
import { ListEventStepsInput, SetEventStepInput } from '../schemas/event_step.schema'

const t = initTRPC.create()
const service = container.resolve(EventStepService)

/** Steps of a show ticked as done outside the program ("extern erledigt") */
export const eventStepRouter = t.router({
  list: t.procedure.input(ListEventStepsInput).query(({ input }) => service.list(input.eventId)),

  set: t.procedure.input(SetEventStepInput).mutation(({ input }) => {
    try {
      return service.set(input)
    } catch (error) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          error instanceof Error && error.message
            ? error.message
            : 'Schritt konnte nicht gespeichert werden'
      })
    }
  })
})
