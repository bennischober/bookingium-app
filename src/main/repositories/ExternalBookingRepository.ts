import { injectable } from 'tsyringe'
import { and, asc, between, eq, like, ne, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { PaginationInput } from '../api/schemas/base.schema'
import type { AgencyImportPlan, StoredAgencyBooking } from '../import/agencyBookings'
import { listOrder, listPage } from './listQuery'

const booking = schema.external_booking

/** A booking row with its band's name */
const withBand = {
  id: booking.id,
  band_id: booking.band_id,
  band_name: schema.band.name,
  date: booking.date,
  kind: booking.kind,
  status: booking.status,
  venue_name: booking.venue_name,
  street: booking.street,
  zip_code: booking.zip_code,
  city: booking.city,
  country: booking.country,
  notes: booking.notes,
  agency: booking.agency,
  source_key: booking.source_key,
  source_file: booking.source_file,
  imported_at: booking.imported_at,
  radius_km: booking.radius_km,
  radius_weeks_before: booking.radius_weeks_before,
  radius_weeks_after: booking.radius_weeks_after
}

/** A booking with its band's name, as every list query returns it */
export type ExternalBookingRow = ReturnType<ExternalBookingRepository['listActive']>[number]

const BY_DATE = [asc(booking.date), asc(schema.band.name), asc(booking.id)]

// Read-only by design: there is no update of single fields. Rows are written
// only by applyImport and removed by delete / deleteAgency.
@injectable()
export class ExternalBookingRepository {
  getAllPaginated(pagination: PaginationInput & { agency?: string }) {
    const { search, agency } = pagination
    const { page, pageSize, offset } = listPage(pagination)
    const conditions: SQL[] = []
    if (search) {
      const pattern = `%${search}%`
      conditions.push(
        or(
          like(schema.band.name, pattern),
          like(booking.venue_name, pattern),
          like(booking.city, pattern),
          like(booking.agency, pattern),
          like(booking.date, pattern)
        )!
      )
    }
    if (agency) conditions.push(eq(booking.agency, agency))
    const where = conditions.length > 0 ? and(...conditions) : undefined

    const total =
      db
        .select({ count: sql<number>`count(*)` })
        .from(booking)
        .innerJoin(schema.band, eq(booking.band_id, schema.band.id))
        .where(where)
        .get()?.count ?? 0

    const items = db
      .select(withBand)
      .from(booking)
      .innerJoin(schema.band, eq(booking.band_id, schema.band.id))
      .where(where)
      .orderBy(
        ...listOrder(
          pagination,
          {
            date: [booking.date],
            bandName: [schema.band.name],
            venueName: [booking.venue_name],
            city: [booking.city],
            agency: [booking.agency],
            status: [booking.status]
          },
          { key: 'date', dir: 'asc' },
          booking.id
        )
      )
      .limit(pageSize)
      .offset(offset)
      .all()

    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
  }

  /** Every booking on a day from `from` to `to` (inclusive), cancelled ones too: the calendar marks them */
  listBetween(from: string, to: string) {
    return db
      .select(withBand)
      .from(booking)
      .innerJoin(schema.band, eq(booking.band_id, schema.band.id))
      .where(between(booking.date, from, to))
      .orderBy(...BY_DATE)
      .all()
  }

  /** One band's bookings that still take place, in a date range */
  listForBand(bandId: number, from: string, to: string) {
    return db
      .select(withBand)
      .from(booking)
      .innerJoin(schema.band, eq(booking.band_id, schema.band.id))
      .where(
        and(
          eq(booking.band_id, bandId),
          between(booking.date, from, to),
          ne(booking.status, 'cancelled')
        )
      )
      .orderBy(...BY_DATE)
      .all()
  }

  /** Bookings that take place (not cancelled), for the map and the radius clauses */
  listActive() {
    return db
      .select(withBand)
      .from(booking)
      .innerJoin(schema.band, eq(booking.band_id, schema.band.id))
      .where(ne(booking.status, 'cancelled'))
      .orderBy(...BY_DATE)
      .all()
  }

  /** The agencies with bookings in the app, by name */
  agencies(): Array<{ agency: string; count: number }> {
    return db
      .select({ agency: booking.agency, count: sql<number>`count(*)` })
      .from(booking)
      .groupBy(booking.agency)
      .orderBy(sql`${booking.agency} COLLATE NOCASE`)
      .all()
  }

  /** What the import compares against: all bands, and this agency's bookings */
  loadForImport(agency: string): {
    bands: Array<{ id: number; name: string }>
    bookings: StoredAgencyBooking[]
  } {
    const bands = db.select({ id: schema.band.id, name: schema.band.name }).from(schema.band).all()
    const bookings = db
      .select(withBand)
      .from(booking)
      .innerJoin(schema.band, eq(booking.band_id, schema.band.id))
      .where(eq(booking.agency, agency))
      .all()
    return { bands, bookings }
  }

  /** Writes an import plan in one transaction (synchronous: better-sqlite3) */
  applyImport(
    plan: AgencyImportPlan,
    source: { agency: string; fileName: string; importedAt: string }
  ): { created: number; updated: number; unchanged: number; removed: number } {
    const stamp = {
      agency: source.agency,
      source_file: source.fileName,
      imported_at: source.importedAt
    }
    return db.transaction((tx) => {
      for (const fields of plan.create) {
        tx.insert(booking)
          .values({ ...fields, ...stamp })
          .run()
      }
      for (const { id, fields } of plan.update) {
        tx.update(booking)
          .set({ ...fields, ...stamp, updated_at: sql`(datetime('now'))` })
          .where(and(eq(booking.id, id), eq(booking.agency, source.agency)))
          .run()
      }
      for (const id of plan.unchanged) {
        tx.update(booking)
          .set({ source_file: stamp.source_file, imported_at: stamp.imported_at })
          .where(and(eq(booking.id, id), eq(booking.agency, source.agency)))
          .run()
      }
      let removed = 0
      for (const id of plan.remove) {
        removed += tx
          .delete(booking)
          .where(and(eq(booking.id, id), eq(booking.agency, source.agency)))
          .run().changes
      }
      return {
        created: plan.create.length,
        updated: plan.update.length,
        unchanged: plan.unchanged.length,
        removed
      }
    })
  }

  delete(id: number): boolean {
    return db.delete(booking).where(eq(booking.id, id)).run().changes > 0
  }

  /** Removes all of an agency's bookings; returns how many */
  deleteAgency(agency: string): number {
    return db.delete(booking).where(eq(booking.agency, agency)).run().changes
  }
}
