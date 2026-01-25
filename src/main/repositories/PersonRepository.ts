import { eq, like, or, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import type { CreatePersonInput, UpdatePersonInput } from '../api/schemas/person.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class PersonRepository {
  async getAll() {
    const rows = await db
      .select()
      .from(schema.person)
      .leftJoin(schema.address, eq(schema.person.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .orderBy(schema.person.last_name, schema.person.first_name)

    return rows.map((row) => ({
      ...row.person,
      address: row.address,
      contact: row.contact
    }))
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { page, pageSize, search } = pagination
    const offset = (page - 1) * pageSize

    // Build where clause for search
    const whereClause = search
      ? or(
          like(schema.person.first_name, `%${search}%`),
          like(schema.person.last_name, `%${search}%`),
          like(schema.person.role, `%${search}%`)
        )
      : undefined

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.person)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    // Get paginated data with joins
    const rawItems = await db
      .select()
      .from(schema.person)
      .leftJoin(schema.address, eq(schema.person.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .where(whereClause)
      .limit(pageSize)
      .offset(offset)

    const items = rawItems.map((row) => ({
      ...row.person,
      address: row.address,
      contact: row.contact
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
      .from(schema.person)
      .leftJoin(schema.address, eq(schema.person.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
      .where(eq(schema.person.id, id))

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      ...row.person,
      address: row.address,
      contact: row.contact
    }
  }

  async create(input: CreatePersonInput) {
    return await db.transaction(async (tx) => {
      // Create address if provided
      let addressId: number | null = null
      if (input.address) {
        const addressResult = await tx
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
        addressId = addressResult[0].id
      }

      // Create contact if provided
      let contactId: number | null = null
      if (input.contact) {
        const contactResult = await tx
          .insert(schema.contact)
          .values({
            email: input.contact.email,
            phone: input.contact.phone,
            mobile_phone: input.contact.mobilePhone,
            homepage: input.contact.homepage
          })
          .returning()
        contactId = contactResult[0].id
      }

      // Create person
      const personResult = await tx
        .insert(schema.person)
        .values({
          first_name: input.firstName,
          last_name: input.lastName,
          birthday: input.birthday,
          role: input.role,
          notes: input.notes,
          address_id: addressId,
          contact_id: contactId
        })
        .returning()

      // Fetch with relations
      const created = await tx
        .select()
        .from(schema.person)
        .leftJoin(schema.address, eq(schema.person.address_id, schema.address.id))
        .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
        .where(eq(schema.person.id, personResult[0].id))

      const row = created[0]
      return {
        ...row.person,
        address: row.address,
        contact: row.contact
      }
    })
  }

  async update(input: UpdatePersonInput) {
    return await db.transaction(async (tx) => {
      // Get existing person to check for existing address/contact
      const existing = await tx.select().from(schema.person).where(eq(schema.person.id, input.id))
      if (existing.length === 0) throw new Error('Person not found')

      const existingPerson = existing[0]

      // Update or create address
      let addressId = existingPerson.address_id
      if (input.address) {
        if (addressId) {
          // Update existing address
          await tx
            .update(schema.address)
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
            .where(eq(schema.address.id, addressId))
        } else {
          // Create new address
          const addressResult = await tx
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
          addressId = addressResult[0].id
        }
      }

      // Update or create contact
      let contactId = existingPerson.contact_id
      if (input.contact) {
        if (contactId) {
          // Update existing contact
          await tx
            .update(schema.contact)
            .set({
              email: input.contact.email,
              phone: input.contact.phone,
              mobile_phone: input.contact.mobilePhone,
              homepage: input.contact.homepage
            })
            .where(eq(schema.contact.id, contactId))
        } else {
          // Create new contact
          const contactResult = await tx
            .insert(schema.contact)
            .values({
              email: input.contact.email,
              phone: input.contact.phone,
              mobile_phone: input.contact.mobilePhone,
              homepage: input.contact.homepage
            })
            .returning()
          contactId = contactResult[0].id
        }
      }

      // Update person
      await tx
        .update(schema.person)
        .set({
          first_name: input.firstName,
          last_name: input.lastName,
          birthday: input.birthday,
          role: input.role,
          notes: input.notes,
          address_id: addressId,
          contact_id: contactId,
          updated_at: sql`datetime('now')`
        })
        .where(eq(schema.person.id, input.id))

      // Fetch with relations
      const updated = await tx
        .select()
        .from(schema.person)
        .leftJoin(schema.address, eq(schema.person.address_id, schema.address.id))
        .leftJoin(schema.contact, eq(schema.person.contact_id, schema.contact.id))
        .where(eq(schema.person.id, input.id))

      const row = updated[0]
      return {
        ...row.person,
        address: row.address,
        contact: row.contact
      }
    })
  }

  async delete(id: number) {
    await db.delete(schema.person).where(eq(schema.person.id, id))
  }
}
