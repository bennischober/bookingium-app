import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { CreateCompanyInput, UpdateCompanyInput } from '../api/schemas/company.schema'

@injectable()
export class CompanyRepository {
  async getAll() {
    return await db.select().from(schema.company)
  }

  async getById(id: number) {
    const result = await db.select().from(schema.company).where(eq(schema.company.id, id))
    return result[0] || null
  }

  async create(data: CreateCompanyInput) {
    const result = await db
      .insert(schema.company)
      .values({
        name: data.name,
        notes: data.notes,
        vat_number: data.vatNumber,
        ust_number: data.ustNumber
      })
      .returning()
    return result[0]
  }

  async update(data: UpdateCompanyInput) {
    const result = await db
      .update(schema.company)
      .set({
        name: data.name,
        notes: data.notes,
        vat_number: data.vatNumber,
        ust_number: data.ustNumber
      })
      .where(eq(schema.company.id, data.id))
      .returning()
    return result[0]
  }

  async delete(id: number) {
    const result = await db.delete(schema.company).where(eq(schema.company.id, id)).returning()
    return result[0]
  }
}
