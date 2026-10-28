import { injectable } from 'tsyringe'
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from './archiveFilter'

export interface VenueSource {
  id: number
  name: string
  kind: string
  capacity: number | null
  genres: string
  city: string
  state: string
  zipCode: string
  country: string
  countryCode: string
  email: string
  promoter: { name: string; email: string } | null
  members: { firstName: string; lastName: string; role: string; email: string }[]
  // Non-cancelled events at this venue
  bookings: { bandId: number; bandGenre: string }[]
}

@injectable()
export class ContactListRepository {
  /** Every venue with the addresses that can receive mail for it */
  loadVenueSources(): VenueSource[] {
    const venues = db
      .select()
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
      .orderBy(schema.venue.name)
      .all()

    const companies = new Map(
      db
        .select({ id: schema.company.id, name: schema.company.name, email: schema.contact.email })
        .from(schema.company)
        .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
        .all()
        .map((row) => [row.id, { name: row.name, email: row.email ?? '' }])
    )

    const members = new Map<number, VenueSource['members']>()
    for (const row of db
      .select({
        venueId: schema.venue_member.venue_id,
        role: schema.venue_member.role,
        firstName: schema.person.first_name,
        lastName: schema.person.last_name,
        email: schema.contact.email
      })
      .from(schema.venue_member)
      .innerJoin(schema.person, eq(schema.venue_member.person_id, schema.person.id))
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .orderBy(schema.person.last_name, schema.person.first_name)
      .all()) {
      const list = members.get(row.venueId) ?? []
      list.push({
        firstName: row.firstName,
        lastName: row.lastName,
        role: row.role ?? '',
        email: row.email ?? ''
      })
      members.set(row.venueId, list)
    }

    const bookings = new Map<number, VenueSource['bookings']>()
    for (const row of db
      .select({
        venueId: schema.deal_memo.venue_id,
        bandId: schema.deal_memo.band_id,
        bandGenre: schema.band.genre
      })
      .from(schema.deal_memo)
      .innerJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .where(
        and(
          // D3: an archived gig is not a booking to reach out about
          notArchived(),
          isNotNull(schema.deal_memo.venue_id),
          ne(schema.deal_memo.status, 'cancelled')
        )
      )
      .all()) {
      if (row.venueId === null) continue
      const list = bookings.get(row.venueId) ?? []
      list.push({ bandId: row.bandId, bandGenre: row.bandGenre })
      bookings.set(row.venueId, list)
    }

    return venues.map(({ venue, address, contact }) => ({
      id: venue.id,
      name: venue.name,
      kind: venue.kind,
      capacity: venue.capacity,
      genres: venue.genres,
      city: address?.city ?? '',
      state: address?.state ?? '',
      zipCode: address?.zip_code ?? '',
      country: address?.country ?? '',
      countryCode: address?.country_code ?? '',
      email: contact?.email ?? '',
      promoter: venue.company_id !== null ? (companies.get(venue.company_id) ?? null) : null,
      members: members.get(venue.id) ?? [],
      bookings: bookings.get(venue.id) ?? []
    }))
  }

  /** Lower-case emails of every contact marked "Keine Werbung" */
  noAdvertisingEmails(): Set<string> {
    const rows = db
      .select({ email: schema.contact.email })
      .from(schema.contact)
      .where(eq(schema.contact.no_advertising, true))
      .all()
    return new Set(rows.map((row) => row.email.trim().toLowerCase()).filter(Boolean))
  }

  /** Sets the flag on every contact with this email (case-insensitive) */
  setNoAdvertising(email: string, noAdvertising: boolean): number {
    return db
      .update(schema.contact)
      .set({ no_advertising: noAdvertising })
      .where(sql`lower(trim(${schema.contact.email})) = ${email.trim().toLowerCase()}`)
      .run().changes
  }

  listBands(): { id: number; name: string; genre: string }[] {
    return db
      .select({ id: schema.band.id, name: schema.band.name, genre: schema.band.genre })
      .from(schema.band)
      .orderBy(schema.band.name)
      .all()
  }

  listSaved() {
    return db.select().from(schema.contact_list).orderBy(schema.contact_list.name).all()
  }

  insertSaved(name: string, filters: string) {
    return db.insert(schema.contact_list).values({ name, filters }).returning().get()
  }

  updateSaved(id: number, name: string, filters: string) {
    return db
      .update(schema.contact_list)
      .set({ name, filters, updated_at: sql`datetime('now')` })
      .where(eq(schema.contact_list.id, id))
      .returning()
      .get()
  }

  deleteSaved(id: number): void {
    db.delete(schema.contact_list).where(eq(schema.contact_list.id, id)).run()
  }
}
