import { injectable } from 'tsyringe'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'

/**
 * Documents handed to DATEV by DATEV Upload Mail: written as pending before the send, set to
 * sent once the server confirms it (the same exactly-once bookkeeping as invoice mails, I7)
 */
@injectable()
export class DatevTransferRepository {
  /** Written before the send starts */
  addPending(input: {
    invoiceId: number
    to: string
    fileName: string
    mailAccountId: string
    sendKey: string
  }) {
    db.insert(schema.datev_transfer)
      .values({
        invoice_id: input.invoiceId,
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
}
