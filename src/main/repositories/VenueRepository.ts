import { and, eq, like, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
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

    return rows.map((row) => ({
      ...row.venue,
      address: row.address,
      contact: row.contact,
      company: row.company
    }))
  }

  async getAllPaginated(pagination: VenuePaginationInput) {
    const { page, pageSize, search, kind } = pagination
    const offset = (page - 1) * pageSize

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
      .limit(pageSize)
      .offset(offset)
      .orderBy(schema.venue.name)

    const items = rows.map((row) => ({
      ...row.venue,
      address: row.address,
      contact: row.contact,
      company: row.company
    }))

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
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
    return {
      ...rows[0].venue,
      address: rows[0].address,
      contact: rows[0].contact,
      company: rows[0].company
    }
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
            homepage: input.contact.homepage
          })
          .returning()
          .all()
        contactId = contactResult[0].id
      }

      const venueResult = tx
        .insert(schema.venue)
        .values({
          name: input.name,
          kind: input.kind,
          capacity: input.capacity ?? null,
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

      return {
        ...rows[0].venue,
        address: rows[0].address,
        contact: rows[0].contact,
        company: rows[0].company
      }
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
              homepage: input.contact.homepage
            })
            .returning()
            .all()
          contactId = contactResult[0].id
        }
      }

      tx.update(schema.venue)
        .set({
          name: input.name,
          kind: input.kind,
          capacity: input.capacity ?? null,
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

      return {
        ...rows[0].venue,
        address: rows[0].address,
        contact: rows[0].contact,
        company: rows[0].company
      }
    })
  }

  async delete(id: number) {
    await db.delete(schema.venue).where(eq(schema.venue.id, id))
  }
}
