import { injectable } from 'tsyringe'
import { desc, eq, like, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { SearchResultItem } from '../api/routers/search.router'

const TOTAL_LIMIT = 24

@injectable()
export class SearchService {
  /**
   * Dedicated search across business objects. Uses LIKE queries on indexed
   * name columns only (fast, no full-table scans on unindexed fields) and
   * returns lightweight payload models instead of full entities.
   */
  async search(
    rawQuery: string,
    perTypeLimit = 4
  ): Promise<{
    results: SearchResultItem[]
    truncated: boolean
  }> {
    const query = rawQuery.trim()
    if (!query) return { results: [], truncated: false }
    const pattern = `%${query}%`

    const [events, bands, companies, persons, venues, hotels, invoices] = await Promise.all([
      db
        .select({
          id: schema.deal_memo.id,
          name: schema.deal_memo.name,
          date: schema.deal_memo.date,
          status: schema.deal_memo.status
        })
        .from(schema.deal_memo)
        .where(
          or(
            like(schema.deal_memo.name, pattern),
            like(schema.deal_memo.deal, pattern),
            sql`CAST(${schema.deal_memo.id} AS TEXT) LIKE ${pattern}`
          )
        )
        .orderBy(desc(schema.deal_memo.date))
        .limit(perTypeLimit),
      db
        .select({ id: schema.band.id, name: schema.band.name, genre: schema.band.genre })
        .from(schema.band)
        .where(like(schema.band.name, pattern))
        .limit(perTypeLimit),
      db
        .select({ id: schema.company.id, name: schema.company.name, city: schema.address.city })
        .from(schema.company)
        .leftJoin(schema.address, eq(schema.company.address_id, schema.address.id))
        .where(like(schema.company.name, pattern))
        .limit(perTypeLimit),
      db
        .select({
          id: schema.person.id,
          firstName: schema.person.first_name,
          lastName: schema.person.last_name
        })
        .from(schema.person)
        .where(or(like(schema.person.first_name, pattern), like(schema.person.last_name, pattern)))
        .limit(perTypeLimit),
      db
        .select({ id: schema.venue.id, name: schema.venue.name, city: schema.address.city })
        .from(schema.venue)
        .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
        .where(like(schema.venue.name, pattern))
        .limit(perTypeLimit),
      db
        .select({ id: schema.hotel.id, name: schema.hotel.name, city: schema.address.city })
        .from(schema.hotel)
        .leftJoin(schema.address, eq(schema.hotel.address_id, schema.address.id))
        .where(like(schema.hotel.name, pattern))
        .limit(perTypeLimit),
      db
        .select({
          id: schema.invoice.id,
          invoiceNumber: schema.invoice.invoice_number,
          status: schema.invoice.status,
          companyName: schema.company.name
        })
        .from(schema.invoice)
        .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
        .where(
          or(
            like(schema.invoice.status, pattern),
            sql`CAST(${schema.invoice.invoice_number} AS TEXT) LIKE ${pattern}`
          )
        )
        .orderBy(desc(schema.invoice.created_at))
        .limit(perTypeLimit)
    ])

    const results: SearchResultItem[] = [
      ...events.map((event) => ({
        type: 'event' as const,
        id: event.id,
        label: event.name,
        sublabel: `${event.date}${event.status ? ` · ${event.status}` : ''}`,
        route: '/events/$eventId',
        routeParams: { eventId: String(event.id) }
      })),
      ...bands.map((band) => ({
        type: 'band' as const,
        id: band.id,
        label: band.name,
        sublabel: band.genre || null,
        route: '/band/$bandId',
        routeParams: { bandId: String(band.id) }
      })),
      ...companies.map((company) => ({
        type: 'company' as const,
        id: company.id,
        label: company.name,
        sublabel: company.city || null,
        route: '/companies/$companyId',
        routeParams: { companyId: String(company.id) }
      })),
      ...persons.map((person) => ({
        type: 'person' as const,
        id: person.id,
        label: `${person.firstName} ${person.lastName}`,
        sublabel: null,
        route: '/persons/$personId',
        routeParams: { personId: String(person.id) }
      })),
      ...venues.map((venue) => ({
        type: 'venue' as const,
        id: venue.id,
        label: venue.name,
        sublabel: venue.city || null,
        route: '/venues/$venueId',
        routeParams: { venueId: String(venue.id) }
      })),
      ...hotels.map((hotel) => ({
        type: 'hotel' as const,
        id: hotel.id,
        label: hotel.name,
        sublabel: hotel.city || null,
        route: '/hotels',
        routeParams: null
      })),
      ...invoices.map((invoice) => ({
        type: 'invoice' as const,
        id: invoice.id,
        label:
          invoice.invoiceNumber === null
            ? 'Rechnungsentwurf'
            : `Rechnung #${invoice.invoiceNumber}`,
        sublabel: `${invoice.companyName ?? ''} · ${invoice.status}`.trim(),
        route: '/invoices',
        routeParams: null
      }))
    ]

    return { results: results.slice(0, TOTAL_LIMIT), truncated: results.length >= TOTAL_LIMIT }
  }
}
