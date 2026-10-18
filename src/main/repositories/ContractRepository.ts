import { injectable } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { ContractData } from '../api/schemas/contract.schema'
import { defaultOwnCompanyId, loadCompanyParty } from './contractParties'

export type { ContractData, ContractParty } from '../api/schemas/contract.schema'

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
    const artist = row.band ? await loadCompanyParty(row.band.company_id) : null

    // VP1 "vertreten durch": the management/agency acting for the band.
    // Event override first, then the band's management company, then the
    // default own company. A band represented by its own company has none.
    const representingCompanyId =
      row.deal_memo.representing_company_id ??
      row.band?.management_company_id ??
      (await defaultOwnCompanyId())
    const representative =
      representingCompanyId !== null && representingCompanyId !== row.band?.company_id
        ? await loadCompanyParty(representingCompanyId)
        : null

    // Promoter ("oeV"): the deal memo's local promoter company. The
    // representative (lopro person) belongs to the deal memo, not the company.
    const promoterRepresentative = row.person
      ? `${row.person.first_name} ${row.person.last_name}`.trim()
      : ''
    const promoter = row.deal_memo.lopro_company_id
      ? await loadCompanyParty(row.deal_memo.lopro_company_id, promoterRepresentative)
      : null

    // Resolve the technician first: the artist-side representative is the TL
    // (the person signing for the band company when no agency is involved)
    const technician = await this.resolveTechnician(
      row.deal_memo.band_id,
      row.band?.responsible_person_id ?? null
    )
    const artistRepresentative = technician ? `${technician.firstName} ${technician.lastName}` : ''

    return {
      dealMemo: {
        id: row.deal_memo.id,
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
      artist: artist ? { ...artist.party, representative: artistRepresentative } : null,
      // The issuing side's letterhead: the representing company, else the band's
      letterheadLogoPath: representative?.logoPath || artist?.logoPath || null,
      representative: representative?.party ?? null,
      promoter: promoter?.party ?? null,
      technician,
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
