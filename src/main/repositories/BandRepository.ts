import { injectable } from 'tsyringe'
import { eq, like, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { CreateBandInput, UpdateBandInput } from '../api/schemas/band.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class BandRepository {
  async getAll() {
    return await db.select().from(schema.band)
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { page, pageSize, search } = pagination
    const offset = (page - 1) * pageSize

    // Build where clause for search
    const whereClause = search
      ? or(like(schema.band.name, `%${search}%`), like(schema.band.genre, `%${search}%`))
      : undefined

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.band)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    // Get paginated data
    const items = await db
      .select()
      .from(schema.band)
      .where(whereClause)
      .limit(pageSize)
      .offset(offset)

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  async getById(id: number) {
    const result = await db.select().from(schema.band).where(eq(schema.band.id, id))
    return result[0] || null
  }

  async create(data: CreateBandInput) {
    const result = await db
      .insert(schema.band)
      .values({
        name: data.name,
        genre: data.genre,
        founded: data.founded,
        notes: data.notes,
        company_id: data.companyId
      })
      .returning()
    return result[0]
  }

  async update(data: UpdateBandInput) {
    const result = await db
      .update(schema.band)
      .set({
        name: data.name,
        genre: data.genre,
        founded: data.founded,
        notes: data.notes,
        company_id: data.companyId
      })
      .where(eq(schema.band.id, data.id))
      .returning()
    return result[0]
  }

  async delete(id: number) {
    const result = await db.delete(schema.band).where(eq(schema.band.id, id)).returning()
    return result[0]
  }
}
