import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { ContractData, ContractParty } from '../api/schemas/contract.schema'

export type { ContractData, ContractParty } from '../api/schemas/contract.schema'

type CompanyRow = typeof schema.company.$inferSelect
type ContactRow = typeof schema.contact.$inferSelect
type BankRow = typeof schema.bank.$inferSelect
type AddressRow = typeof schema.address.$inferSelect

function toParty(
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

@injectable()
export class ContractRepository {
  /**
   * Assembles all data needed to render the engagement contract for a deal
   * memo. Contracts are drafted before an event, so parties are read live
   * from master data (unlike invoices, which freeze snapshots at issue time).
   */
  async getContractData(dealMemoId: number): Promise<ContractData | null> {
    const rows = await db
      .select()
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .leftJoin(schema.hotel, eq(schema.deal_memo.hotel_id, schema.hotel.id))
      .leftJoin(schema.person, eq(schema.deal_memo.lopro_person_id, schema.person.id))
      .where(eq(schema.deal_memo.id, dealMemoId))
      .limit(1)

    if (rows.length === 0) return null

    const row = rows[0]

    // Artist side: the band's company (contract party VP1)
    const artistRows = await db
      .select({
        company: schema.company,
        contact: schema.contact,
        bank: schema.bank,
        address: schema.address
      })
      .from(schema.band)
      .leftJoin(schema.company, eq(schema.band.company_id, schema.company.id))
      .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
      .leftJoin(schema.bank, eq(schema.company.bank_id, schema.bank.id))
      .leftJoin(schema.address, eq(schema.company.address_id, schema.address.id))
      .where(eq(schema.band.id, row.deal_memo.band_id))
      .limit(1)

    // VP1 "vertreten durch": the invoicing company (agency issuing on behalf
    // of the band) - the agency party is returned separately
    let representativeParty: ContractParty | null = null
    if (row.deal_memo.invoice_company_id) {
      const repRows = await db
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
        .where(eq(schema.company.id, row.deal_memo.invoice_company_id))
        .limit(1)

      if (repRows.length > 0) {
        const r = repRows[0]
        representativeParty = toParty(r.company, r.contact, r.bank, r.address, '')
      }
    }

    // Promoter ("oeV"): the deal memo's local promoter company. The
    // representative (lopro person) is fetched separately - it belongs to the
    // deal memo, not to the company.
    let promoter: ContractParty | null = null
    if (row.deal_memo.lopro_company_id) {
      const promoterRows = await db
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
        .where(eq(schema.company.id, row.deal_memo.lopro_company_id))
        .limit(1)

      if (promoterRows.length > 0) {
        const p = promoterRows[0]
        const rep = row.person ? `${row.person.first_name} ${row.person.last_name}`.trim() : ''
        promoter = toParty(p.company, p.contact, p.bank, p.address, rep)
      }
    }

    const a = artistRows[0]
    const artistRepresentative = row.person
      ? `${row.person.first_name} ${row.person.last_name}`
      : ''

    return {
      dealMemo: {        id: row.deal_memo.id,
        name: row.deal_memo.name,
        date: row.deal_memo.date,
        amountOfPeople: row.deal_memo.amount_of_people,
        roomInformation: row.deal_memo.room_information ?? '',
        performanceDuration: row.deal_memo.performance_duration ?? '',
        performanceTime: row.deal_memo.performance_time ?? '',
        performanceInformation: row.deal_memo.performance_information ?? '',
        guaranteeAmount: row.deal_memo.guarantee_amount,
        guaranteeVatRate: row.deal_memo.guarantee_vat_rate,
        contractNotes: row.deal_memo.contract_notes ?? '',
        notes: row.deal_memo.notes ?? '',
        deal: row.deal_memo.deal ?? '',
        posters: row.deal_memo.posters ?? ''
      },
      band: row.band ? { id: row.band.id, name: row.band.name } : null,
      artist: toParty(a.company, a.contact, a.bank, a.address, artistRepresentative),
      artistLogoPath: a.company?.logo_path || null,
      representative: representativeParty,
      promoter,
      technician: await this.resolveTechnician(
        row.deal_memo.band_id,
        row.band?.responsible_person_id ?? null
      ),
      venue: row.venue
        ? {
            id: row.venue.id,
            name: row.venue.name,
            city: row.address?.city ?? '',
            capacity: row.venue.capacity
          }
        : null,
      hotel: row.hotel ? { id: row.hotel.id, name: row.hotel.name } : null
    }
  }

  /**
   * Resolves the Technischer Leiter (TL): explicit band field first, then the
   * first band member whose role contains 'TL', then the first band member
   * (same heuristic as the old repo).
   */
  private async resolveTechnician(bandId: number, responsiblePersonId: number | null) {
    let personRow: typeof schema.person.$inferSelect | null = null

    if (responsiblePersonId) {
      const rows = await db
        .select()
        .from(schema.person)
        .where(eq(schema.person.id, responsiblePersonId))
        .limit(1)
      personRow = rows[0] ?? null
    }

    if (!personRow) {
      const members = await db
        .select({ person: schema.person, role: schema.band_member.role })
        .from(schema.band_member)
        .leftJoin(schema.person, eq(schema.band_member.person_id, schema.person.id))
        .where(eq(schema.band_member.band_id, bandId))

      const tl = members.find((m) => (m.role ?? '').toUpperCase().includes('TL'))
      const fallback = members[0]
      personRow = (tl ?? fallback)?.person ?? null
    }

    if (!personRow) return null

    const contactRows = personRow.contact_id
      ? await db
          .select()
          .from(schema.contact)
          .where(eq(schema.contact.id, personRow.contact_id))
          .limit(1)
      : []

    return {
      firstName: personRow.first_name,
      lastName: personRow.last_name,
      email: contactRows[0]?.email ?? '',
      mobilePhone: contactRows[0]?.mobile_phone ?? '',
      phone: contactRows[0]?.phone ?? ''
    }
  }
}
