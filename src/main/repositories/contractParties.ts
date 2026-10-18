// Contract parties shared by the concert contract and the management
// contract: a company with address, contact and bank as a ContractParty.
import { asc, eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { ContractParty } from '../api/schemas/contract.schema'

type CompanyRow = typeof schema.company.$inferSelect
type ContactRow = typeof schema.contact.$inferSelect
type BankRow = typeof schema.bank.$inferSelect
type AddressRow = typeof schema.address.$inferSelect

export function toParty(
  company: CompanyRow | null,
  contact: ContactRow | null,
  bank: BankRow | null,
  address: AddressRow | null,
  representative: string
): ContractParty | null {
  if (!company) return null
  return {
    id: company.id,
    name: company.name,
    street: address?.street ?? '',
    streetNumber: address?.street_number ?? '',
    zipCode: address?.zip_code ?? '',
    city: address?.city ?? '',
    country: address?.country ?? '',
    email: contact?.email ?? '',
    phone: contact?.phone ?? '',
    vatNumber: company.vat_number,
    ustNumber: company.ust_number,
    taxNumber: company.tax_number,
    kskNumber: company.ksk_number,
    bankName: bank?.bank_name ?? '',
    accountHolder: bank?.account_holder ?? '',
    iban: bank?.iban ?? '',
    bic: bank?.bic ?? '',
    signaturePath: company.signature_path,
    representative
  }
}

/** A company as contract party (with address, contact, bank) plus its logo */
export async function loadCompanyParty(companyId: number, representative = '') {
  const rows = await db
    .select({
      company: schema.company,
      contact: schema.contact,
      bank: schema.bank,
      address: schema.address
    })
    .from(schema.company)
    .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
    .leftJoin(schema.bank, eq(schema.company.bank_id, schema.bank.id))
    .leftJoin(schema.address, eq(schema.company.address_id, schema.address.id))
    .where(eq(schema.company.id, companyId))
    .limit(1)
  const r = rows[0]
  const party = r ? toParty(r.company, r.contact, r.bank, r.address, representative) : null
  return party ? { party, logoPath: r.company.logo_path || null } : null
}

/** The own company marked as default (also the invoicing default) */
export async function defaultOwnCompanyId(): Promise<number | null> {
  const rows = await db
    .select({ id: schema.company.id })
    .from(schema.company)
    .where(eq(schema.company.is_default_for_invoicing, true))
    .orderBy(asc(schema.company.id))
    .limit(1)
  return rows[0]?.id ?? null
}
