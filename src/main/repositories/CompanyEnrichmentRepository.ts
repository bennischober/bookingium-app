import { injectable } from 'tsyringe'
import { eq, isNotNull } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'

// #236: what the app knows of companies, to tell which company an invoice is from and which of
// its fields are still empty

export type CompanyFacts = {
  id: number
  name: string
  vatId: string
  taxNumber: string
  email: string
  phone: string
  iban: string
  bic: string
  street: string
  zipCode: string
  city: string
  /** Domains of the company's and its people's e-mail addresses */
  domains: string[]
}

@injectable()
export class CompanyEnrichmentRepository {
  /** Every company with the fields an invoice can fill */
  companies(): CompanyFacts[] {
    const rows = db
      .select({
        id: schema.company.id,
        name: schema.company.name,
        vatId: schema.company.vat_id,
        taxNumber: schema.company.tax_number,
        email: schema.contact.email,
        phone: schema.contact.phone,
        iban: schema.bank.iban,
        bic: schema.bank.bic,
        street: schema.address.street,
        zipCode: schema.address.zip_code,
        city: schema.address.city
      })
      .from(schema.company)
      .leftJoin(schema.contact, eq(schema.contact.id, schema.company.contact_id))
      .leftJoin(schema.bank, eq(schema.bank.id, schema.company.bank_id))
      .leftJoin(schema.address, eq(schema.address.id, schema.company.address_id))
      .all()
    const memberEmails = db
      .select({ companyId: schema.company_member.company_id, email: schema.contact.email })
      .from(schema.company_member)
      .innerJoin(schema.person, eq(schema.person.id, schema.company_member.person_id))
      .innerJoin(schema.contact, eq(schema.contact.id, schema.person.contact_id))
      .all()
    const domainOf = (email: string | null): string =>
      (email ?? '').trim().toLowerCase().split('@')[1] ?? ''
    const domains = new Map<number, Set<string>>()
    for (const row of memberEmails) {
      const domain = domainOf(row.email)
      if (!domain) continue
      domains.set(row.companyId, (domains.get(row.companyId) ?? new Set()).add(domain))
    }
    return rows.map((row) => {
      const own = domainOf(row.email)
      const set = domains.get(row.id) ?? new Set<string>()
      if (own) set.add(own)
      return {
        id: row.id,
        name: row.name,
        vatId: row.vatId,
        taxNumber: row.taxNumber,
        email: row.email ?? '',
        phone: row.phone ?? '',
        iban: row.iban ?? '',
        bic: row.bic ?? '',
        street: row.street ?? '',
        zipCode: row.zipCode ?? '',
        city: row.city ?? '',
        domains: [...set]
      }
    })
  }

  /**
   * The companies on our side of an invoice - the invoicing companies, the management and the
   * bands' companies: an invoice names them as its recipient, so their data is never the sender's
   */
  ownCompanyIds(): Set<number> {
    const ids = new Set<number>()
    const add = (rows: Array<{ id: number | null }>) => {
      for (const row of rows) if (row.id !== null) ids.add(row.id)
    }
    add(
      db
        .select({ id: schema.company.id })
        .from(schema.company)
        .where(eq(schema.company.is_default_for_invoicing, true))
        .all()
    )
    add(
      db
        .select({ id: schema.company_invoice_settings.company_id })
        .from(schema.company_invoice_settings)
        .all()
    )
    add(
      db
        .select({ id: schema.management_contract.management_company_id })
        .from(schema.management_contract)
        .where(isNotNull(schema.management_contract.management_company_id))
        .all()
    )
    add(db.select({ id: schema.band.company_id }).from(schema.band).all())
    return ids
  }
}
