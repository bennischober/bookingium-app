import { injectable } from 'tsyringe'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type {
  SetInvoiceNumberingInput,
  UpsertCompanyInvoiceSettingsInput
} from '../api/schemas/invoice.schema'
import type { DatevCategory, SetDatevUploadEmailInput } from '../api/schemas/datev.schema'

/** The settings column holding each DATEV category's upload address */
export const DATEV_EMAIL_COLUMNS = {
  outgoing: 'datev_upload_email',
  incoming: 'datev_upload_email_incoming',
  cash: 'datev_upload_email_cash',
  other: 'datev_upload_email_other',
  credit_card: 'datev_upload_email_credit_card'
} as const satisfies Record<
  DatevCategory,
  keyof typeof schema.company_invoice_settings.$inferSelect
>

/** A company's invoice settings (its next invoice number, its DATEV upload address) */
@injectable()
export class InvoiceSettingsRepository {
  async getCompanyInvoiceSettings(companyId: number) {
    const rows = await db
      .select()
      .from(schema.company_invoice_settings)
      .where(eq(schema.company_invoice_settings.company_id, companyId))
      .limit(1)

    return rows[0] ?? null
  }

  async upsertCompanyInvoiceSettings(input: UpsertCompanyInvoiceSettingsInput) {
    return db.transaction((tx) => {
      const existing = tx
        .select()
        .from(schema.company_invoice_settings)
        .where(eq(schema.company_invoice_settings.company_id, input.companyId))
        .limit(1)
        .all()

      if (existing.length > 0) {
        const updated = tx
          .update(schema.company_invoice_settings)
          .set({
            next_invoice_number: input.nextInvoiceNumber,
            updated_at: sql`datetime('now')`
          })
          .where(eq(schema.company_invoice_settings.id, existing[0].id))
          .returning()
          .all()

        return updated[0]
      }

      const created = tx
        .insert(schema.company_invoice_settings)
        .values({
          company_id: input.companyId,
          next_invoice_number: input.nextInvoiceNumber
        })
        .returning()
        .all()

      return created[0]
    })
  }

  /**
   * Sets the company's DATEV Upload Mail address. A company without settings gets its row
   * now, with the next invoice number a missing row stands for (1).
   */
  async setDatevUploadEmail(input: SetDatevUploadEmailInput) {
    const column = DATEV_EMAIL_COLUMNS[input.category ?? 'outgoing']
    return db
      .insert(schema.company_invoice_settings)
      .values({ company_id: input.companyId, [column]: input.datevUploadEmail })
      .onConflictDoUpdate({
        target: schema.company_invoice_settings.company_id,
        set: { [column]: input.datevUploadEmail, updated_at: sql`datetime('now')` }
      })
      .returning()
      .get()
  }

  /** How the company's numbers are built; a company without settings gets its row now */
  async setNumbering(input: SetInvoiceNumberingInput) {
    const values = {
      invoice_number_format: input.format,
      invoice_number_digits: input.digits,
      invoice_number_yearly_reset: input.yearlyReset
    }
    return db
      .insert(schema.company_invoice_settings)
      .values({ company_id: input.companyId, ...values })
      .onConflictDoUpdate({
        target: schema.company_invoice_settings.company_id,
        set: { ...values, updated_at: sql`datetime('now')` }
      })
      .returning()
      .get()
  }
}
