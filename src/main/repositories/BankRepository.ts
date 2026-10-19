import { eq, like, or, sql } from 'drizzle-orm'
import { listOrder, listPage } from './listQuery'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { bank } from '../db/schema'
import type { CreateBankInput, UpdateBankInput } from '../api/schemas/bank.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class BankRepository {
  async getAll() {
    return await db.select().from(bank).orderBy(bank.bank_name)
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { search } = pagination
    const { page, pageSize, offset } = listPage(pagination)

    // Build where clause for search
    const whereClause = search
      ? or(
          like(bank.bank_name, `%${search}%`),
          like(bank.account_holder, `%${search}%`),
          like(bank.iban, `%${search}%`)
        )
      : undefined

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(bank)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    // Get paginated data
    const items = await db
      .select()
      .from(bank)
      .where(whereClause)
      .orderBy(
        ...listOrder(
          pagination,
          {
            bankName: [bank.bank_name],
            accountHolder: [bank.account_holder],
            iban: [bank.iban],
            bic: [bank.bic]
          },
          { key: 'bankName', dir: 'asc' },
          bank.id
        )
      )
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
    const result = await db.select().from(bank).where(eq(bank.id, id))
    return result[0]
  }

  async create(input: CreateBankInput) {
    const result = await db
      .insert(bank)
      .values({
        bank_name: input.bankName,
        account_holder: input.accountHolder,
        iban: input.iban,
        bic: input.bic
      })
      .returning()

    return result[0]
  }

  async update(input: UpdateBankInput) {
    const result = await db
      .update(bank)
      .set({
        bank_name: input.bankName,
        account_holder: input.accountHolder,
        iban: input.iban,
        bic: input.bic
      })
      .where(eq(bank.id, input.id))
      .returning()

    return result[0]
  }

  async delete(id: number) {
    await db.delete(bank).where(eq(bank.id, id))
  }
}
