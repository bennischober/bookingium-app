import { injectable } from 'tsyringe'
import { container } from 'tsyringe'
import { and, desc, eq, like, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { DocumentRepository } from '../repositories/DocumentRepository'
import { notArchived } from '../repositories/archiveFilter'
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
  type DocumentOwnerType
} from '../api/schemas/document.schema'
import type { SearchResultItem } from '../api/routers/search.router'

const TOTAL_LIMIT = 24

/**
 * D2: LIKE metacharacters in a file name are literal text, not wildcards. `_` is common in
 * file names ("rider_final.pdf") and would otherwise match any single character. The other
 * queries in this service predate this and do not escape; documents get it because a file
 * name is far more likely to contain one.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

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
    const documentPattern = `%${escapeLike(query)}%`

    const [events, bands, companies, persons, venues, hotels, invoices, docs] = await Promise.all([
      db
        .select({
          id: schema.deal_memo.id,
          name: schema.deal_memo.name,
          date: schema.deal_memo.date,
          status: schema.deal_memo.status
        })
        .from(schema.deal_memo)
        .where(
          and(
            // D3: an archived gig is out of the working view
            notArchived(),
            or(
              like(schema.deal_memo.name, pattern),
              like(schema.deal_memo.deal, pattern),
              sql`CAST(${schema.deal_memo.id} AS TEXT) LIKE ${pattern}`
            )
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
        .limit(perTypeLimit),
      // D2: documents were the one business object the palette could not find at all, so a
      // file could only be reached by remembering which record it hangs off.
      db
        .select({
          id: schema.document.id,
          fileName: schema.document.file_name,
          documentType: schema.document.document_type,
          ownerType: schema.document.owner_type,
          ownerId: schema.document.owner_id,
          filePath: schema.document.file_path
        })
        .from(schema.document)
        .where(sql`${schema.document.file_name} LIKE ${documentPattern} ESCAPE '\\'`)
        .orderBy(desc(schema.document.uploaded_at))
        .limit(perTypeLimit)
    ])

    // The owner label is one lookup per document (at most perTypeLimit); the repository owns
    // how a record names itself ("2026-06-11 The New Roses München" for an event)
    const documentRepository = container.resolve(DocumentRepository)
    const documentOwners = await Promise.all(
      docs.map((doc) =>
        documentRepository.ownerLabel(doc.ownerType as DocumentOwnerType, doc.ownerId)
      )
    )

    const results: SearchResultItem[] = [
      ...events.map((event) => ({
        type: 'event' as const,
        id: event.id,
        label: event.name,
        sublabel: `${event.date}${event.status ? ` · ${event.status}` : ''}`,
        route: '/events/$eventId',
        routeParams: { eventId: String(event.id) },
        filePath: null
      })),
      ...bands.map((band) => ({
        type: 'band' as const,
        id: band.id,
        label: band.name,
        sublabel: band.genre || null,
        route: '/band/$bandId',
        routeParams: { bandId: String(band.id) },
        filePath: null
      })),
      ...companies.map((company) => ({
        type: 'company' as const,
        id: company.id,
        label: company.name,
        sublabel: company.city || null,
        route: '/companies/$companyId',
        routeParams: { companyId: String(company.id) },
        filePath: null
      })),
      ...persons.map((person) => ({
        type: 'person' as const,
        id: person.id,
        label: `${person.firstName} ${person.lastName}`,
        sublabel: null,
        route: '/persons/$personId',
        routeParams: { personId: String(person.id) },
        filePath: null
      })),
      ...venues.map((venue) => ({
        type: 'venue' as const,
        id: venue.id,
        label: venue.name,
        sublabel: venue.city || null,
        route: '/venues/$venueId',
        routeParams: { venueId: String(venue.id) },
        filePath: null
      })),
      ...hotels.map((hotel) => ({
        type: 'hotel' as const,
        id: hotel.id,
        label: hotel.name,
        sublabel: hotel.city || null,
        route: '/hotels',
        routeParams: null,
        filePath: null
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
        routeParams: null,
        filePath: null
      })),
      // D2: a found file is opened directly - navigating to its record would only make the
      // user look for it a second time. The sublabel names the record it belongs to.
      ...docs.map((doc, index) => {
        const category = DOCUMENT_TYPE_LABELS[doc.documentType as DocumentType] ?? doc.documentType
        const owner = documentOwners[index]
        return {
          type: 'document' as const,
          id: doc.id,
          label: doc.fileName,
          sublabel: owner ? `${category} · ${owner}` : category,
          route: '',
          routeParams: null,
          filePath: doc.filePath
        }
      })
    ]

    return { results: results.slice(0, TOTAL_LIMIT), truncated: results.length >= TOTAL_LIMIT }
  }
}
