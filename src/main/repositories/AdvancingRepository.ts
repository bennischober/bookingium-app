import { injectable } from 'tsyringe'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { AdvancingStatus } from '../api/schemas/advancing.schema'

// #232: advancing (one per event), the ticket quota (one per event) and the sales reports

/** #235: the role a contact on site gets with the club */
export const LOCAL_CONTACT_ROLE = 'Kontakt vor Ort'

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
    if (row?.contactId) return row.contactId
    // #235: else the club's contact on site, as the last saved advancing put it there
    const member = db
      .select({ personId: schema.venue_member.person_id })
      .from(schema.venue_member)
      .where(
        and(
          eq(schema.venue_member.venue_id, event.venueId),
          eq(schema.venue_member.role, LOCAL_CONTACT_ROLE)
        )
      )
      .get()
    return member?.personId ?? null
  }

  /**
   * #235: the contact on site joins the club's people (role "Kontakt vor Ort"), so the next
   * show there suggests them; someone already with the club keeps their role
   */
  rememberAtVenue(eventId: number, personId: number): void {
    const event = db
      .select({ venueId: schema.deal_memo.venue_id })
      .from(schema.deal_memo)
      .where(eq(schema.deal_memo.id, eventId))
      .get()
    if (!event?.venueId) return
    db.insert(schema.venue_member)
      .values({ venue_id: event.venueId, person_id: personId, role: LOCAL_CONTACT_ROLE })
      .onConflictDoNothing()
      .run()
  }

  /** The current advancing stage of a show, null without a row */
  statusOf(eventId: number): string | null {
    return (
      db
        .select({ status: schema.event_advancing.status })
        .from(schema.event_advancing)
        .where(eq(schema.event_advancing.deal_memo_id, eventId))
        .get()?.status ?? null
    )
  }

  /** The people and addresses of a show's mail: promoter contact, promoter, contact on site */
  mailAddresses(eventId: number) {
    const promoterPerson = db
      .select({
        firstName: schema.person.first_name,
        lastName: schema.person.last_name,
        email: schema.contact.email
      })
      .from(schema.deal_memo)
      .innerJoin(schema.person, eq(schema.person.id, schema.deal_memo.lopro_person_id))
      .leftJoin(schema.contact, eq(schema.contact.id, schema.person.contact_id))
      .where(eq(schema.deal_memo.id, eventId))
      .get()
    const promoterCompany = db
      .select({ name: schema.company.name, email: schema.contact.email })
      .from(schema.deal_memo)
      .innerJoin(schema.company, eq(schema.company.id, schema.deal_memo.lopro_company_id))
      .leftJoin(schema.contact, eq(schema.contact.id, schema.company.contact_id))
      .where(eq(schema.deal_memo.id, eventId))
      .get()
    const local = db
      .select({
        firstName: schema.person.first_name,
        lastName: schema.person.last_name,
        email: schema.contact.email
      })
      .from(schema.event_advancing)
      .innerJoin(schema.person, eq(schema.person.id, schema.event_advancing.local_contact_id))
      .leftJoin(schema.contact, eq(schema.contact.id, schema.person.contact_id))
      .where(eq(schema.event_advancing.deal_memo_id, eventId))
      .get()
    return { promoterPerson, promoterCompany, local }
  }

  /** The show and its band, venue and city, for a mail's subject and text */
  showOf(eventId: number) {
    return db
      .select({
        id: schema.deal_memo.id,
        date: schema.deal_memo.date,
        name: schema.deal_memo.name,
        bandName: schema.band.name,
        venueName: schema.venue.name,
        city: schema.address.city,
        performanceTime: schema.deal_memo.performance_time
      })
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.band.id, schema.deal_memo.band_id))
      .leftJoin(schema.venue, eq(schema.venue.id, schema.deal_memo.venue_id))
      .leftJoin(schema.address, eq(schema.address.id, schema.venue.address_id))
      .where(eq(schema.deal_memo.id, eventId))
      .get()
  }

  /**
   * #235: the shows (not archived, not cancelled) between two days whose mails come from these
   * addresses or domains - the promoter's contact, the promoter, the contact on site - or that
   * the mail is linked to
   */
  showsForMail(input: {
    emails: string[]
    domains: string[]
    linkedEventIds: number[]
    from: string
    to: string
  }) {
    const contactEmail = sql<string>`lower(trim(coalesce(${schema.contact.email}, '')))`
    const personIds = (() => {
      if (input.emails.length === 0 && input.domains.length === 0) return []
      const matches = db
        .select({ id: schema.person.id, email: contactEmail })
        .from(schema.person)
        .innerJoin(schema.contact, eq(schema.contact.id, schema.person.contact_id))
        .all()
        .filter(
          (row) =>
            row.email &&
            (input.emails.includes(row.email) || input.domains.includes(row.email.split('@')[1]))
        )
      return matches.map((row) => row.id)
    })()
    const companyIds = (() => {
      if (input.emails.length === 0 && input.domains.length === 0) return []
      return db
        .select({ id: schema.company.id, email: contactEmail })
        .from(schema.company)
        .innerJoin(schema.contact, eq(schema.contact.id, schema.company.contact_id))
        .all()
        .filter(
          (row) =>
            row.email &&
            (input.emails.includes(row.email) || input.domains.includes(row.email.split('@')[1]))
        )
        .map((row) => row.id)
    })()
    const conditions = [
      personIds.length > 0 ? inArray(schema.deal_memo.lopro_person_id, personIds) : undefined,
      companyIds.length > 0 ? inArray(schema.deal_memo.lopro_company_id, companyIds) : undefined,
      personIds.length > 0
        ? inArray(schema.event_advancing.local_contact_id, personIds)
        : undefined,
      input.linkedEventIds.length > 0
        ? inArray(schema.deal_memo.id, input.linkedEventIds)
        : undefined
    ].filter((condition) => condition !== undefined)
    if (conditions.length === 0) return []
    return db
      .select({ id: schema.deal_memo.id, date: schema.deal_memo.date })
      .from(schema.deal_memo)
      .leftJoin(
        schema.event_advancing,
        eq(schema.event_advancing.deal_memo_id, schema.deal_memo.id)
      )
      .where(
        and(
          or(...conditions),
          isNull(schema.deal_memo.archived_at),
          ne(schema.deal_memo.status, 'cancelled'),
          gte(schema.deal_memo.date, input.from),
          lte(schema.deal_memo.date, input.to)
        )
      )
      .orderBy(asc(schema.deal_memo.date))
      .limit(5)
      .all()
  }

  /** Events a mail is linked to (mail_link, not dismissed) */
  linkedEventIds(accountId: string, messageId: string): number[] {
    if (!messageId) return []
    return db
      .select({ id: schema.mail_link.entity_id })
      .from(schema.mail_link)
      .where(
        and(
          eq(schema.mail_link.mail_account_id, accountId),
          eq(schema.mail_link.message_id, messageId),
          eq(schema.mail_link.entity_type, 'event'),
          eq(schema.mail_link.dismissed, false)
        )
      )
      .all()
      .map((row) => row.id)
  }

  /** A person by e-mail, or a new one from the sender's name; returns the id */
  personForEmail(email: string, name: string): number {
    const address = email.trim().toLowerCase()
    const found = db
      .select({ id: schema.person.id })
      .from(schema.person)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.person.contact_id))
      .where(sql`lower(trim(${schema.contact.email})) = ${address}`)
      .get()
    if (found) return found.id
    const words = name.trim().split(/\s+/).filter(Boolean)
    const firstName =
      words.length > 1 ? words.slice(0, -1).join(' ') : (words[0] ?? address.split('@')[0])
    const lastName = words.length > 1 ? words[words.length - 1] : ''
    return db.transaction((tx) => {
      const contact = tx
        .insert(schema.contact)
        .values({ email: address })
        .returning({ id: schema.contact.id })
        .get()
      return tx
        .insert(schema.person)
        .values({ first_name: firstName, last_name: lastName, contact_id: contact.id })
        .returning({ id: schema.person.id })
        .get().id
    })
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
