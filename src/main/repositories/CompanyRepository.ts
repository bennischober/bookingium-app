import { injectable } from 'tsyringe'
import { eq, like, or, sql } from 'drizzle-orm'
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

    return rows.map((row) => ({
      ...row.company,
      address: row.address,
      contact: row.contact,
      bank: row.bank
    }))
  }

  async getAllPaginated(pagination: PaginationInput) {
    const { page, pageSize, search } = pagination
    const offset = (page - 1) * pageSize

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
      .limit(pageSize)
      .offset(offset)

    const items = rows.map((row) => ({
      ...row.company,
      address: row.address,
      contact: row.contact,
      bank: row.bank
    }))

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
    return {
      ...row.company,
      address: row.address,
      contact: row.contact,
      bank: row.bank
    }
  }

  async create(input: CreateCompanyInput) {
    return await db.transaction(async (tx) => {
      if (input.isDefaultForInvoicing) {
        await tx.update(company).set({ is_default_for_invoicing: false })
      }

      // Create address if provided
      let addressId: number | null = null
      if (input.address) {
        const addressResult = await tx
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
        addressId = addressResult[0].id
      }

      // Create contact if provided
      let contactId: number | null = null
      if (input.contact) {
        const contactResult = await tx
          .insert(contact)
          .values({
            email: input.contact.email,
            phone: input.contact.phone,
            mobile_phone: input.contact.mobilePhone,
            homepage: input.contact.homepage
          })
          .returning()
        contactId = contactResult[0].id
      }

      // Create company
      const companyResult = await tx
        .insert(company)
        .values({
          name: input.name,
          notes: input.notes || '',
          vat_number: input.vatNumber || '',
          ust_number: input.ustNumber || '',
          is_default_for_invoicing: input.isDefaultForInvoicing,
          address_id: addressId,
          contact_id: contactId,
          bank_id: input.bankId || null
        })
        .returning()

      // Fetch with relations
      const created = await tx
        .select()
        .from(company)
        .leftJoin(address, eq(company.address_id, address.id))
        .leftJoin(contact, eq(company.contact_id, contact.id))
        .leftJoin(bank, eq(company.bank_id, bank.id))
        .where(eq(company.id, companyResult[0].id))

      const row = created[0]
      return {
        ...row.company,
        address: row.address,
        contact: row.contact,
        bank: row.bank
      }
    })
  }

  async update(input: UpdateCompanyInput) {
    return await db.transaction(async (tx) => {
      // Get existing company to check for existing address/contact
      const existing = await tx.select().from(company).where(eq(company.id, input.id))
      if (existing.length === 0) throw new Error('Company not found')

      const existingCompany = existing[0]

      if (input.isDefaultForInvoicing) {
        await tx.update(company).set({ is_default_for_invoicing: false })
      }

      // Update or create address
      let addressId = existingCompany.address_id
      if (input.address) {
        if (addressId) {
          // Update existing address
          await tx
            .update(address)
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
        } else {
          // Create new address
          const addressResult = await tx
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
          addressId = addressResult[0].id
        }
      }

      // Update or create contact
      let contactId = existingCompany.contact_id
      if (input.contact) {
        if (contactId) {
          // Update existing contact
          await tx
            .update(contact)
            .set({
              email: input.contact.email,
              phone: input.contact.phone,
              mobile_phone: input.contact.mobilePhone,
              homepage: input.contact.homepage
            })
            .where(eq(contact.id, contactId))
        } else {
          // Create new contact
          const contactResult = await tx
            .insert(contact)
            .values({
              email: input.contact.email,
              phone: input.contact.phone,
              mobile_phone: input.contact.mobilePhone,
              homepage: input.contact.homepage
            })
            .returning()
          contactId = contactResult[0].id
        }
      }

      // Update company
      await tx
        .update(company)
        .set({
          name: input.name || existingCompany.name,
          notes: input.notes || existingCompany.notes,
          vat_number: input.vatNumber || existingCompany.vat_number,
          ust_number: input.ustNumber || existingCompany.ust_number,
          is_default_for_invoicing:
            input.isDefaultForInvoicing !== undefined
              ? input.isDefaultForInvoicing
              : existingCompany.is_default_for_invoicing,
          address_id: addressId,
          contact_id: contactId,
          bank_id: input.bankId !== undefined ? input.bankId : existingCompany.bank_id,
          updated_at: sql`datetime('now')`
        })
        .where(eq(company.id, input.id))

      // Fetch with relations
      const updated = await tx
        .select()
        .from(company)
        .leftJoin(address, eq(company.address_id, address.id))
        .leftJoin(contact, eq(company.contact_id, contact.id))
        .leftJoin(bank, eq(company.bank_id, bank.id))
        .where(eq(company.id, input.id))

      const row = updated[0]
      return {
        ...row.company,
        address: row.address,
        contact: row.contact,
        bank: row.bank
      }
    })
  }

  async delete(id: number) {
    const result = await db.delete(company).where(eq(company.id, id)).returning()
    return result[0]
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
    return {
      ...row.company,
      address: row.address,
      contact: row.contact,
      bank: row.bank
    }
  }
}
