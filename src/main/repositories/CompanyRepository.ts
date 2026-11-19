import { injectable } from 'tsyringe'
import { eq, like, or, sql } from 'drizzle-orm'
import { listOrder, listPage } from './listQuery'
import { saveContactEmails, withContactEmails } from './contactEmails'
import { deleteUnusedCompanions } from './companions'
import { deleteUnusedGenres, withGenres, writeGenres } from './genres'
import { db } from '../db'
import { company, address, contact, bank, band, invoice } from '../db/schema'
import { CreateCompanyInput, UpdateCompanyInput } from '../api/schemas/company.schema'
import { PaginationInput } from '../api/schemas/base.schema'
import { assertCustomerNumberFree } from './customerNumbers'
import type { Tx } from './tx'
import type { CompanyBankInput } from '../api/schemas/company.schema'

/**
 * #247: writes the account typed in the company form. The company's own bank row is changed
 * in place; a row other companies point at too (picked on the Banken page) is left alone and
 * the company gets a row of its own. All fields empty unlinks the account.
 */
export function saveCompanyBank(
  tx: Tx,
  companyId: number | null,
  currentBankId: number | null,
  input: CompanyBankInput
): number | null {
  const values = {
    account_holder: input.accountHolder.trim(),
    iban: input.iban.replace(/\s+/g, '').toUpperCase(),
    bic: input.bic.replace(/\s+/g, '').toUpperCase(),
    bank_name: input.bankName.trim()
  }
  if (!values.account_holder && !values.iban && !values.bic && !values.bank_name) return null
  if (currentBankId !== null) {
    const current = tx.select().from(bank).where(eq(bank.id, currentBankId)).get()
    // unchanged (also for a shared row): keep the link, write nothing
    if (
      current &&
      current.account_holder === values.account_holder &&
      current.iban.replace(/\s+/g, '').toUpperCase() === values.iban &&
      current.bic.replace(/\s+/g, '').toUpperCase() === values.bic &&
      current.bank_name === values.bank_name
    )
      return currentBankId
    const shared = tx
      .select({ id: company.id })
      .from(company)
      .where(eq(company.bank_id, currentBankId))
      .all()
      .some((row) => row.id !== companyId)
    if (!shared) {
      tx.update(bank).set(values).where(eq(bank.id, currentBankId)).run()
      return currentBankId
    }
  }
  return tx.insert(bank).values(values).returning({ id: bank.id }).get().id
}

@injectable()
export class CompanyRepository {
  async getAll() {
    const rows = await db
      .select()
      .from(company)
      .leftJoin(address, eq(company.address_id, address.id))
      .leftJoin(contact, eq(company.contact_id, contact.id))
      .leftJoin(bank, eq(company.bank_id, bank.id))

    return withGenres(
      'company',
      withContactEmails(
        rows.map((row) => ({
          ...row.company,
          address: row.address,
          contact: row.contact,
          bank: row.bank
        }))
      )
    )
  }

  /** Companies naming the person as invoice contact (e-invoice seller contact), by name */
  async listByInvoiceContact(personId: number) {
    const rows = await db
      .select()
      .from(company)
      .leftJoin(address, eq(company.address_id, address.id))
      .leftJoin(contact, eq(company.contact_id, contact.id))
      .leftJoin(bank, eq(company.bank_id, bank.id))
      .where(eq(company.invoice_contact_person_id, personId))
      .orderBy(company.name)

    return withGenres(
      'company',
      withContactEmails(
        rows.map((row) => ({
          ...row.company,
          address: row.address,
          contact: row.contact,
          bank: row.bank
        }))
      )
    )
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { search } = pagination
    const { page, pageSize, offset } = listPage(pagination)

    // Build where clause for search
    const whereClause = search ? or(like(company.name, `%${search}%`)) : undefined

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(company)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    // Get paginated data with joins
    const rows = await db
      .select()
      .from(company)
      .leftJoin(address, eq(company.address_id, address.id))
      .leftJoin(contact, eq(company.contact_id, contact.id))
      .leftJoin(bank, eq(company.bank_id, bank.id))
      .where(whereClause)
      .orderBy(
        ...listOrder(
          pagination,
          {
            name: [company.name],
            vatId: [company.vat_id],
            contact: [contact.email],
            address: [address.city],
            bank: [bank.bank_name]
          },
          { key: 'name', dir: 'asc' },
          company.id
        )
      )
      .limit(pageSize)
      .offset(offset)

    const items = withGenres(
      'company',
      withContactEmails(
        rows.map((row) => ({
          ...row.company,
          address: row.address,
          contact: row.contact,
          bank: row.bank
        }))
      )
    )

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  async getById(id: number) {
    const rows = await db
      .select()
      .from(company)
      .leftJoin(address, eq(company.address_id, address.id))
      .leftJoin(contact, eq(company.contact_id, contact.id))
      .leftJoin(bank, eq(company.bank_id, bank.id))
      .where(eq(company.id, id))

    if (rows.length === 0) return null

    const row = rows[0]
    return withGenres(
      'company',
      withContactEmails([
        {
          ...row.company,
          address: row.address,
          contact: row.contact,
          bank: row.bank
        }
      ])
    )[0]
  }

  async create(input: CreateCompanyInput) {
    return await db.transaction((tx) => {
      assertCustomerNumberFree(tx, input.customerNumber, { kind: 'company', id: null })
      if (input.isDefaultForInvoicing) {
        tx.update(company).set({ is_default_for_invoicing: false }).run()
      }

      // Create address if provided
      let addressId: number | null = null
      if (input.address) {
        const addressResult = tx
          .insert(address)
          .values({
            street: input.address.street,
            street_number: input.address.streetNumber,
            address_suffix: input.address.addressSuffix,
            zip_code: input.address.zipCode,
            city: input.address.city,
            state: input.address.state,
            country: input.address.country,
            country_code: input.address.countryCode
          })
          .returning()
          .all()
        addressId = addressResult[0].id
      }

      // Create contact if provided
      let contactId: number | null = null
      if (input.contact) {
        const contactResult = tx
          .insert(contact)
          .values({
            email: input.contact.email,
            phone: input.contact.phone,
            mobile_phone: input.contact.mobilePhone,
            no_advertising: input.contact.noAdvertising,
            homepage: input.contact.homepage
          })
          .returning()
          .all()
        contactId = contactResult[0].id
        saveContactEmails(tx, contactId, input.contact.email, input.contact.otherEmails)
      }

      // Create company
      const companyResult = tx
        .insert(company)
        .values({
          name: input.name,
          kind: input.kind ?? 'company',
          notes: input.notes || '',
          vat_id: input.vatId || '',
          tax_number: input.taxNumber || '',
          commercial_register_no: input.commercialRegisterNo || '',
          register_court: input.registerCourt || '',
          logo_path: input.logoPath || '',
          signature_path: input.signaturePath || '',
          ksk_number: input.kskNumber || '',
          customer_number: input.customerNumber ?? null,
          is_default_for_invoicing: input.isDefaultForInvoicing,
          invoice_contact_person_id: input.invoiceContactPersonId ?? null,
          address_id: addressId,
          contact_id: contactId,
          bank_id: input.bank ? saveCompanyBank(tx, null, null, input.bank) : input.bankId || null
        })
        .returning()
        .all()
      writeGenres(tx, 'company', companyResult[0].id, input.genres ?? '')

      // Fetch with relations
      const created = tx
        .select()
        .from(company)
        .leftJoin(address, eq(company.address_id, address.id))
        .leftJoin(contact, eq(company.contact_id, contact.id))
        .leftJoin(bank, eq(company.bank_id, bank.id))
        .where(eq(company.id, companyResult[0].id))
        .all()

      const row = created[0]
      return withGenres(
        'company',
        withContactEmails(
          [
            {
              ...row.company,
              address: row.address,
              contact: row.contact,
              bank: row.bank
            }
          ],
          tx
        ),
        tx
      )[0]
    })
  }

  async update(input: UpdateCompanyInput) {
    return await db.transaction((tx) => {
      // Get existing company to check for existing address/contact
      const existing = tx.select().from(company).where(eq(company.id, input.id)).all()
      if (existing.length === 0) throw new Error('Firma nicht gefunden')

      const existingCompany = existing[0]
      assertCustomerNumberFree(tx, input.customerNumber, { kind: 'company', id: input.id })

      if (input.isDefaultForInvoicing) {
        tx.update(company).set({ is_default_for_invoicing: false }).run()
      }

      // Update or create address
      let addressId = existingCompany.address_id
      if (input.address) {
        if (addressId) {
          // Update existing address
          tx.update(address)
            .set({
              street: input.address.street,
              street_number: input.address.streetNumber,
              address_suffix: input.address.addressSuffix,
              zip_code: input.address.zipCode,
              city: input.address.city,
              state: input.address.state,
              country: input.address.country,
              country_code: input.address.countryCode
            })
            .where(eq(address.id, addressId))
            .run()
        } else {
          // Create new address
          const addressResult = tx
            .insert(address)
            .values({
              street: input.address.street,
              street_number: input.address.streetNumber,
              address_suffix: input.address.addressSuffix,
              zip_code: input.address.zipCode,
              city: input.address.city,
              state: input.address.state,
              country: input.address.country,
              country_code: input.address.countryCode
            })
            .returning()
            .all()
          addressId = addressResult[0].id
        }
      }

      // Update or create contact
      let contactId = existingCompany.contact_id
      if (input.contact) {
        if (contactId) {
          // Update existing contact
          tx.update(contact)
            .set({
              email: input.contact.email,
              phone: input.contact.phone,
              mobile_phone: input.contact.mobilePhone,
              no_advertising: input.contact.noAdvertising,
              homepage: input.contact.homepage
            })
            .where(eq(contact.id, contactId))
            .run()
        } else {
          // Create new contact
          const contactResult = tx
            .insert(contact)
            .values({
              email: input.contact.email,
              phone: input.contact.phone,
              mobile_phone: input.contact.mobilePhone,
              no_advertising: input.contact.noAdvertising,
              homepage: input.contact.homepage
            })
            .returning()
            .all()
          contactId = contactResult[0].id
        }
        saveContactEmails(tx, contactId, input.contact.email, input.contact.otherEmails)
      }

      // Update company. Every optional key keeps the stored value when absent
      // (partial update, e.g. the logo-only update after company creation).
      tx.update(company)
        .set({
          name: input.name ?? existingCompany.name,
          kind: input.kind ?? existingCompany.kind,
          notes: input.notes ?? existingCompany.notes,
          vat_id: input.vatId ?? existingCompany.vat_id,
          tax_number: input.taxNumber ?? existingCompany.tax_number,
          commercial_register_no:
            input.commercialRegisterNo ?? existingCompany.commercial_register_no,
          register_court: input.registerCourt ?? existingCompany.register_court,
          logo_path: input.logoPath ?? existingCompany.logo_path,
          signature_path: input.signaturePath ?? existingCompany.signature_path,
          ksk_number: input.kskNumber ?? existingCompany.ksk_number,
          customer_number:
            input.customerNumber !== undefined
              ? input.customerNumber
              : existingCompany.customer_number,
          is_default_for_invoicing:
            input.isDefaultForInvoicing ?? existingCompany.is_default_for_invoicing,
          invoice_contact_person_id:
            'invoiceContactPersonId' in input
              ? (input.invoiceContactPersonId ?? null)
              : existingCompany.invoice_contact_person_id,
          address_id: addressId,
          contact_id: contactId,
          bank_id: input.bank
            ? saveCompanyBank(tx, input.id, existingCompany.bank_id, input.bank)
            : (input.bankId ?? existingCompany.bank_id),
          updated_at: sql`datetime('now')`
        })
        .where(eq(company.id, input.id))
        .run()
      if (input.genres !== undefined) writeGenres(tx, 'company', input.id, input.genres)
      deleteUnusedCompanions(tx, existingCompany)

      // Fetch with relations
      const updated = tx
        .select()
        .from(company)
        .leftJoin(address, eq(company.address_id, address.id))
        .leftJoin(contact, eq(company.contact_id, contact.id))
        .leftJoin(bank, eq(company.bank_id, bank.id))
        .where(eq(company.id, input.id))
        .all()

      const row = updated[0]
      return withGenres(
        'company',
        withContactEmails(
          [
            {
              ...row.company,
              address: row.address,
              contact: row.contact,
              bank: row.bank
            }
          ],
          tx
        ),
        tx
      )[0]
    })
  }

  /** #162: rows whose company_id has no ON DELETE rule, so they block the delete */
  deleteBlockers(id: number) {
    const count = (table: typeof band | typeof invoice) =>
      db
        .select({ n: sql<number>`count(*)` })
        .from(table)
        .where(eq(table.company_id, id))
        .get()?.n ?? 0
    return { bands: count(band), invoices: count(invoice) }
  }

  async delete(id: number) {
    return db.transaction((tx) => {
      const [deleted] = tx.delete(company).where(eq(company.id, id)).returning().all()
      if (deleted) deleteUnusedCompanions(tx, deleted)
      deleteUnusedGenres(tx)
      return deleted
    })
  }

  /** Makes one company the default own company (or none) */
  async setDefaultForInvoicing(companyId: number | null) {
    db.transaction((tx) => {
      tx.update(company).set({ is_default_for_invoicing: false }).run()
      if (companyId !== null) {
        const updated = tx
          .update(company)
          .set({ is_default_for_invoicing: true })
          .where(eq(company.id, companyId))
          .returning({ id: company.id })
          .all()
        if (updated.length === 0) throw new Error('Firma nicht gefunden')
      }
    })
  }

  async getDefaultForInvoicing() {
    const rows = await db
      .select()
      .from(company)
      .leftJoin(address, eq(company.address_id, address.id))
      .leftJoin(contact, eq(company.contact_id, contact.id))
      .leftJoin(bank, eq(company.bank_id, bank.id))
      .where(eq(company.is_default_for_invoicing, true))
      .limit(1)

    if (rows.length === 0) return null

    const row = rows[0]
    return withGenres(
      'company',
      withContactEmails([
        {
          ...row.company,
          address: row.address,
          contact: row.contact,
          bank: row.bank
        }
      ])
    )[0]
  }
}
