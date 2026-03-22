import { injectable } from 'tsyringe'
import { and, desc, eq, like, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type {
  CreateInvoiceForDealMemoInput,
  UpsertCompanyInvoiceSettingsInput,
  UpdateInvoiceInput
} from '../api/schemas/invoice.schema'
import type { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class InvoiceRepository {
  async getAllPaginated(pagination: PaginationInput) {
    const { page, pageSize, search } = pagination
    const offset = (page - 1) * pageSize

    const whereClause = search
      ? or(
          like(schema.company.name, `%${search}%`),
          like(schema.deal_memo.name, `%${search}%`),
          like(schema.invoice.status, `%${search}%`),
          like(schema.invoice.currency, `%${search}%`),
          sql`CAST(${schema.invoice.invoice_number} AS TEXT) LIKE ${`%${search}%`}`
        )
      : undefined

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .where(whereClause)

    const total = countResult[0]?.count || 0

    const rows = await db
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .where(whereClause)
      .orderBy(desc(schema.invoice.created_at), desc(schema.invoice.id))
      .limit(pageSize)
      .offset(offset)

    const items = rows.map((row) => ({
      ...row.invoice,
      company: row.company,
      dealMemo: row.deal_memo
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
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .where(eq(schema.invoice.id, id))

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      ...row.invoice,
      company: row.company,
      dealMemo: row.deal_memo
    }
  }

  async getCompanyInvoiceSettings(companyId: number) {
    const rows = await db
      .select()
      .from(schema.company_invoice_settings)
      .where(eq(schema.company_invoice_settings.company_id, companyId))
      .limit(1)

    return rows[0] ?? null
  }

  async upsertCompanyInvoiceSettings(input: UpsertCompanyInvoiceSettingsInput) {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select()
        .from(schema.company_invoice_settings)
        .where(eq(schema.company_invoice_settings.company_id, input.companyId))
        .limit(1)

      if (existing.length > 0) {
        const updated = await tx
          .update(schema.company_invoice_settings)
          .set({
            next_invoice_number: input.nextInvoiceNumber,
            updated_at: sql`datetime('now')`
          })
          .where(eq(schema.company_invoice_settings.id, existing[0].id))
          .returning()

        return updated[0]
      }

      const created = await tx
        .insert(schema.company_invoice_settings)
        .values({
          company_id: input.companyId,
          next_invoice_number: input.nextInvoiceNumber
        })
        .returning()

      return created[0]
    })
  }

  private async resolveInvoiceCompanyId(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], input: CreateInvoiceForDealMemoInput) {
    if (input.companyId) return input.companyId

    const memoRows = await tx
      .select({
        invoiceCompanyId: schema.deal_memo.invoice_company_id,
        loProCompanyId: schema.deal_memo.lopro_company_id
      })
      .from(schema.deal_memo)
      .where(eq(schema.deal_memo.id, input.dealMemoId))
      .limit(1)

    if (memoRows.length === 0) {
      throw new Error('Deal memo not found')
    }

    const memo = memoRows[0]

    if (memo.invoiceCompanyId) {
      return memo.invoiceCompanyId
    }

    if (memo.loProCompanyId) {
      return memo.loProCompanyId
    }

    const defaultCompany = await tx
      .select({ id: schema.company.id })
      .from(schema.company)
      .where(eq(schema.company.is_default_for_invoicing, true))
      .limit(1)

    if (defaultCompany.length === 0) {
      throw new Error('No invoicing company configured. Set a default company or pick one explicitly.')
    }

    return defaultCompany[0].id
  }

  async createForDealMemo(input: CreateInvoiceForDealMemoInput) {
    return await db.transaction(async (tx) => {
      const companyId = await this.resolveInvoiceCompanyId(tx, input)

      const existingSettings = await tx
        .select()
        .from(schema.company_invoice_settings)
        .where(eq(schema.company_invoice_settings.company_id, companyId))
        .limit(1)

      const assignedInvoiceNumber = existingSettings[0]?.next_invoice_number ?? 1

      if (existingSettings.length > 0) {
        await tx
          .update(schema.company_invoice_settings)
          .set({
            next_invoice_number: assignedInvoiceNumber + 1,
            updated_at: sql`datetime('now')`
          })
          .where(eq(schema.company_invoice_settings.id, existingSettings[0].id))
      } else {
        await tx.insert(schema.company_invoice_settings).values({
          company_id: companyId,
          next_invoice_number: assignedInvoiceNumber + 1
        })
      }

      const created = await tx
        .insert(schema.invoice)
        .values({
          invoice_number: assignedInvoiceNumber,
          company_id: companyId,
          deal_memo_id: input.dealMemoId,
          issue_date: input.issueDate ?? new Date().toISOString().slice(0, 10),
          due_date: input.dueDate ?? null,
          status: input.status ?? 'draft',
          currency: input.currency ?? 'EUR',
          total_amount: input.totalAmount ?? 0,
          notes: input.notes ?? ''
        })
        .returning()

      const invoiceId = created[0].id

      const rows = await tx
        .select()
        .from(schema.invoice)
        .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
        .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
        .where(eq(schema.invoice.id, invoiceId))
        .limit(1)

      const row = rows[0]
      return {
        ...row.invoice,
        company: row.company,
        dealMemo: row.deal_memo
      }
    })
  }

  async update(input: UpdateInvoiceInput) {
    const values: Record<string, unknown> = {
      updated_at: sql`datetime('now')`
    }

    if ('issueDate' in input) values.issue_date = input.issueDate
    if ('dueDate' in input) values.due_date = input.dueDate ?? null
    if ('status' in input) values.status = input.status
    if ('currency' in input) values.currency = input.currency
    if ('totalAmount' in input) values.total_amount = input.totalAmount
    if ('notes' in input) values.notes = input.notes

    const updated = await db
      .update(schema.invoice)
      .set(values)
      .where(eq(schema.invoice.id, input.id))
      .returning()

    if (updated.length === 0) {
      throw new Error('Invoice not found')
    }

    const rows = await db
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .where(eq(schema.invoice.id, updated[0].id))
      .limit(1)

    const row = rows[0]
    return {
      ...row.invoice,
      company: row.company,
      dealMemo: row.deal_memo
    }
  }

  async delete(id: number) {
    await db.delete(schema.invoice).where(eq(schema.invoice.id, id))
  }

  async getByDealMemoId(dealMemoId: number) {
    const rows = await db
      .select()
      .from(schema.invoice)
      .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
      .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
      .where(eq(schema.invoice.deal_memo_id, dealMemoId))
      .orderBy(desc(schema.invoice.created_at), desc(schema.invoice.id))

    return rows.map((row) => ({
      ...row.invoice,
      company: row.company,
      dealMemo: row.deal_memo
    }))
  }

  async findByCompanyAndInvoiceNumber(companyId: number, invoiceNumber: number) {
    const rows = await db
      .select()
      .from(schema.invoice)
      .where(
        and(eq(schema.invoice.company_id, companyId), eq(schema.invoice.invoice_number, invoiceNumber))
      )
      .limit(1)

    return rows[0] ?? null
  }
}
