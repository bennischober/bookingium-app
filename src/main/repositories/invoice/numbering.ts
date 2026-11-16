import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { schema } from '../../db/schema'
import type { InvoiceNumberFormat } from '../../api/schemas/invoice.schema'
import { takeNumber, type NumberingSettings } from '../../invoice/numbering'
import type { Tx } from '../tx'

/** An invoice needs a non-zero total before it can be issued */
export function assertIssuable(totalGrossCents: number) {
  if (totalGrossCents === 0) {
    throw new Error(
      'Eine Rechnung über 0,00 kann nicht gestellt werden – bitte Positionen erfassen'
    )
  }
}

type SettingsRow = typeof schema.company_invoice_settings.$inferSelect

/** The numbering part of a settings row; a company without one starts at 1, plain */
export function numberingOf(row: SettingsRow | undefined): NumberingSettings {
  return {
    format: (row?.invoice_number_format ?? 'plain') as InvoiceNumberFormat,
    digits: row?.invoice_number_digits ?? 3,
    yearlyReset: row?.invoice_number_yearly_reset ?? false,
    next: row?.next_invoice_number ?? 1,
    lastYear: row?.invoice_number_year ?? null
  }
}

/** "2026-11-16" -> "16.11.2026" */
function germanDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

/**
 * Numbers and dates go to DATEV in one order: an invoice is not issued with a date before
 * the company's last issued one, or its number would be later than an invoice dated after it
 */
export function assertChronological(tx: Tx, companyId: number, issueDate: string) {
  const latest = tx
    .select({
      number: schema.invoice.invoice_number,
      issueDate: schema.invoice.issue_date
    })
    .from(schema.invoice)
    .where(and(eq(schema.invoice.company_id, companyId), isNotNull(schema.invoice.invoice_number)))
    .orderBy(desc(schema.invoice.issue_date))
    .limit(1)
    .get()
  if (latest && latest.issueDate > issueDate) {
    throw new Error(
      `Das Rechnungsdatum ${germanDate(issueDate)} liegt vor der letzten gestellten Rechnung ` +
        `(Nr. ${latest.number} vom ${germanDate(latest.issueDate)}). Bitte ein Datum ab dem ` +
        `${germanDate(latest.issueDate)} wählen, damit Nummern und Daten fortlaufend bleiben.`
    )
  }
}

/**
 * Takes the company's next invoice number for an invoice issued on `issueDate` and advances
 * its counter. Refuses a date before the last issued invoice (assertChronological).
 */
export function takeNextInvoiceNumber(tx: Tx, companyId: number, issueDate: string): number {
  assertChronological(tx, companyId, issueDate)
  const existing = tx
    .select()
    .from(schema.company_invoice_settings)
    .where(eq(schema.company_invoice_settings.company_id, companyId))
    .limit(1)
    .all()[0]

  const taken = takeNumber(numberingOf(existing), Number(issueDate.slice(0, 4)))
  const values = {
    next_invoice_number: taken.next,
    invoice_number_year: taken.year,
    updated_at: sql`datetime('now')`
  }

  if (existing) {
    tx.update(schema.company_invoice_settings)
      .set(values)
      .where(eq(schema.company_invoice_settings.id, existing.id))
      .run()
  } else {
    tx.insert(schema.company_invoice_settings)
      .values({ company_id: companyId, ...values })
      .run()
  }

  return taken.number
}
