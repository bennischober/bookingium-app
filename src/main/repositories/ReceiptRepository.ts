import { and, desc, eq, like, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'
import { injectable } from 'tsyringe'
import { db } from '../db'
import { schema } from '../db/schema'
import { listOrder, listPage } from './listQuery'
import type { ReceiptListInput } from '../api/schemas/receipt.schema'

// #225: received documents (Belege). One row per stored file; the DATEV hand-overs are rows
// of datev_transfer with receipt_id set.

type ReceiptInsert = typeof schema.receipt.$inferInsert

const receipt = schema.receipt
const owner = alias(schema.company, 'receipt_owner')
const supplier = alias(schema.company, 'receipt_supplier')
const transfer = schema.datev_transfer

// The DATEV state from the receipt's transfers: a sent one wins over one still pending
const sentAt = sql<string | null>`(SELECT max(${transfer.sent_at}) FROM ${transfer}
  WHERE ${transfer.receipt_id} = ${receipt.id} AND ${transfer.status} = 'sent')`
const hasTransfer = sql<number>`EXISTS (SELECT 1 FROM ${transfer}
  WHERE ${transfer.receipt_id} = ${receipt.id})`
const supplierLabel = sql<string>`coalesce(${supplier.name}, ${receipt.supplier_name})`

const columns = {
  receipt: receipt,
  companyName: owner.name,
  supplierCompanyName: supplier.name,
  datevSentAt: sentAt,
  datevAny: hasTransfer
}

export type ReceiptRow = {
  receipt: typeof schema.receipt.$inferSelect
  companyName: string | null
  supplierCompanyName: string | null
  datevSentAt: string | null
  datevAny: number
}

/** The settings column with the DATEV address of each receipt category */
const DATEV_ADDRESS = sql`CASE ${receipt.category}
  WHEN 'incoming' THEN ${schema.company_invoice_settings.datev_upload_email_incoming}
  WHEN 'cash' THEN ${schema.company_invoice_settings.datev_upload_email_cash}
  WHEN 'credit_card' THEN ${schema.company_invoice_settings.datev_upload_email_credit_card}
  ELSE ${schema.company_invoice_settings.datev_upload_email_other} END`

@injectable()
export class ReceiptRepository {
  private select() {
    return db
      .select(columns)
      .from(receipt)
      .leftJoin(owner, eq(owner.id, receipt.company_id))
      .leftJoin(supplier, eq(supplier.id, receipt.supplier_company_id))
  }

  getById(id: number): ReceiptRow | undefined {
    return this.select().where(eq(receipt.id, id)).get()
  }

  create(values: ReceiptInsert): number {
    return db.insert(receipt).values(values).returning({ id: receipt.id }).get().id
  }

  update(id: number, values: Partial<ReceiptInsert>): void {
    db.update(receipt)
      .set({ ...values, updated_at: sql`datetime('now')` })
      .where(eq(receipt.id, id))
      .run()
  }

  delete(id: number): void {
    db.delete(receipt).where(eq(receipt.id, id)).run()
  }

  /** The id of the company invoices go out from by default, null if none is set */
  defaultCompanyId(): number | null {
    return (
      db
        .select({ id: schema.company.id })
        .from(schema.company)
        .where(eq(schema.company.is_default_for_invoicing, true))
        .get()?.id ?? null
    )
  }

  list(input: ReceiptListInput): {
    items: ReceiptRow[]
    total: number
    page: number
    pageSize: number
  } {
    const { page, pageSize, offset } = listPage(input)
    const conditions: SQL[] = []
    if (input.category) conditions.push(eq(receipt.category, input.category))
    if (input.notSent) conditions.push(sql`${sentAt} IS NULL`)
    const search = input.search?.trim()
    if (search) {
      const pattern = `%${search}%`
      const matched = or(
        like(receipt.file_name, pattern),
        like(receipt.supplier_name, pattern),
        like(supplier.name, pattern),
        like(receipt.reference, pattern),
        like(receipt.notes, pattern)
      )
      if (matched) conditions.push(matched)
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined
    const total =
      db
        .select({ count: sql<number>`count(*)` })
        .from(receipt)
        .leftJoin(supplier, eq(supplier.id, receipt.supplier_company_id))
        .where(where)
        .get()?.count ?? 0
    const items = this.select()
      .where(where)
      .orderBy(
        ...listOrder(
          input,
          {
            receiptDate: [receipt.receipt_date],
            supplierName: [supplierLabel],
            category: [receipt.category],
            amountCents: [receipt.amount_cents],
            fileName: [receipt.file_name],
            createdAt: [receipt.created_at]
          },
          { key: 'receiptDate', dir: 'desc' },
          receipt.id
        )
      )
      .limit(pageSize)
      .offset(offset)
      .all()
    return { items, total, page, pageSize }
  }

  /**
   * Receipts of companies with a DATEV address for their category that were never handed
   * over (a send still being confirmed counts as handed over), oldest first
   */
  listNotHandedOver(limit = 50): ReceiptRow[] {
    return this.select()
      .innerJoin(
        schema.company_invoice_settings,
        eq(schema.company_invoice_settings.company_id, receipt.company_id)
      )
      .where(and(sql`NOT ${hasTransfer}`, sql`${DATEV_ADDRESS} <> ''`))
      .orderBy(sql`${receipt.receipt_date} IS NULL`, receipt.receipt_date, receipt.id)
      .limit(limit)
      .all()
  }

  /** A receipt's hand-overs, newest first */
  listTransfers(id: number) {
    return db
      .select()
      .from(transfer)
      .where(eq(transfer.receipt_id, id))
      .orderBy(desc(transfer.created_at), desc(transfer.id))
      .all()
  }
}
