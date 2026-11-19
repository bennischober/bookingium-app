import { injectable } from 'tsyringe'
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { AdvancingStatus } from '../api/schemas/advancing.schema'

// #232: advancing (one per event), the ticket quota (one per event) and the sales reports

const personColumns = {
  id: schema.person.id,
  firstName: schema.person.first_name,
  lastName: schema.person.last_name,
  email: schema.contact.email,
  phone: schema.contact.phone,
  mobile: schema.contact.mobile_phone
}

export type PersonRow = {
  id: number
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  mobile: string | null
}

@injectable()
export class AdvancingRepository {
  eventExists(eventId: number): boolean {
    return Boolean(
      db
        .select({ id: schema.deal_memo.id })
        .from(schema.deal_memo)
        .where(eq(schema.deal_memo.id, eventId))
        .get()
    )
  }

  advancingOf(eventIds: number[]) {
    if (eventIds.length === 0) return []
    return db
      .select()
      .from(schema.event_advancing)
      .where(inArray(schema.event_advancing.deal_memo_id, eventIds))
      .all()
  }

  quotasOf(eventIds: number[]) {
    if (eventIds.length === 0) return []
    return db
      .select()
      .from(schema.event_ticket_quota)
      .where(inArray(schema.event_ticket_quota.deal_memo_id, eventIds))
      .all()
  }

  /** Newest first per event */
  reportsOf(eventIds: number[]) {
    if (eventIds.length === 0) return []
    return db
      .select()
      .from(schema.ticket_report)
      .where(inArray(schema.ticket_report.deal_memo_id, eventIds))
      .orderBy(desc(schema.ticket_report.report_date))
      .all()
  }

  persons(ids: number[]): PersonRow[] {
    if (ids.length === 0) return []
    return db
      .select(personColumns)
      .from(schema.person)
      .leftJoin(schema.contact, eq(schema.contact.id, schema.person.contact_id))
      .where(inArray(schema.person.id, ids))
      .all()
  }

  /**
   * The contact on site of the latest other show at the same club, for a show without one:
   * the same people usually run the venue on the next date too
   */
  previousLocalContactId(eventId: number): number | null {
    const event = db
      .select({ venueId: schema.deal_memo.venue_id, date: schema.deal_memo.date })
      .from(schema.deal_memo)
      .where(eq(schema.deal_memo.id, eventId))
      .get()
    if (!event?.venueId) return null
    const row = db
      .select({ contactId: schema.event_advancing.local_contact_id })
      .from(schema.event_advancing)
      .innerJoin(schema.deal_memo, eq(schema.deal_memo.id, schema.event_advancing.deal_memo_id))
      .where(
        and(
          eq(schema.deal_memo.venue_id, event.venueId),
          ne(schema.deal_memo.id, eventId),
          isNotNull(schema.event_advancing.local_contact_id)
        )
      )
      .orderBy(desc(schema.deal_memo.date))
      .get()
    return row?.contactId ?? null
  }

  saveAdvancing(input: {
    eventId: number
    status: AdvancingStatus
    statusDate: string | null
    localContactId: number | null
    notes: string
  }): void {
    db.insert(schema.event_advancing)
      .values({
        deal_memo_id: input.eventId,
        status: input.status,
        status_date: input.statusDate,
        local_contact_id: input.localContactId,
        notes: input.notes
      })
      .onConflictDoUpdate({
        target: schema.event_advancing.deal_memo_id,
        set: {
          status: input.status,
          status_date: input.statusDate,
          local_contact_id: input.localContactId,
          notes: input.notes,
          updated_at: sql`datetime('now')`
        }
      })
      .run()
  }

  saveQuota(input: { eventId: number; quota: number | null; quotaNote: string }): void {
    db.insert(schema.event_ticket_quota)
      .values({ deal_memo_id: input.eventId, quota: input.quota, quota_note: input.quotaNote })
      .onConflictDoUpdate({
        target: schema.event_ticket_quota.deal_memo_id,
        set: { quota: input.quota, quota_note: input.quotaNote, updated_at: sql`datetime('now')` }
      })
      .run()
  }

  /** One report per show and day: a second one the same day replaces it */
  saveReport(input: { eventId: number; reportDate: string; sold: number; note: string }): void {
    db.insert(schema.ticket_report)
      .values({
        deal_memo_id: input.eventId,
        report_date: input.reportDate,
        sold: input.sold,
        note: input.note
      })
      .onConflictDoUpdate({
        target: [schema.ticket_report.deal_memo_id, schema.ticket_report.report_date],
        set: { sold: input.sold, note: input.note }
      })
      .run()
  }

  deleteReport(id: number): void {
    db.delete(schema.ticket_report).where(eq(schema.ticket_report.id, id)).run()
  }

  /** The shows of a tour (not archived), by date, with what the overview shows beside them */
  tourShows(tour: string, bandId: number | null) {
    return db
      .select({
        id: schema.deal_memo.id,
        date: schema.deal_memo.date,
        status: schema.deal_memo.status,
        bandName: schema.band.name,
        venueName: schema.venue.name,
        city: schema.address.city,
        promoterName: schema.company.name
      })
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.band.id, schema.deal_memo.band_id))
      .leftJoin(schema.venue, eq(schema.venue.id, schema.deal_memo.venue_id))
      .leftJoin(schema.address, eq(schema.address.id, schema.venue.address_id))
      .leftJoin(schema.company, eq(schema.company.id, schema.deal_memo.lopro_company_id))
      .where(
        and(
          eq(schema.deal_memo.tour, tour),
          isNull(schema.deal_memo.archived_at),
          bandId === null ? undefined : eq(schema.deal_memo.band_id, bandId)
        )
      )
      .orderBy(asc(schema.deal_memo.date))
      .all()
  }
}
