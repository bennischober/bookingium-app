import { and, eq, like, sql } from 'drizzle-orm'
import { listOrder, listPage } from './listQuery'
import { saveContactEmails, withContactEmails } from './contactEmails'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import { normalizeGenres } from '../api/schemas/venue.schema'
import type {
  CreateVenueInput,
  UpdateVenueInput,
  VenuePaginationInput
} from '../api/schemas/venue.schema'

@injectable()
export class VenueRepository {
  async getAll() {
    const rows = await db
      .select()
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
      .leftJoin(schema.company, eq(schema.venue.company_id, schema.company.id))
      .orderBy(schema.venue.name)

    return withContactEmails(
      rows.map((row) => ({
        ...row.venue,
        address: row.address,
        contact: row.contact,
        company: row.company
      }))
    )
  }

  async getAllPaginated(pagination: VenuePaginationInput) {
    const { search, kind } = pagination
    const { page, pageSize, offset } = listPage(pagination)

    const whereClause = and(
      search ? like(schema.venue.name, `%${search}%`) : undefined,
      kind ? eq(schema.venue.kind, kind) : undefined
    )

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.venue)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    const rows = await db
      .select()
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
      .leftJoin(schema.company, eq(schema.venue.company_id, schema.company.id))
      .where(whereClause)
      .orderBy(
        ...listOrder(
          pagination,
          {
            name: [schema.venue.name],
            kind: [schema.venue.kind, schema.venue.name],
            company: [schema.company.name],
            address: [schema.address.city],
            capacity: [schema.venue.capacity],
            notes: [schema.venue.notes]
          },
          { key: 'name', dir: 'asc' },
          schema.venue.id
        )
      )
      .limit(pageSize)
      .offset(offset)

    const items = withContactEmails(
      rows.map((row) => ({
        ...row.venue,
        address: row.address,
        contact: row.contact,
        company: row.company
      }))
    )

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  /** Venues run by a company (venue.company_id), by name */
  async listByCompany(companyId: number) {
    const rows = await db
      .select()
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
      .leftJoin(schema.company, eq(schema.venue.company_id, schema.company.id))
      .where(eq(schema.venue.company_id, companyId))
      .orderBy(schema.venue.name)

    return withContactEmails(
      rows.map((row) => ({
        ...row.venue,
        address: row.address,
        contact: row.contact,
        company: row.company
      }))
    )
  }

  async getById(id: number) {
    const rows = await db
      .select()
      .from(schema.venue)
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
      .leftJoin(schema.company, eq(schema.venue.company_id, schema.company.id))
      .where(eq(schema.venue.id, id))

    if (!rows[0]) return null
    return withContactEmails([
      {
        ...rows[0].venue,
        address: rows[0].address,
        contact: rows[0].contact,
        company: rows[0].company
      }
    ])[0]
  }

  async create(input: CreateVenueInput) {
    return await db.transaction((tx) => {
      let addressId = input.addressId ?? null
      if (input.address) {
        const addressResult = tx
          .insert(schema.address)
          .values({
            street: input.address.street,
            street_number: input.address.streetNumber,
            address_suffix: input.address.addressSuffix,
            zip_code: input.address.zipCode,
            city: input.address.city,
            state: input.address.state,
            country: input.address.country,
            country_code: input.address.countryCode
          })
          .returning()
          .all()
        addressId = addressResult[0].id
      }

      let contactId = input.contactId ?? null
      if (input.contact) {
        const contactResult = tx
          .insert(schema.contact)
          .values({
            email: input.contact.email,
            phone: input.contact.phone,
            mobile_phone: input.contact.mobilePhone,
            no_advertising: input.contact.noAdvertising,
            homepage: input.contact.homepage
          })
          .returning()
          .all()
        contactId = contactResult[0].id
        saveContactEmails(tx, contactId, input.contact.email, input.contact.otherEmails)
      }

      const venueResult = tx
        .insert(schema.venue)
        .values({
          name: input.name,
          kind: input.kind,
          capacity: input.capacity ?? null,
          genres: normalizeGenres(input.genres ?? ''),
          notes: input.notes,
          address_id: addressId,
          company_id: input.companyId ?? null,
          contact_id: contactId
        })
        .returning()
        .all()

      const rows = tx
        .select()
        .from(schema.venue)
        .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
        .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
        .leftJoin(schema.company, eq(schema.venue.company_id, schema.company.id))
        .where(eq(schema.venue.id, venueResult[0].id))
        .all()

      return withContactEmails(
        [
          {
            ...rows[0].venue,
            address: rows[0].address,
            contact: rows[0].contact,
            company: rows[0].company
          }
        ],
        tx
      )[0]
    })
  }

  async update(input: UpdateVenueInput) {
    return await db.transaction((tx) => {
      const existing = tx.select().from(schema.venue).where(eq(schema.venue.id, input.id)).all()
      if (existing.length === 0) throw new Error('Venue not found')

      const existingVenue = existing[0]
      let addressId = input.addressId !== undefined ? input.addressId : existingVenue.address_id
      let contactId = input.contactId !== undefined ? input.contactId : existingVenue.contact_id

      if (input.address) {
        if (existingVenue.address_id) {
          tx.update(schema.address)
            .set({
              street: input.address.street,
              street_number: input.address.streetNumber,
              address_suffix: input.address.addressSuffix,
              zip_code: input.address.zipCode,
              city: input.address.city,
              state: input.address.state,
              country: input.address.country,
              country_code: input.address.countryCode
            })
            .where(eq(schema.address.id, existingVenue.address_id))
            .run()
          addressId = existingVenue.address_id
        } else {
          const addressResult = tx
            .insert(schema.address)
            .values({
              street: input.address.street,
              street_number: input.address.streetNumber,
              address_suffix: input.address.addressSuffix,
              zip_code: input.address.zipCode,
              city: input.address.city,
              state: input.address.state,
              country: input.address.country,
              country_code: input.address.countryCode
            })
            .returning()
            .all()
          addressId = addressResult[0].id
        }
      }

      if (input.contact) {
        if (existingVenue.contact_id) {
          tx.update(schema.contact)
            .set({
              email: input.contact.email,
              phone: input.contact.phone,
              mobile_phone: input.contact.mobilePhone,
              no_advertising: input.contact.noAdvertising,
              homepage: input.contact.homepage
            })
            .where(eq(schema.contact.id, existingVenue.contact_id))
            .run()
          contactId = existingVenue.contact_id
        } else {
          const contactResult = tx
            .insert(schema.contact)
            .values({
              email: input.contact.email,
              phone: input.contact.phone,
              mobile_phone: input.contact.mobilePhone,
              no_advertising: input.contact.noAdvertising,
              homepage: input.contact.homepage
            })
            .returning()
            .all()
          contactId = contactResult[0].id
        }
        saveContactEmails(tx, contactId, input.contact.email, input.contact.otherEmails)
      }

      tx.update(schema.venue)
        .set({
          name: input.name,
          kind: input.kind,
          capacity: input.capacity ?? null,
          genres: input.genres === undefined ? undefined : normalizeGenres(input.genres),
          notes: input.notes,
          address_id: addressId ?? null,
          company_id: input.companyId !== undefined ? input.companyId : existingVenue.company_id,
          contact_id: contactId ?? null,
          updated_at: sql`datetime('now')`
        })
        .where(eq(schema.venue.id, input.id))
        .run()

      const rows = tx
        .select()
        .from(schema.venue)
        .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
        .leftJoin(schema.contact, eq(schema.venue.contact_id, schema.contact.id))
        .leftJoin(schema.company, eq(schema.venue.company_id, schema.company.id))
        .where(eq(schema.venue.id, input.id))
        .all()

      return withContactEmails(
        [
          {
            ...rows[0].venue,
            address: rows[0].address,
            contact: rows[0].contact,
            company: rows[0].company
          }
        ],
        tx
      )[0]
    })
  }

  async delete(id: number) {
    await db.delete(schema.venue).where(eq(schema.venue.id, id))
  }
}
