import { injectable } from 'tsyringe'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { EventStep } from '../api/schemas/event_step.schema'

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
}
