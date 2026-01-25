import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { CreateBandInput, UpdateBandInput } from '../api/schemas/band.schema'

@injectable()
export class BandRepository {
  async getAll() {
    return await db.select().from(schema.band)
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
}
