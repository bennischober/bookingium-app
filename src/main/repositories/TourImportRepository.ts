import { injectable } from 'tsyringe'
import { and, asc, eq, ne, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from './archiveFilter'
import type { TourImportExisting, TourImportPlan } from '../import/tourDates'

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
    return { bands, venues, events, companies, persons }
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
  applyImport(plan: TourImportPlan): {
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

      for (const draft of plan.create) {
        tx.insert(schema.deal_memo)
          .values({
            ...draft.fields,
            ...loproValues(draft.lopro),
            band_id: draft.band_id,
            date: draft.date,
            venue_id: venueId(draft.venue)
          })
          .run()
      }
      for (const change of plan.update) {
        const values: Record<string, unknown> = { ...change.fields, ...loproValues(change.lopro) }
        if (change.venue) values.venue_id = venueId(change.venue)
        tx.update(schema.deal_memo)
          .set({ ...values, updated_at: sql`(datetime('now'))` })
          .where(and(eq(schema.deal_memo.id, change.id), notArchived()))
          .run()
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
