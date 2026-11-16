import { injectable } from 'tsyringe'
import { eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { UpsertCompanyInvoiceSettingsInput } from '../api/schemas/invoice.schema'
import type { SetDatevUploadEmailInput } from '../api/schemas/datev.schema'

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
    return db
      .insert(schema.company_invoice_settings)
      .values({ company_id: input.companyId, datev_upload_email: input.datevUploadEmail })
      .onConflictDoUpdate({
        target: schema.company_invoice_settings.company_id,
        set: { datev_upload_email: input.datevUploadEmail, updated_at: sql`datetime('now')` }
      })
      .returning()
      .get()
  }
}
