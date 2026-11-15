import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import {
  companySnapshotValues,
  currentSnapshotValues,
  resolveInvoiceCompanyId,
  resolveRecipientValues,
  snapshotById,
  type RecipientSnapshotInput
} from './invoice/partySnapshots'

/** Read-only views of an invoice's parties as issuing would freeze them (e-invoice check) */
@injectable()
export class InvoicePartyRepository {
  /** A draft's parties with their current master data, as issuing would freeze them */
  currentParties(invoiceId: number) {
    return db.transaction((tx) => {
      const row = tx.select().from(schema.invoice).where(eq(schema.invoice.id, invoiceId)).all()[0]
      if (!row) throw new Error('Invoice not found')
      const recipient = snapshotById(tx, row.recipient_snapshot_id)
      return {
        issuer: companySnapshotValues(tx, row.company_id),
        recipient: recipient ? currentSnapshotValues(tx, recipient) : null
      }
    })
  }

  /**
   * Issuer and recipient as an invoice with this input would freeze them
   * now; nothing is written (e-invoice check in the invoice form)
   */
  previewParties(input: RecipientSnapshotInput) {
    return db.transaction((tx) => {
      const companyId = resolveInvoiceCompanyId(tx, input)
      return {
        issuer: companySnapshotValues(tx, companyId),
        recipient: resolveRecipientValues(tx, input, companyId)
      }
    })
  }
}
