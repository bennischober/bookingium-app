import { injectable } from 'tsyringe'
import { eq, like, or, sql } from 'drizzle-orm'
import { listOrder, listPage } from './listQuery'
import { saveContactEmails, withContactEmails } from './contactEmails'
import { db } from '../db'
import { company, address, contact, bank } from '../db/schema'
import { CreateCompanyInput, UpdateCompanyInput } from '../api/schemas/company.schema'
import { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class CompanyRepository {
  async getAll() {
    const rows = await db
      .select()
      .from(company)
      .leftJoin(address, eq(company.address_id, address.id))
      .leftJoin(contact, eq(company.contact_id, contact.id))
      .leftJoin(bank, eq(company.bank_id, bank.id))

    return withContactEmails(
      rows.map((row) => ({
        ...row.company,
        address: row.address,
        contact: row.contact,
        bank: row.bank
      }))
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

    return withContactEmails(
      rows.map((row) => ({
        ...row.company,
        address: row.address,
        contact: row.contact,
        bank: row.bank
      }))
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
            vatNumber: [company.vat_number],
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

    const items = withContactEmails(
      rows.map((row) => ({
        ...row.company,
        address: row.address,
        contact: row.contact,
        bank: row.bank
      }))
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
    return withContactEmails([
      {
        ...row.company,
        address: row.address,
        contact: row.contact,
        bank: row.bank
      }
    ])[0]
  }

  async create(input: CreateCompanyInput) {
    return await db.transaction((tx) => {
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
          notes: input.notes || '',
          vat_number: input.vatNumber || '',
          ust_number: input.ustNumber || '',
          tax_number: input.taxNumber || '',
          commercial_register_no: input.commercialRegisterNo || '',
          register_court: input.registerCourt || '',
          logo_path: input.logoPath || '',
          signature_path: input.signaturePath || '',
          ksk_number: input.kskNumber || '',
          is_default_for_invoicing: input.isDefaultForInvoicing,
          invoice_contact_person_id: input.invoiceContactPersonId ?? null,
          address_id: addressId,
          contact_id: contactId,
          bank_id: input.bankId || null
        })
        .returning()
        .all()

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
      return withContactEmails([
        {
          ...row.company,
          address: row.address,
          contact: row.contact,
          bank: row.bank
        }
      ])[0]
    })
  }

  async update(input: UpdateCompanyInput) {
    return await db.transaction((tx) => {
      // Get existing company to check for existing address/contact
      const existing = tx.select().from(company).where(eq(company.id, input.id)).all()
      if (existing.length === 0) throw new Error('Company not found')

      const existingCompany = existing[0]

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
          notes: input.notes ?? existingCompany.notes,
          vat_number: input.vatNumber ?? existingCompany.vat_number,
          ust_number: input.ustNumber ?? existingCompany.ust_number,
          tax_number: input.taxNumber ?? existingCompany.tax_number,
          commercial_register_no:
            input.commercialRegisterNo ?? existingCompany.commercial_register_no,
          register_court: input.registerCourt ?? existingCompany.register_court,
          logo_path: input.logoPath ?? existingCompany.logo_path,
          signature_path: input.signaturePath ?? existingCompany.signature_path,
          ksk_number: input.kskNumber ?? existingCompany.ksk_number,
          is_default_for_invoicing:
            input.isDefaultForInvoicing ?? existingCompany.is_default_for_invoicing,
          invoice_contact_person_id:
            'invoiceContactPersonId' in input
              ? (input.invoiceContactPersonId ?? null)
              : existingCompany.invoice_contact_person_id,
          address_id: addressId,
          contact_id: contactId,
          bank_id: input.bankId ?? existingCompany.bank_id,
          updated_at: sql`datetime('now')`
        })
        .where(eq(company.id, input.id))
        .run()

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
      return withContactEmails([
        {
          ...row.company,
          address: row.address,
          contact: row.contact,
          bank: row.bank
        }
      ])[0]
    })
  }

  async delete(id: number) {
    const result = await db.delete(company).where(eq(company.id, id)).returning()
    return result[0]
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
    return withContactEmails([
      {
        ...row.company,
        address: row.address,
        contact: row.contact,
        bank: row.bank
      }
    ])[0]
  }
}
