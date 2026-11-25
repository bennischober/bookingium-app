import { injectable } from 'tsyringe'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { EventStep, EventStepRef } from '../api/schemas/event_step.schema'

// Steps of a show done outside the program ("extern erledigt"); a row = ticked

@injectable()
export class EventStepRepository {
  eventExists(eventId: number): boolean {
    return Boolean(
      db
        .select({ id: schema.deal_memo.id })
        .from(schema.deal_memo)
        .where(eq(schema.deal_memo.id, eventId))
        .get()
    )
  }

  listByEvent(eventId: number) {
    return db
      .select()
      .from(schema.event_step_done)
      .where(eq(schema.event_step_done.deal_memo_id, eventId))
      .orderBy(asc(schema.event_step_done.id))
      .all()
  }

  /** Ticks a step; ticking it again keeps the first tick */
  tick(eventId: number, step: EventStep): void {
    db.insert(schema.event_step_done)
      .values({ deal_memo_id: eventId, step })
      .onConflictDoNothing({
        target: [schema.event_step_done.deal_memo_id, schema.event_step_done.step]
      })
      .run()
  }

  untick(eventId: number, step: EventStep): void {
    db.delete(schema.event_step_done)
      .where(
        and(eq(schema.event_step_done.deal_memo_id, eventId), eq(schema.event_step_done.step, step))
      )
      .run()
  }

  /**
   * Ticks (done) or unticks several steps in one transaction and returns those that changed:
   * a step already ticked is not ticked again, one not ticked is not unticked. An unknown event
   * rolls everything back.
   */
  setMany(steps: EventStepRef[], done: boolean): EventStepRef[] {
    return db.transaction((tx) => {
      const changed: EventStepRef[] = []
      for (const { eventId, step } of steps) {
        const exists = tx
          .select({ id: schema.deal_memo.id })
          .from(schema.deal_memo)
          .where(eq(schema.deal_memo.id, eventId))
          .get()
        if (!exists) throw new Error('Event nicht gefunden')
        const result = done
          ? tx
              .insert(schema.event_step_done)
              .values({ deal_memo_id: eventId, step })
              .onConflictDoNothing({
                target: [schema.event_step_done.deal_memo_id, schema.event_step_done.step]
              })
              .run()
          : tx
              .delete(schema.event_step_done)
              .where(
                and(
                  eq(schema.event_step_done.deal_memo_id, eventId),
                  eq(schema.event_step_done.step, step)
                )
              )
              .run()
        if (result.changes > 0) changed.push({ eventId, step })
      }
      return changed
    })
  }
}
