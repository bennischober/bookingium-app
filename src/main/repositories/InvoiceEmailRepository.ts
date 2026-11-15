import { injectable } from 'tsyringe'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { InvoiceEmailKind } from '../api/schemas/invoice.schema'
import { markEmailedTx } from './invoice/history'

/**
 * The emails of invoices: recording one in the Verlauf, and (I7) the
 * pending sends bookingum started itself until the server confirms them.
 */
@injectable()
export class InvoiceEmailRepository {
  /**
   * Records that an email was created (not a content change). The invoice
   * itself also goes on the invoice for the list's envelope; a payment
   * reminder marks an invoice still "gestellt" as overdue.
   */
  markEmailed(
    id: number,
    to: string,
    kind: InvoiceEmailKind = 'invoice',
    /** C1: set only when bookingum sent the mail itself; null for external programs */
    sent?: { messageId?: string; mailAccountId?: string }
  ) {
    db.transaction((tx) => markEmailedTx(tx, id, to, kind, sent))
  }

  /** I7: bookingum is about to send this invoice mail; written before the send starts */
  addPendingEmail(input: {
    invoiceId: number
    kind: InvoiceEmailKind
    to: string
    mailAccountId: string
    sendKey: string
  }) {
    db.insert(schema.invoice_email_pending)
      .values({
        invoice_id: input.invoiceId,
        kind: input.kind,
        to: input.to,
        mail_account_id: input.mailAccountId,
        send_key: input.sendKey
      })
      // A second send under the same key is the same mail; the first row stands
      .onConflictDoNothing()
      .run()
  }

  /** I7: the send was refused before the server took it, so it will never be confirmed */
  dropPendingEmail(sendKey: string) {
    db.delete(schema.invoice_email_pending)
      .where(eq(schema.invoice_email_pending.send_key, sendKey))
      .run()
  }

  /** I7: whether an account has invoice mails waiting for their send to be confirmed */
  hasPendingEmails(mailAccountId: string): boolean {
    return (
      db
        .select({ id: schema.invoice_email_pending.id })
        .from(schema.invoice_email_pending)
        .where(eq(schema.invoice_email_pending.mail_account_id, mailAccountId))
        .limit(1)
        .get() !== undefined
    )
  }

  /**
   * I7: the send with this key is confirmed. The pending row becomes the invoice's email in
   * one transaction, so the send and a later confirmation of the same mail mark it once.
   * Returns the invoice id, or null when nothing was pending under that key and account.
   */
  confirmPendingEmail(sendKey: string, mailAccountId: string, messageId: string): number | null {
    return db.transaction((tx) => {
      const pending = tx
        .select()
        .from(schema.invoice_email_pending)
        .where(
          and(
            eq(schema.invoice_email_pending.send_key, sendKey),
            eq(schema.invoice_email_pending.mail_account_id, mailAccountId)
          )
        )
        .get()
      if (!pending) return null
      tx.delete(schema.invoice_email_pending)
        .where(eq(schema.invoice_email_pending.id, pending.id))
        .run()
      markEmailedTx(tx, pending.invoice_id, pending.to, pending.kind as InvoiceEmailKind, {
        messageId,
        mailAccountId
      })
      return pending.invoice_id
    })
  }
}
