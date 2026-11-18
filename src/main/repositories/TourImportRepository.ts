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
        notes: schema.deal_memo.notes
      })
      .from(schema.deal_memo)
      .where(notArchived())
      .all()
    return { bands, venues, events }
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
  applyImport(plan: TourImportPlan): { created: number; updated: number; venuesCreated: number } {
    return db.transaction((tx) => {
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
            band_id: draft.band_id,
            date: draft.date,
            venue_id: venueId(draft.venue)
          })
          .run()
      }
      for (const change of plan.update) {
        const values: Record<string, unknown> = { ...change.fields }
        if (change.venue) values.venue_id = venueId(change.venue)
        tx.update(schema.deal_memo)
          .set({ ...values, updated_at: sql`(datetime('now'))` })
          .where(and(eq(schema.deal_memo.id, change.id), notArchived()))
          .run()
      }
      return {
        created: plan.create.length,
        updated: plan.update.length,
        venuesCreated: plan.venues.length
      }
    })
  }
}
