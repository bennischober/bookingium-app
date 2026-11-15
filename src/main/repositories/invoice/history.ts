import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { schema } from '../../db/schema'
import type { InvoiceEmailKind, InvoiceStatus } from '../../api/schemas/invoice.schema'
import type { Reader, Tx } from '../tx'

/**
 * An invoice's Verlauf: the statuses it moved to and the emails created
 * for it (the invoice itself and payment reminders).
 */

// UTC with milliseconds for the Verlauf's rows: status changes and emails come
// from two tables, and whole seconds could not tell their order apart
const NOW_MS = sql`strftime('%Y-%m-%d %H:%M:%f', 'now')`

/** Adds the status the invoice moved to to its Verlauf */
export function logStatusTx(tx: Tx, invoiceId: number, status: InvoiceStatus) {
  tx.insert(schema.invoice_status_change)
    .values({ invoice_id: invoiceId, status, created_at: NOW_MS })
    .run()
}

/** The invoice's emails, latest first */
export function listEmails(reader: Reader, invoiceId: number) {
  return reader
    .select()
    .from(schema.invoice_email)
    .where(eq(schema.invoice_email.invoice_id, invoiceId))
    .orderBy(desc(schema.invoice_email.created_at), desc(schema.invoice_email.id))
    .all()
}

/** The statuses the invoice moved to, in order */
export function listStatusChanges(reader: Reader, invoiceId: number) {
  return reader
    .select()
    .from(schema.invoice_status_change)
    .where(eq(schema.invoice_status_change.invoice_id, invoiceId))
    .orderBy(asc(schema.invoice_status_change.created_at), asc(schema.invoice_status_change.id))
    .all()
}

/**
 * Records that an email was created. The invoice itself also goes on the
 * invoice for the list's envelope; a payment reminder marks an invoice
 * still "gestellt" as overdue.
 */
export function markEmailedTx(
  tx: Tx,
  id: number,
  to: string,
  kind: InvoiceEmailKind,
  sent?: { messageId?: string; mailAccountId?: string }
) {
  const email = tx
    .insert(schema.invoice_email)
    .values({
      invoice_id: id,
      to,
      kind,
      message_id: sent?.messageId ?? null,
      mail_account_id: sent?.mailAccountId ?? null,
      created_at: NOW_MS
    })
    .returning()
    .get()
  if (kind === 'invoice') {
    tx.update(schema.invoice)
      .set({ emailed_at: email.created_at, emailed_to: to })
      .where(eq(schema.invoice.id, id))
      .run()
    return
  }
  const marked = tx
    .update(schema.invoice)
    .set({ status: 'overdue', updated_at: sql`datetime('now')` })
    .where(and(eq(schema.invoice.id, id), eq(schema.invoice.status, 'issued')))
    .returning({ id: schema.invoice.id })
    .all()
  if (marked.length > 0) logStatusTx(tx, id, 'overdue')
}
