import { injectable } from 'tsyringe'
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type {
  CreateFollowUpInput,
  FollowUpRecordType,
  UpdateFollowUpInput
} from '../api/schemas/followUp.schema'

const RECORD_COLUMNS = {
  event: schema.follow_up.event_id,
  band: schema.follow_up.band_id,
  venue: schema.follow_up.venue_id,
  company: schema.follow_up.company_id,
  person: schema.follow_up.person_id
} as const satisfies Record<FollowUpRecordType, unknown>

const RECORD_KEYS = {
  event: 'event_id',
  band: 'band_id',
  venue: 'venue_id',
  company: 'company_id',
  person: 'person_id'
} as const satisfies Record<FollowUpRecordType, keyof typeof schema.follow_up.$inferInsert>

/** A follow-up with the names of the record it is on */
export type FollowUpRow = ReturnType<FollowUpRepository['listOpen']>[number]

@injectable()
export class FollowUpRepository {
  private select(where: SQL | undefined) {
    return db
      .select({
        followUp: schema.follow_up,
        eventName: schema.deal_memo.name,
        eventDate: schema.deal_memo.date,
        bandName: schema.band.name,
        venueName: schema.venue.name,
        companyName: schema.company.name,
        personFirstName: schema.person.first_name,
        personLastName: schema.person.last_name
      })
      .from(schema.follow_up)
      .leftJoin(schema.deal_memo, eq(schema.follow_up.event_id, schema.deal_memo.id))
      .leftJoin(schema.band, eq(schema.follow_up.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.follow_up.venue_id, schema.venue.id))
      .leftJoin(schema.company, eq(schema.follow_up.company_id, schema.company.id))
      .leftJoin(schema.person, eq(schema.follow_up.person_id, schema.person.id))
      .where(where)
      .orderBy(asc(schema.follow_up.due_date), asc(schema.follow_up.id))
      .all()
  }

  /** Every open follow-up, earliest first */
  listOpen() {
    return this.select(isNull(schema.follow_up.done_at))
  }

  /** Open follow-ups on one record */
  listOpenByRecord(type: FollowUpRecordType, id: number) {
    return this.select(and(isNull(schema.follow_up.done_at), eq(RECORD_COLUMNS[type], id)))
  }

  getById(id: number) {
    return this.select(eq(schema.follow_up.id, id))[0] ?? null
  }

  create(input: CreateFollowUpInput): number {
    const record = input.record ? { [RECORD_KEYS[input.record.type]]: input.record.id } : {}
    return db
      .insert(schema.follow_up)
      .values({ due_date: input.dueDate, note: input.note, ...record })
      .returning({ id: schema.follow_up.id })
      .get().id
  }

  update(input: UpdateFollowUpInput): void {
    db.update(schema.follow_up)
      .set({
        ...(input.dueDate !== undefined && { due_date: input.dueDate }),
        ...(input.note !== undefined && { note: input.note }),
        updated_at: sql`datetime('now')`
      })
      .where(eq(schema.follow_up.id, input.id))
      .run()
  }

  setDone(id: number, done: boolean): void {
    db.update(schema.follow_up)
      .set({
        done_at: done ? sql`datetime('now')` : null,
        updated_at: sql`datetime('now')`
      })
      .where(eq(schema.follow_up.id, id))
      .run()
  }

  delete(id: number): void {
    db.delete(schema.follow_up).where(eq(schema.follow_up.id, id)).run()
  }
}
