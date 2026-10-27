import { eq, like, sql } from 'drizzle-orm'
import { listOrder, listPage } from './listQuery'
import { saveContactEmails, withContactEmails } from './contactEmails'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import type { CreateHotelInput, UpdateHotelInput } from '../api/schemas/hotel.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class HotelRepository {
  async getAll() {
    const rows = await db
      .select()
      .from(schema.hotel)
      .leftJoin(schema.address, eq(schema.hotel.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.hotel.contact_id, schema.contact.id))
      .orderBy(schema.hotel.name)

    return withContactEmails(
      rows.map((row) => ({
        ...row.hotel,
        address: row.address,
        contact: row.contact
      }))
    )
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { search } = pagination
    const { page, pageSize, offset } = listPage(pagination)
    const whereClause = search ? like(schema.hotel.name, `%${search}%`) : undefined

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.hotel)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    const rows = await db
      .select()
      .from(schema.hotel)
      .leftJoin(schema.address, eq(schema.hotel.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.hotel.contact_id, schema.contact.id))
      .where(whereClause)
      .orderBy(
        ...listOrder(
          pagination,
          {
            name: [schema.hotel.name],
            address: [schema.address.city],
            contact: [schema.contact.email],
            notes: [schema.hotel.notes]
          },
          { key: 'name', dir: 'asc' },
          schema.hotel.id
        )
      )
      .limit(pageSize)
      .offset(offset)

    return {
      items: withContactEmails(
        rows.map((row) => ({
          ...row.hotel,
          address: row.address,
          contact: row.contact
        }))
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  async getById(id: number) {
    const rows = await db
      .select()
      .from(schema.hotel)
      .leftJoin(schema.address, eq(schema.hotel.address_id, schema.address.id))
      .leftJoin(schema.contact, eq(schema.hotel.contact_id, schema.contact.id))
      .where(eq(schema.hotel.id, id))
      .limit(1)

    if (!rows[0]) return null

    return withContactEmails([
      {
        ...rows[0].hotel,
        address: rows[0].address,
        contact: rows[0].contact
      }
    ])[0]
  }

  async create(input: CreateHotelInput) {
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
        saveContactEmails(tx, contactId, input.contact.email, input.contact.otherEmails)
      }

      const hotelResult = tx
        .insert(schema.hotel)
        .values({
          name: input.name,
          notes: input.notes,
          address_id: addressId,
          contact_id: contactId
        })
        .returning()
        .all()

      const rows = tx
        .select()
        .from(schema.hotel)
        .leftJoin(schema.address, eq(schema.hotel.address_id, schema.address.id))
        .leftJoin(schema.contact, eq(schema.hotel.contact_id, schema.contact.id))
        .where(eq(schema.hotel.id, hotelResult[0].id))
        .all()

      return withContactEmails([
        {
          ...rows[0].hotel,
          address: rows[0].address,
          contact: rows[0].contact
        }
      ])[0]
    })
  }

  async update(input: UpdateHotelInput) {
    return await db.transaction((tx) => {
      const existing = tx.select().from(schema.hotel).where(eq(schema.hotel.id, input.id)).all()
      if (existing.length === 0) throw new Error('Hotel not found')

      const existingHotel = existing[0]
      let addressId = input.addressId !== undefined ? input.addressId : existingHotel.address_id
      let contactId = input.contactId !== undefined ? input.contactId : existingHotel.contact_id

      if (input.address) {
        if (existingHotel.address_id) {
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
            .where(eq(schema.address.id, existingHotel.address_id))
            .run()
          addressId = existingHotel.address_id
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
        if (existingHotel.contact_id) {
          tx.update(schema.contact)
            .set({
              email: input.contact.email,
              phone: input.contact.phone,
              mobile_phone: input.contact.mobilePhone,
              homepage: input.contact.homepage
            })
            .where(eq(schema.contact.id, existingHotel.contact_id))
            .run()
          contactId = existingHotel.contact_id
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
        saveContactEmails(tx, contactId, input.contact.email, input.contact.otherEmails)
      }

      tx.update(schema.hotel)
        .set({
          name: input.name,
          notes: input.notes,
          address_id: addressId ?? null,
          contact_id: contactId ?? null,
          updated_at: sql`datetime('now')`
        })
        .where(eq(schema.hotel.id, input.id))
        .run()

      const rows = tx
        .select()
        .from(schema.hotel)
        .leftJoin(schema.address, eq(schema.hotel.address_id, schema.address.id))
        .leftJoin(schema.contact, eq(schema.hotel.contact_id, schema.contact.id))
        .where(eq(schema.hotel.id, input.id))
        .all()

      return withContactEmails([
        {
          ...rows[0].hotel,
          address: rows[0].address,
          contact: rows[0].contact
        }
      ])[0]
    })
  }

  async delete(id: number) {
    await db.delete(schema.hotel).where(eq(schema.hotel.id, id))
  }
}
