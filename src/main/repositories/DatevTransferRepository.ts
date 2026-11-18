import { injectable } from 'tsyringe'
import { and, asc, desc, eq, isNotNull, ne, notExists, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { DatevCategory } from '../api/schemas/datev.schema'

/**
 * Documents handed to DATEV by DATEV Upload Mail: written as pending before the send, set to
 * sent once the server confirms it (the same exactly-once bookkeeping as invoice mails, I7)
 */
@injectable()
export class DatevTransferRepository {
  /** Written before the send starts */
  addPending(input: {
    /** The document: an issued invoice or a receipt (#225), exactly one */
    invoiceId?: number
    receiptId?: number
    category: DatevCategory
    to: string
    fileName: string
    mailAccountId: string
    sendKey: string
  }) {
    db.insert(schema.datev_transfer)
      .values({
        invoice_id: input.invoiceId ?? null,
        receipt_id: input.receiptId ?? null,
        category: input.category,
        to: input.to,
        file_name: input.fileName,
        mail_account_id: input.mailAccountId,
        send_key: input.sendKey
      })
      // A second send under the same key is the same mail; the first row stands
      .onConflictDoNothing()
      .run()
  }

  /** The send was refused before the server took it, so it will never be confirmed */
  dropPending(sendKey: string) {
    db.delete(schema.datev_transfer)
      .where(
        and(
          eq(schema.datev_transfer.send_key, sendKey),
          eq(schema.datev_transfer.status, 'pending')
        )
      )
      .run()
  }

  /** Whether an account has DATEV mails waiting for their send to be confirmed */
  hasPending(mailAccountId: string): boolean {
    return (
      db
        .select({ id: schema.datev_transfer.id })
        .from(schema.datev_transfer)
        .where(
          and(
            eq(schema.datev_transfer.mail_account_id, mailAccountId),
            eq(schema.datev_transfer.status, 'pending')
          )
        )
        .limit(1)
        .get() !== undefined
    )
  }

  /**
   * The send with this key is confirmed. Only a pending row changes, so the send and a later
   * confirmation of the same mail mark it once. Returns the invoice id, or null when nothing
   * was pending under that key and account.
   */
  confirm(sendKey: string, mailAccountId: string, messageId: string): number | null {
    const row = db
      .update(schema.datev_transfer)
      .set({ status: 'sent', message_id: messageId, sent_at: sql`datetime('now')` })
      .where(
        and(
          eq(schema.datev_transfer.send_key, sendKey),
          eq(schema.datev_transfer.mail_account_id, mailAccountId),
          eq(schema.datev_transfer.status, 'pending')
        )
      )
      .returning({ invoiceId: schema.datev_transfer.invoice_id })
      .get()
    return row?.invoiceId ?? null
  }

  /** An invoice's transfers, newest first */
  listForInvoice(invoiceId: number) {
    return db
      .select()
      .from(schema.datev_transfer)
      .where(eq(schema.datev_transfer.invoice_id, invoiceId))
      .orderBy(desc(schema.datev_transfer.created_at), desc(schema.datev_transfer.id))
      .all()
  }

  /**
   * Issued invoices of companies with a DATEV address that have not been handed over (no sent
   * transfer; one still being confirmed counts as handed over), oldest first
   */
  listNotHandedOver(limit = 50) {
    const transfer = schema.datev_transfer
    return db
      .select({
        id: schema.invoice.id,
        invoiceNumber: schema.invoice.invoice_number,
        kind: schema.invoice.kind,
        issueDate: schema.invoice.issue_date,
        totalGrossCents: schema.invoice.total_gross_cents,
        currency: schema.invoice.currency,
        recipientName: schema.invoice_party_snapshot.legal_name
      })
      .from(schema.invoice)
      .innerJoin(
        schema.company_invoice_settings,
        eq(schema.company_invoice_settings.company_id, schema.invoice.company_id)
      )
      .leftJoin(
        schema.invoice_party_snapshot,
        eq(schema.invoice_party_snapshot.id, schema.invoice.recipient_snapshot_id)
      )
      .where(
        and(
          isNotNull(schema.invoice.invoice_number),
          ne(schema.company_invoice_settings.datev_upload_email, ''),
          notExists(
            db
              .select({ id: transfer.id })
              .from(transfer)
              .where(eq(transfer.invoice_id, schema.invoice.id))
          )
        )
      )
      .orderBy(asc(schema.invoice.issue_date), asc(schema.invoice.invoice_number))
      .limit(limit)
      .all()
  }
}
