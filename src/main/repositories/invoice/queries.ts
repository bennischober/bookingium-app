import { and, eq, inArray, isNotNull, lt, or, type SQL } from 'drizzle-orm'
import { schema } from '../../db/schema'
import type { Reader } from '../tx'

/** Read-side building blocks shared by the invoice lists and detail loads */

type InvoiceRow = typeof schema.invoice.$inferSelect

/** A Stornorechnung's original, or an invoice's Stornorechnung */
type CancellationLinks = {
  cancelsInvoice: { id: number; invoice_number: number | null; issue_date: string } | null
  cancelledBy: { id: number; invoice_number: number | null } | null
}

/**
 * Invoices to chase: marked overdue, or still "gestellt" past their due
 * date (`today`: the local calendar day). Not drafts, paid or cancelled
 * ones, nor Stornorechnungen.
 */
export function overdueInvoiceWhere(today: string): SQL | undefined {
  return and(
    eq(schema.invoice.kind, 'invoice'),
    or(
      eq(schema.invoice.status, 'overdue'),
      and(
        eq(schema.invoice.status, 'issued'),
        isNotNull(schema.invoice.due_date),
        lt(schema.invoice.due_date, today)
      )
    )
  )
}

/**
 * Invoices with their issuing company, event and recipient snapshot, the
 * joins every invoice list filters and sorts on. Add `.where()` etc.
 */
export function invoicesWithParties(reader: Reader) {
  return reader
    .select()
    .from(schema.invoice)
    .leftJoin(schema.company, eq(schema.invoice.company_id, schema.company.id))
    .leftJoin(schema.deal_memo, eq(schema.invoice.deal_memo_id, schema.deal_memo.id))
    .leftJoin(
      schema.invoice_party_snapshot,
      eq(schema.invoice.recipient_snapshot_id, schema.invoice_party_snapshot.id)
    )
}

type InvoiceWithPartiesRow = ReturnType<ReturnType<typeof invoicesWithParties>['all']>[number]

/** One joined row as the invoice entity the mappers expect */
export function invoiceEntity<L extends unknown[] = never[]>(
  row: InvoiceWithPartiesRow,
  lineItems: L = [] as unknown as L
) {
  return {
    ...row.invoice,
    company: row.company,
    dealMemo: row.deal_memo,
    recipientSnapshot: row.invoice_party_snapshot,
    lineItems
  }
}

/** Adds the Stornorechnung links (one extra query for all rows) */
export function withCancellationLinks<T extends Pick<InvoiceRow, 'id' | 'cancels_invoice_id'>>(
  reader: Reader,
  rows: T[]
): Array<T & CancellationLinks> {
  const ids = rows.map((row) => row.id)
  const originalIds = rows
    .map((row) => row.cancels_invoice_id)
    .filter((id): id is number => id !== null)
  const related =
    rows.length === 0
      ? []
      : reader
          .select({
            id: schema.invoice.id,
            invoice_number: schema.invoice.invoice_number,
            issue_date: schema.invoice.issue_date,
            cancels_invoice_id: schema.invoice.cancels_invoice_id
          })
          .from(schema.invoice)
          .where(
            or(
              inArray(schema.invoice.id, originalIds),
              inArray(schema.invoice.cancels_invoice_id, ids)
            )
          )
          .all()
  return rows.map((row) => {
    const original = related.find((other) => other.id === row.cancels_invoice_id)
    const cancellation = related.find((other) => other.cancels_invoice_id === row.id)
    return {
      ...row,
      cancelsInvoice: original
        ? {
            id: original.id,
            invoice_number: original.invoice_number,
            issue_date: original.issue_date
          }
        : null,
      cancelledBy: cancellation
        ? { id: cancellation.id, invoice_number: cancellation.invoice_number }
        : null
    }
  })
}
