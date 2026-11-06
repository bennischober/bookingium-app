import { injectable } from 'tsyringe'
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm'
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
  person: schema.follow_up.person_id,
  invoice: schema.follow_up.invoice_id
} as const satisfies Record<FollowUpRecordType, unknown>

const RECORD_KEYS = {
  event: 'event_id',
  band: 'band_id',
  venue: 'venue_id',
  company: 'company_id',
  person: 'person_id',
  invoice: 'invoice_id'
} as const satisfies Record<FollowUpRecordType, keyof typeof schema.follow_up.$inferInsert>

const DUE_FIRST = [asc(schema.follow_up.due_date), asc(schema.follow_up.id)]

/** A follow-up with the names of the record it is on */
export type FollowUpRow = ReturnType<FollowUpRepository['listOpen']>[number]

@injectable()
export class FollowUpRepository {
  private select(where: SQL | undefined, order: SQL[] = DUE_FIRST, limit?: number) {
    const query = db
      .select({
        followUp: schema.follow_up,
        eventName: schema.deal_memo.name,
        eventDate: schema.deal_memo.date,
        bandName: schema.band.name,
        venueName: schema.venue.name,
        companyName: schema.company.name,
        personFirstName: schema.person.first_name,
        personLastName: schema.person.last_name,
        invoiceNumber: schema.invoice.invoice_number,
        invoiceRecipient: schema.invoice_party_snapshot.legal_name
      })
      .from(schema.follow_up)
      .leftJoin(schema.deal_memo, eq(schema.follow_up.event_id, schema.deal_memo.id))
      .leftJoin(schema.band, eq(schema.follow_up.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.follow_up.venue_id, schema.venue.id))
      .leftJoin(schema.company, eq(schema.follow_up.company_id, schema.company.id))
      .leftJoin(schema.person, eq(schema.follow_up.person_id, schema.person.id))
      .leftJoin(schema.invoice, eq(schema.follow_up.invoice_id, schema.invoice.id))
      .leftJoin(
        schema.invoice_party_snapshot,
        eq(schema.invoice.recipient_snapshot_id, schema.invoice_party_snapshot.id)
      )
      .where(where)
      .orderBy(...order)
      .$dynamic()
    return (limit === undefined ? query : query.limit(limit)).all()
  }

  /** Every open follow-up, earliest first */
  listOpen() {
    return this.select(isNull(schema.follow_up.done_at))
  }

  /** Done follow-ups, the last ticked off first; one more than `limit` tells there are more */
  listDone(limit: number) {
    return this.select(
      isNotNull(schema.follow_up.done_at),
      [desc(schema.follow_up.done_at), desc(schema.follow_up.id)],
      limit + 1
    )
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
    const mail = input.mail
      ? { mail_account_id: input.mail.accountId, mail_message_id: input.mail.messageId }
      : {}
    return db
      .insert(schema.follow_up)
      .values({ due_date: input.dueDate, note: input.note, ...record, ...mail })
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

  /**
   * #121: a reply to one of `messageIds` (without brackets) arrived in this account. Each
   * follow-up waiting for one is closed - once: replied_at marks it, so a follow-up the
   * user brought back stays open when the linker sees the same reply again. Returns how
   * many were closed.
   */
  closeByReplies(accountId: string, messageIds: readonly string[]): number {
    if (messageIds.length === 0) return 0
    let closed = 0
    for (let i = 0; i < messageIds.length; i += 500) {
      closed += db
        .update(schema.follow_up)
        .set({
          replied_at: sql`datetime('now')`,
          done_at: sql`coalesce(${schema.follow_up.done_at}, datetime('now'))`,
          updated_at: sql`datetime('now')`
        })
        .where(
          and(
            eq(schema.follow_up.mail_account_id, accountId),
            inArray(schema.follow_up.mail_message_id, messageIds.slice(i, i + 500)),
            isNull(schema.follow_up.replied_at)
          )
        )
        .run().changes
    }
    return closed
  }

  delete(id: number): void {
    db.delete(schema.follow_up).where(eq(schema.follow_up.id, id)).run()
  }
}
