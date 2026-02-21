import { eq, like, sql } from 'drizzle-orm'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import type { CreateVenueInput, UpdateVenueInput } from '../api/schemas/venue.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class VenueRepository {
  async getAll() {
    return await db.select().from(schema.venue).orderBy(schema.venue.name)
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { page, pageSize, search } = pagination
    const offset = (page - 1) * pageSize

    const whereClause = search ? like(schema.venue.name, `%${search}%`) : undefined

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.venue)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    const items = await db
      .select()
      .from(schema.venue)
      .where(whereClause)
      .limit(pageSize)
      .offset(offset)
      .orderBy(schema.venue.name)

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  async getById(id: number) {
    const result = await db.select().from(schema.venue).where(eq(schema.venue.id, id))
    return result[0] || null
  }

  async create(input: CreateVenueInput) {
    const result = await db
      .insert(schema.venue)
      .values({
        name: input.name,
        capacity: input.capacity ?? null,
        notes: input.notes,
        address_id: input.addressId ?? null,
        company_id: input.companyId ?? null,
        contact_id: input.contactId ?? null
      })
      .returning()

    return result[0]
  }

  async update(input: UpdateVenueInput) {
    const result = await db
      .update(schema.venue)
      .set({
        name: input.name,
        capacity: input.capacity ?? null,
        notes: input.notes,
        address_id: input.addressId ?? null,
        company_id: input.companyId ?? null,
        contact_id: input.contactId ?? null,
        updated_at: sql`datetime('now')`
      })
      .where(eq(schema.venue.id, input.id))
      .returning()

    return result[0]
  }

  async delete(id: number) {
    await db.delete(schema.venue).where(eq(schema.venue.id, id))
  }
}
