import { injectable } from 'tsyringe'
import { desc, eq, like, or, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { CreateDealMemoInput, UpdateDealMemoInput } from '../api/schemas/deal_memo.schema'
import type { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class DealMemoRepository {
  async getAllPaginated(pagination: PaginationInput) {
    const { page, pageSize, search } = pagination
    const offset = (page - 1) * pageSize

    const whereClause = search ? like(schema.deal_memo.name, `%${search}%`) : undefined

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.deal_memo)
      .where(whereClause)

    const total = countResult[0]?.count || 0

    const rows = await db
      .select()
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .where(whereClause)
      .orderBy(schema.deal_memo.date)
      .limit(pageSize)
      .offset(offset)

    const items = rows.map((row) => ({
      ...row.deal_memo,
      band: row.band,
      venue: row.venue
    }))

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  /** Events matching `where`, newest first, with band and venue */
  private async listWhere(where: SQL | undefined) {
    const rows = await db
      .select()
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .where(where)
      .orderBy(desc(schema.deal_memo.date), desc(schema.deal_memo.id))
    return rows.map((row) => ({ ...row.deal_memo, band: row.band, venue: row.venue }))
  }

  /** A band's events, newest first */
  async listByBand(bandId: number) {
    return this.listWhere(eq(schema.deal_memo.band_id, bandId))
  }

  /** Events at a venue, newest first */
  async listByVenue(venueId: number) {
    return this.listWhere(eq(schema.deal_memo.venue_id, venueId))
  }

  /** Events where the company is the local promoter or the invoice company, newest first */
  async listByCompany(companyId: number) {
    return this.listWhere(
      or(
        eq(schema.deal_memo.lopro_company_id, companyId),
        eq(schema.deal_memo.invoice_company_id, companyId)
      )
    )
  }

  async getById(id: number) {
    const rows = await db
      .select()
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .leftJoin(schema.hotel, eq(schema.deal_memo.hotel_id, schema.hotel.id))
      .leftJoin(schema.person, eq(schema.deal_memo.lopro_person_id, schema.person.id))
      .leftJoin(schema.company, eq(schema.deal_memo.lopro_company_id, schema.company.id))
      .where(eq(schema.deal_memo.id, id))

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      ...row.deal_memo,
      band: row.band,
      venue: row.venue,
      hotel: row.hotel,
      loProPerson: row.person,
      loProCompany: row.company
    }
  }

  async create(input: CreateDealMemoInput) {
    const result = await db
      .insert(schema.deal_memo)
      .values({
        name: input.name,
        deal: input.deal ?? '',
        date: input.date,
        band_id: input.bandId,
        venue_id: input.venueId ?? null,
        lopro_person_id: input.loProPersonId ?? null,
        lopro_company_id: input.loProCompanyId ?? null,
        invoice_company_id: input.invoiceCompanyId ?? null,
        representing_company_id: input.representingCompanyId ?? null,
        status: input.status ?? 'pending',
        ticket_price_vvk: input.ticketPriceVvk ?? null,
        ticket_price_ak: input.ticketPriceAk ?? null,
        notes: input.notes ?? '',
        posters: '',
        amount_of_people: 0,
        room_information: '',
        performance_duration: '',
        performance_time: '',
        performance_information: '',
        guarantee_amount: input.guaranteeAmount ?? null,
        guarantee_vat_rate: input.guaranteeVatRate ?? null,
        contract_notes: input.contractNotes ?? ''
      })
      .returning()

    return result[0]
  }

  async update(input: UpdateDealMemoInput) {
    const values: Record<string, unknown> = {
      updated_at: new Date().toISOString()
    }

    if ('name' in input) values.name = input.name
    if ('deal' in input) values.deal = input.deal
    if ('date' in input) values.date = input.date
    if ('bandId' in input) values.band_id = input.bandId
    if ('status' in input) values.status = input.status
    if ('venueId' in input) values.venue_id = input.venueId ?? null
    if ('hotelId' in input) values.hotel_id = input.hotelId ?? null
    if ('loProPersonId' in input) values.lopro_person_id = input.loProPersonId ?? null
    if ('loProCompanyId' in input) values.lopro_company_id = input.loProCompanyId ?? null
    if ('invoiceCompanyId' in input) values.invoice_company_id = input.invoiceCompanyId ?? null
    if ('representingCompanyId' in input)
      values.representing_company_id = input.representingCompanyId ?? null
    if ('ticketPriceVvk' in input) values.ticket_price_vvk = input.ticketPriceVvk ?? null
    if ('ticketPriceAk' in input) values.ticket_price_ak = input.ticketPriceAk ?? null
    if ('notes' in input) values.notes = input.notes
    if ('posters' in input) values.posters = input.posters
    if ('amountOfPeople' in input) values.amount_of_people = input.amountOfPeople ?? null
    if ('roomInformation' in input) values.room_information = input.roomInformation ?? null
    if ('performanceDuration' in input)
      values.performance_duration = input.performanceDuration ?? null
    if ('performanceTime' in input) values.performance_time = input.performanceTime ?? null
    if ('performanceInformation' in input)
      values.performance_information = input.performanceInformation ?? null
    if ('guaranteeAmount' in input) values.guarantee_amount = input.guaranteeAmount ?? null
    if ('guaranteeVatRate' in input) values.guarantee_vat_rate = input.guaranteeVatRate ?? null
    if ('contractNotes' in input) values.contract_notes = input.contractNotes ?? ''

    const result = await db
      .update(schema.deal_memo)
      .set(values)
      .where(eq(schema.deal_memo.id, input.id))
      .returning()

    return result[0]
  }

  async delete(id: number) {
    await db.delete(schema.deal_memo).where(eq(schema.deal_memo.id, id))
  }
}
