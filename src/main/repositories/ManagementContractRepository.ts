import { injectable } from 'tsyringe'
import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { UpdateManagementContractInput } from '../api/schemas/management_contract.schema'
import type { ManagementContractPrintData } from '../api/schemas/management_contract.schema'
import { loadCompanyParty } from './contractParties'
import { ManagementContractMapper } from '../api/mappers/management_contract.mapper'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
// Read helpers work on the db and inside transactions alike
type Reader = Pick<Tx, 'select'>
type ContractRow = typeof schema.management_contract.$inferSelect

export type ManagementContractEntity = ContractRow & { memberPersonIds: number[] }

// Terms copied into a band's next contract (renewal with the same terms)
const COPIED_TERMS = [
  'management_company_id',
  'territory',
  'term_years',
  'renewal_years',
  'notice_months',
  'commission_percent',
  'excluded_income',
  'statement_email',
  'settlement_days',
  'payment_days',
  'post_term_year1_percent',
  'post_term_year2_percent',
  'post_term_year3_percent',
  'representative_person_id',
  'special_clauses'
] as const

@injectable()
export class ManagementContractRepository {
  /** A band's contracts, newest (= current) first */
  async listByBand(bandId: number): Promise<ManagementContractEntity[]> {
    const rows = await db
      .select()
      .from(schema.management_contract)
      .where(eq(schema.management_contract.band_id, bandId))
      .orderBy(desc(schema.management_contract.id))
    return this.withMembers(rows)
  }

  async getById(id: number): Promise<ManagementContractEntity | null> {
    const rows = await db
      .select()
      .from(schema.management_contract)
      .where(eq(schema.management_contract.id, id))
      .limit(1)
    return (await this.withMembers(rows))[0] ?? null
  }

  /**
   * New contract for a band: a copy of the band's latest contract (terms,
   * parties, members), or for the first one the draft defaults with the
   * band's management company (else the default own company), its email
   * for statements and all band members.
   */
  async createForBand(bandId: number): Promise<ManagementContractEntity> {
    const id = db.transaction((tx) => {
      const band = tx.select().from(schema.band).where(eq(schema.band.id, bandId)).get()
      if (!band) throw new Error('Band nicht gefunden')

      const latest = tx
        .select()
        .from(schema.management_contract)
        .where(eq(schema.management_contract.band_id, bandId))
        .orderBy(desc(schema.management_contract.id))
        .limit(1)
        .get()

      let values: Partial<ContractRow> = {}
      let memberIds: number[]
      if (latest) {
        for (const key of COPIED_TERMS) (values as Record<string, unknown>)[key] = latest[key]
        memberIds = this.memberIdsTx(tx, [latest.id]).get(latest.id) ?? []
      } else {
        const managementCompanyId = band.management_company_id ?? defaultOwnCompanyIdTx(tx)
        memberIds = tx
          .select({ personId: schema.band_member.person_id })
          .from(schema.band_member)
          .where(eq(schema.band_member.band_id, bandId))
          .orderBy(asc(schema.band_member.id))
          .all()
          .map((row) => row.personId)
        values = {
          management_company_id: managementCompanyId,
          statement_email: managementCompanyId ? companyEmailTx(tx, managementCompanyId) : '',
          representative_person_id: memberIds[0] ?? null
        }
      }

      const created = tx
        .insert(schema.management_contract)
        .values({ ...values, band_id: bandId })
        .returning({ id: schema.management_contract.id })
        .get()
      this.replaceMembersTx(tx, created.id, memberIds)
      return created.id
    })
    return (await this.getById(id)) as ManagementContractEntity
  }

  async update(input: UpdateManagementContractInput): Promise<ManagementContractEntity> {
    const values: Record<string, unknown> = { updated_at: sql`datetime('now')` }
    const fields: Array<[keyof UpdateManagementContractInput, keyof ContractRow]> = [
      ['managementCompanyId', 'management_company_id'],
      ['startDate', 'start_date'],
      ['territory', 'territory'],
      ['termYears', 'term_years'],
      ['renewalYears', 'renewal_years'],
      ['noticeMonths', 'notice_months'],
      ['commissionPercent', 'commission_percent'],
      ['excludedIncome', 'excluded_income'],
      ['statementEmail', 'statement_email'],
      ['settlementDays', 'settlement_days'],
      ['paymentDays', 'payment_days'],
      ['postTermYear1Percent', 'post_term_year1_percent'],
      ['postTermYear2Percent', 'post_term_year2_percent'],
      ['postTermYear3Percent', 'post_term_year3_percent'],
      ['representativePersonId', 'representative_person_id'],
      ['specialClauses', 'special_clauses']
    ]
    for (const [inputKey, column] of fields) {
      if (inputKey in input) values[column] = input[inputKey] ?? null
    }

    db.transaction((tx) => {
      const updated = tx
        .update(schema.management_contract)
        .set(values)
        .where(eq(schema.management_contract.id, input.id))
        .returning({ id: schema.management_contract.id })
        .all()
      if (updated.length === 0) throw new Error('Managementvertrag nicht gefunden')
      if (input.memberPersonIds) this.replaceMembersTx(tx, input.id, input.memberPersonIds)
    })
    return (await this.getById(input.id)) as ManagementContractEntity
  }

  /** Everything the printed contract needs, read live from master data */
  async getPrintData(id: number): Promise<ManagementContractPrintData | null> {
    const contract = await this.getById(id)
    if (!contract) return null
    const band = db.select().from(schema.band).where(eq(schema.band.id, contract.band_id)).get()
    if (!band) return null

    const management = contract.management_company_id
      ? await loadCompanyParty(contract.management_company_id)
      : null
    const artist = await loadCompanyParty(band.company_id)

    const personIds = [
      ...contract.memberPersonIds,
      ...(contract.representative_person_id ? [contract.representative_person_id] : [])
    ]
    const people = personIds.length
      ? db
          .select({ person: schema.person, address: schema.address })
          .from(schema.person)
          .leftJoin(schema.address, eq(schema.person.address_id, schema.address.id))
          .where(inArray(schema.person.id, personIds))
          .all()
      : []
    const toPrintPerson = (personId: number) => {
      const row = people.find((p) => p.person.id === personId)
      if (!row) return null
      return {
        personId,
        name: `${row.person.first_name} ${row.person.last_name}`.trim(),
        street: row.address?.street ?? '',
        streetNumber: row.address?.street_number ?? '',
        zipCode: row.address?.zip_code ?? '',
        city: row.address?.city ?? ''
      }
    }

    return {
      contract: ManagementContractMapper.toDto(contract),
      band: { id: band.id, name: band.name },
      management: management?.party ?? null,
      managementLogoPath: management?.logoPath ?? null,
      artist: artist?.party ?? null,
      // In the order they were ticked; people deleted since are dropped
      members: contract.memberPersonIds.map(toPrintPerson).filter((person) => person !== null),
      representative: contract.representative_person_id
        ? toPrintPerson(contract.representative_person_id)
        : null
    }
  }

  async delete(id: number) {
    await db.delete(schema.management_contract).where(eq(schema.management_contract.id, id))
  }

  private async withMembers(rows: ContractRow[]): Promise<ManagementContractEntity[]> {
    if (rows.length === 0) return []
    const members = this.memberIdsTx(
      db,
      rows.map((row) => row.id)
    )
    return rows.map((row) => ({ ...row, memberPersonIds: members.get(row.id) ?? [] }))
  }

  private memberIdsTx(tx: Reader, contractIds: number[]): Map<number, number[]> {
    const rows = tx
      .select()
      .from(schema.management_contract_member)
      .where(inArray(schema.management_contract_member.contract_id, contractIds))
      .orderBy(asc(schema.management_contract_member.id))
      .all()
    const map = new Map<number, number[]>()
    for (const row of rows) {
      map.set(row.contract_id, [...(map.get(row.contract_id) ?? []), row.person_id])
    }
    return map
  }

  private replaceMembersTx(tx: Tx, contractId: number, personIds: number[]) {
    tx.delete(schema.management_contract_member)
      .where(eq(schema.management_contract_member.contract_id, contractId))
      .run()
    for (const personId of new Set(personIds)) {
      tx.insert(schema.management_contract_member)
        .values({ contract_id: contractId, person_id: personId })
        .run()
    }
  }
}

function defaultOwnCompanyIdTx(tx: Reader): number | null {
  return (
    tx
      .select({ id: schema.company.id })
      .from(schema.company)
      .where(eq(schema.company.is_default_for_invoicing, true))
      .orderBy(asc(schema.company.id))
      .limit(1)
      .get()?.id ?? null
  )
}

function companyEmailTx(tx: Reader, companyId: number): string {
  const row = tx
    .select({ email: schema.contact.email })
    .from(schema.company)
    .leftJoin(schema.contact, eq(schema.company.contact_id, schema.contact.id))
    .where(eq(schema.company.id, companyId))
    .get()
  return row?.email ?? ''
}
