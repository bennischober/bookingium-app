import { eq, sql } from 'drizzle-orm'
import { schema } from '../../db/schema'
import type { Tx } from '../tx'

/** An invoice needs a non-zero total before it can be issued */
export function assertIssuable(totalGrossCents: number) {
  if (totalGrossCents === 0) {
    throw new Error(
      'Eine Rechnung über 0,00 kann nicht gestellt werden – bitte Positionen erfassen'
    )
  }
}

/** Takes the company's next invoice number and advances its counter */
export function takeNextInvoiceNumber(tx: Tx, companyId: number): number {
  const existingSettings = tx
    .select()
    .from(schema.company_invoice_settings)
    .where(eq(schema.company_invoice_settings.company_id, companyId))
    .limit(1)
    .all()

  // Never below a number already used: with sync, another computer's invoices arrive without
  // moving this computer's counter
  const { highest } = tx
    .select({ highest: sql<number | null>`max(${schema.invoice.invoice_number})` })
    .from(schema.invoice)
    .where(eq(schema.invoice.company_id, companyId))
    .get() ?? { highest: null }
  const assignedInvoiceNumber = Math.max(
    existingSettings[0]?.next_invoice_number ?? 1,
    (highest ?? 0) + 1
  )

  if (existingSettings.length > 0) {
    tx.update(schema.company_invoice_settings)
      .set({
        next_invoice_number: assignedInvoiceNumber + 1,
        updated_at: sql`datetime('now')`
      })
      .where(eq(schema.company_invoice_settings.id, existingSettings[0].id))
      .run()
  } else {
    tx.insert(schema.company_invoice_settings)
      .values({
        company_id: companyId,
        next_invoice_number: assignedInvoiceNumber + 1
      })
      .run()
  }

  return assignedInvoiceNumber
}
