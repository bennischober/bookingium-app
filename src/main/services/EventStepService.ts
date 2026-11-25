import { inject, injectable } from 'tsyringe'
import { EventStepRepository } from '../repositories/EventStepRepository'
import type {
  EventStepDoneDto,
  SetEventStepInput,
  SetManyEventStepsInput,
  SetManyEventStepsResult
} from '../api/schemas/event_step.schema'
import { EventStep } from '../api/schemas/event_step.schema'

/** Steps of a show ticked as done outside the program ("extern erledigt") */
@injectable()
export class EventStepService {
  constructor(@inject(EventStepRepository) private repository: EventStepRepository) {}

  list(eventId: number): EventStepDoneDto[] {
    return this.repository.listByEvent(eventId).map((row) => ({
      step: EventStep.parse(row.step),
      doneAt: row.created_at
    }))
  }

  /** Ticks or unticks a step and returns the event's ticked steps */
  set(input: SetEventStepInput): EventStepDoneDto[] {
    if (!this.repository.eventExists(input.eventId)) throw new Error('Event nicht gefunden')
    if (input.done) this.repository.tick(input.eventId, input.step)
    else this.repository.untick(input.eventId, input.step)
    return this.list(input.eventId)
  }

  /** Ticks or unticks several steps at once (the same step twice counts once) */
  setMany(input: SetManyEventStepsInput): SetManyEventStepsResult {
    const seen = new Set<string>()
    const steps = input.steps.filter(({ eventId, step }) => {
      const key = `${eventId}:${step}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return { changed: this.repository.setMany(steps, input.done) }
  }
}
