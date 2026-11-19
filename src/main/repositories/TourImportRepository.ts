import { injectable } from 'tsyringe'
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from './archiveFilter'
import type {
  TourImportExisting,
  TourImportPlan,
  TourShowExtras,
  TourShowState
} from '../import/tourDates'
import { AdvancingStatus } from '../api/schemas/advancing.schema'

/** Tour import (Tourdaten): what a tour sheet is compared with, and writing its plan */
@injectable()
export class TourImportRepository {
  /** Bands by name, venues with their city, and the events that are not archived */
  loadForImport(): TourImportExisting {
    const bands = db.select({ id: schema.band.id, name: schema.band.name }).from(schema.band).all()
    const venues = db
      .select({
        id: schema.venue.id,
        name: schema.venue.name,
        kind: schema.venue.kind,
        city: schema.address.city
      })
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .all()
      .map((venue) => ({ ...venue, city: venue.city ?? '' }))
    const events = db
      .select({
        id: schema.deal_memo.id,
        band_id: schema.deal_memo.band_id,
        date: schema.deal_memo.date,
        name: schema.deal_memo.name,
        venue_id: schema.deal_memo.venue_id,
        status: schema.deal_memo.status,
        tour: schema.deal_memo.tour,
        deal: schema.deal_memo.deal,
        guarantee_cents: schema.deal_memo.guarantee_cents,
        ticket_price_vvk_cents: schema.deal_memo.ticket_price_vvk_cents,
        ticket_price_ak_cents: schema.deal_memo.ticket_price_ak_cents,
        performance_time: schema.deal_memo.performance_time,
        radius_km: schema.deal_memo.radius_km,
        radius_weeks_before: schema.deal_memo.radius_weeks_before,
        radius_weeks_after: schema.deal_memo.radius_weeks_after,
        notes: schema.deal_memo.notes,
        lopro_company_id: schema.deal_memo.lopro_company_id,
        lopro_person_id: schema.deal_memo.lopro_person_id
      })
      .from(schema.deal_memo)
      .where(notArchived())
      .all()
    const companies = db
      .select({ id: schema.company.id, name: schema.company.name })
      .from(schema.company)
      .all()
    const persons = db
      .select({
        id: schema.person.id,
        firstName: schema.person.first_name,
        lastName: schema.person.last_name,
        email: schema.contact.email
      })
      .from(schema.person)
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .all()
      .map((person) => ({ ...person, email: (person.email ?? '').trim().toLowerCase() }))
    return { bands, venues, events, companies, persons, shows: this.loadShows() }
  }

  /** #232: advancing, quota and the newest sales report of every event that has any */
  private loadShows(): TourShowState[] {
    const shows = new Map<number, TourShowState>()
    const show = (eventId: number): TourShowState => {
      let state = shows.get(eventId)
      if (!state) {
        state = {
          eventId,
          status: null,
          statusDate: null,
          localContactId: null,
          quota: null,
          quotaNote: '',
          lastSold: null
        }
        shows.set(eventId, state)
      }
      return state
    }
    for (const row of db.select().from(schema.event_advancing).all()) {
      const parsed = AdvancingStatus.safeParse(row.status)
      Object.assign(show(row.deal_memo_id), {
        status: parsed.success ? parsed.data : 'open',
        statusDate: row.status_date,
        localContactId: row.local_contact_id
      })
    }
    for (const row of db.select().from(schema.event_ticket_quota).all()) {
      Object.assign(show(row.deal_memo_id), { quota: row.quota, quotaNote: row.quota_note })
    }
    const reports = db
      .select()
      .from(schema.ticket_report)
      .orderBy(desc(schema.ticket_report.report_date))
      .all()
    for (const row of reports) {
      const state = show(row.deal_memo_id)
      if (state.lastSold === null) state.lastSold = row.sold
    }
    return [...shows.values()]
  }

  /** The tours events name (not archived), alphabetically */
  tours(): string[] {
    return db
      .selectDistinct({ tour: schema.deal_memo.tour })
      .from(schema.deal_memo)
      .where(and(notArchived(), ne(schema.deal_memo.tour, '')))
      .orderBy(asc(schema.deal_memo.tour))
      .all()
      .map((row) => row.tour)
  }

  /** Writes the plan in one transaction (synchronous: better-sqlite3) */
  applyImport(
    plan: TourImportPlan,
    today = new Date().toISOString().slice(0, 10)
  ): {
    created: number
    updated: number
    venuesCreated: number
    promotersCreated: number
    contactsCreated: number
  } {
    return db.transaction((tx) => {
      // ---- promoters (companies) and their contacts (persons, role "Kontakt") ----
      const companyIds = new Map<string, number>()
      for (const draft of plan.promoters) {
        const contact = draft.email
          ? tx
              .insert(schema.contact)
              .values({ email: draft.email })
              .returning({ id: schema.contact.id })
              .get().id
          : null
        const company = tx
          .insert(schema.company)
          .values({ name: draft.name, contact_id: contact })
          .returning({ id: schema.company.id })
          .get()
        companyIds.set(draft.key, company.id)
      }
      const companyId = (ref: { id: number } | { key: string } | null): number | null =>
        ref === null ? null : 'id' in ref ? ref.id : (companyIds.get(ref.key) ?? null)
      const personIds = new Map<string, number>()
      for (const draft of plan.contacts) {
        const contact = draft.email
          ? tx
              .insert(schema.contact)
              .values({ email: draft.email })
              .returning({ id: schema.contact.id })
              .get().id
          : null
        const person = tx
          .insert(schema.person)
          .values({ first_name: draft.firstName, last_name: draft.lastName, contact_id: contact })
          .returning({ id: schema.person.id })
          .get()
        personIds.set(draft.key, person.id)
        const company = companyId(draft.company)
        if (company !== null) {
          tx.insert(schema.company_member)
            .values({ company_id: company, person_id: person.id, role: 'Kontakt' })
            .onConflictDoNothing()
            .run()
        }
      }
      const personId = (ref: { id: number } | { key: string } | null): number | null =>
        ref === null ? null : 'id' in ref ? ref.id : (personIds.get(ref.key) ?? null)
      /** The LoPro columns of an event; a link the row does not name stays as it is */
      const loproValues = (lopro: TourImportPlan['create'][number]['lopro']) => {
        const values: { lopro_company_id?: number | null; lopro_person_id?: number | null } = {}
        if (lopro?.company) values.lopro_company_id = companyId(lopro.company)
        if (lopro?.person) values.lopro_person_id = personId(lopro.person)
        return values
      }

      const venueIds = new Map<string, number>()
      for (const draft of plan.venues) {
        const address = tx
          .insert(schema.address)
          .values({
            street: draft.street,
            zip_code: draft.zip_code,
            city: draft.city,
            country: draft.country,
            country_code: draft.country_code
          })
          .returning({ id: schema.address.id })
          .get()
        const venue = tx
          .insert(schema.venue)
          .values({ name: draft.name, kind: draft.kind, address_id: address.id })
          .returning({ id: schema.venue.id })
          .get()
        venueIds.set(draft.key, venue.id)
      }
      const venueId = (venue: TourImportPlan['create'][number]['venue']): number | null => {
        if (!venue) return null
        if ('id' in venue) return venue.id
        return venueIds.get(venue.key) ?? null
      }

      /** #232: advancing and tickets of an event, as far as the row names them */
      const writeExtras = (eventId: number, extras: TourShowExtras | undefined): void => {
        if (!extras) return
        const contactId = extras.localContact ? personId(extras.localContact) : undefined
        if (extras.advancing || contactId !== undefined || extras.advancingNote) {
          const stored = tx
            .select()
            .from(schema.event_advancing)
            .where(eq(schema.event_advancing.deal_memo_id, eventId))
            .get()
          if (!stored) {
            tx.insert(schema.event_advancing)
              .values({
                deal_memo_id: eventId,
                status: extras.advancing?.status ?? 'open',
                status_date: extras.advancing?.statusDate ?? null,
                local_contact_id: contactId ?? null,
                notes: extras.advancingNote ?? ''
              })
              .run()
          } else {
            tx.update(schema.event_advancing)
              .set({
                ...(extras.advancing
                  ? {
                      status: extras.advancing.status,
                      status_date: extras.advancing.statusDate ?? stored.status_date
                    }
                  : {}),
                ...(contactId !== undefined ? { local_contact_id: contactId } : {}),
                updated_at: sql`(datetime('now'))`
              })
              .where(eq(schema.event_advancing.id, stored.id))
              .run()
          }
        }
        if (extras.quota) {
          tx.insert(schema.event_ticket_quota)
            .values({
              deal_memo_id: eventId,
              quota: extras.quota.quota,
              quota_note: extras.quota.note
            })
            .onConflictDoUpdate({
              target: schema.event_ticket_quota.deal_memo_id,
              set: {
                quota: extras.quota.quota,
                quota_note: extras.quota.note,
                updated_at: sql`(datetime('now'))`
              }
            })
            .run()
        }
        if (extras.sold !== undefined) {
          tx.insert(schema.ticket_report)
            .values({ deal_memo_id: eventId, report_date: today, sold: extras.sold })
            .onConflictDoUpdate({
              target: [schema.ticket_report.deal_memo_id, schema.ticket_report.report_date],
              set: { sold: extras.sold }
            })
            .run()
        }
      }

      for (const draft of plan.create) {
        const created = tx
          .insert(schema.deal_memo)
          .values({
            ...draft.fields,
            ...loproValues(draft.lopro),
            band_id: draft.band_id,
            date: draft.date,
            venue_id: venueId(draft.venue)
          })
          .returning({ id: schema.deal_memo.id })
          .get()
        writeExtras(created.id, draft.extras)
      }
      for (const change of plan.update) {
        const values: Record<string, unknown> = { ...change.fields, ...loproValues(change.lopro) }
        if (change.venue) values.venue_id = venueId(change.venue)
        tx.update(schema.deal_memo)
          .set({ ...values, updated_at: sql`(datetime('now'))` })
          .where(and(eq(schema.deal_memo.id, change.id), notArchived()))
          .run()
        writeExtras(change.id, change.extras)
      }
      return {
        created: plan.create.length,
        updated: plan.update.length,
        venuesCreated: plan.venues.length,
        promotersCreated: plan.promoters.length,
        contactsCreated: plan.contacts.length
      }
    })
  }
}
