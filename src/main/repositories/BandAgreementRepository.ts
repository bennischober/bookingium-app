import { injectable } from 'tsyringe'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import {
  LabelTerms,
  parseAgreementTerms,
  PublishingTerms,
  type BandAgreementDto,
  type BandAgreementKind,
  type BandAgreementPrintData,
  type CreateBandAgreementInput,
  type UpdateBandAgreementInput
} from '../api/schemas/band_agreement.schema'
import { loadCompanyParty } from './contractParties'

type AgreementRow = typeof schema.band_agreement.$inferSelect

/** A row as the API returns it: the terms parsed for its kind, every missing field at its default */
export function toBandAgreementDto(row: AgreementRow): BandAgreementDto {
  const base = {
    id: row.id,
    bandId: row.band_id,
    companyId: row.company_id,
    startDate: row.start_date,
    specialClauses: row.special_clauses,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  return row.kind === 'label'
    ? { ...base, kind: 'label', terms: parseAgreementTerms('label', row.terms) }
    : { ...base, kind: 'publishing', terms: parseAgreementTerms('publishing', row.terms) }
}

@injectable()
export class BandAgreementRepository {
  /** A band's agreements of every kind, newest first */
  async listByBand(bandId: number): Promise<BandAgreementDto[]> {
    const rows = await db
      .select()
      .from(schema.band_agreement)
      .where(eq(schema.band_agreement.band_id, bandId))
      .orderBy(desc(schema.band_agreement.id))
    return rows.map(toBandAgreementDto)
  }

  async getById(id: number): Promise<BandAgreementDto | null> {
    const row = db
      .select()
      .from(schema.band_agreement)
      .where(eq(schema.band_agreement.id, id))
      .get()
    return row ? toBandAgreementDto(row) : null
  }

  /**
   * New agreement of a kind: a copy of the band's latest one of that kind (counterparty,
   * terms, special agreements; not the start date), else the template's defaults
   */
  async create(input: CreateBandAgreementInput): Promise<BandAgreementDto> {
    const band = db.select().from(schema.band).where(eq(schema.band.id, input.bandId)).get()
    if (!band) throw new Error('Band nicht gefunden')
    const latest = db
      .select()
      .from(schema.band_agreement)
      .where(
        and(
          eq(schema.band_agreement.band_id, input.bandId),
          eq(schema.band_agreement.kind, input.kind)
        )
      )
      .orderBy(desc(schema.band_agreement.id))
      .limit(1)
      .get()
    const created = db
      .insert(schema.band_agreement)
      .values({
        band_id: input.bandId,
        kind: input.kind,
        company_id: latest?.company_id ?? null,
        terms: JSON.stringify(parseAgreementTerms(input.kind, latest?.terms ?? {})),
        special_clauses: latest?.special_clauses ?? ''
      })
      .returning()
      .get()
    return toBandAgreementDto(created)
  }

  async update(input: UpdateBandAgreementInput): Promise<BandAgreementDto> {
    const row = db
      .select()
      .from(schema.band_agreement)
      .where(eq(schema.band_agreement.id, input.id))
      .get()
    if (!row) throw new Error('Vertrag nicht gefunden')

    const values: Partial<AgreementRow> & Record<string, unknown> = {
      updated_at: sql`datetime('now')` as unknown as string
    }
    if ('companyId' in input) values.company_id = input.companyId ?? null
    if ('startDate' in input) values.start_date = input.startDate || null
    if (input.specialClauses !== undefined) values.special_clauses = input.specialClauses
    if (input.terms) {
      // Merged over the stored terms, then checked against the kind's schema
      const kind = row.kind as BandAgreementKind
      const merged = { ...parseAgreementTerms(kind, row.terms), ...input.terms }
      values.terms = JSON.stringify(parseStrict(kind, merged))
    }
    const updated = db
      .update(schema.band_agreement)
      .set(values)
      .where(eq(schema.band_agreement.id, input.id))
      .returning()
      .get()
    return toBandAgreementDto(updated)
  }

  async delete(id: number) {
    await db.delete(schema.band_agreement).where(eq(schema.band_agreement.id, id))
  }

  /** Everything the printed agreement needs, read live from master data */
  async getPrintData(id: number): Promise<BandAgreementPrintData | null> {
    const agreement = await this.getById(id)
    if (!agreement) return null
    const band = db.select().from(schema.band).where(eq(schema.band.id, agreement.bandId)).get()
    if (!band) return null
    const artist = await loadCompanyParty(band.company_id)
    const company = agreement.companyId ? await loadCompanyParty(agreement.companyId) : null
    return {
      agreement,
      band: { id: band.id, name: band.name },
      artist: artist?.party ?? null,
      company: company?.party ?? null,
      companyLogoPath: company?.logoPath ?? null
    }
  }
}

/** Terms that fail their kind's schema are refused, not silently reset to the defaults */
function parseStrict(kind: BandAgreementKind, value: unknown) {
  const result = (kind === 'label' ? LabelTerms : PublishingTerms).safeParse(value)
  if (!result.success) {
    throw new Error(`Ungültige Vertragsangaben: ${result.error.issues[0]?.message ?? ''}`)
  }
  return result.data
}
