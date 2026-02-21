import { injectable } from 'tsyringe'
import { eq, like, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { CreateDealMemoInput, UpdateDealMemoInput } from '../api/schemas/deal_memo.schema'
import type { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class DealMemoRepository {
  async getAllPaginated(pagination: PaginationInput) {
    const { page, pageSize, search } = pagination
    const offset = (page - 1) * pageSize

    const whereClause = search ? like(schema.deal_memo.deal, `%${search}%`) : undefined

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

  async getById(id: number) {
    const rows = await db
      .select()
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .where(eq(schema.deal_memo.id, id))

    if (rows.length === 0) return null

    const row = rows[0]
    return {
      ...row.deal_memo,
      band: row.band,
      venue: row.venue
    }
  }

  async create(input: CreateDealMemoInput) {
    const result = await db
      .insert(schema.deal_memo)
      .values({
        deal: input.deal,
        date: input.date,
        band_id: input.bandId,
        venue_id: input.venueId ?? null,
        lopro_person_id: input.loProPersonId ?? null,
        lopro_company_id: input.loProCompanyId ?? null,
        status: input.status ?? 'pending',
        ticket_price_vvk: input.ticketPriceVvk ?? null,
        ticket_price_ak: input.ticketPriceAk ?? null,
        notes: input.notes ?? '',
        posters: '',
        amount_of_people: 0,
        room_information: '',
        performance_duration: '',
        performance_time: '',
        performance_information: ''
      })
      .returning()

    return result[0]
  }

  async update(input: UpdateDealMemoInput) {
    const result = await db
      .update(schema.deal_memo)
      .set({
        deal: input.deal,
        date: input.date,
        band_id: input.bandId,
        venue_id: input.venueId ?? null,
        lopro_person_id: input.loProPersonId ?? null,
        lopro_company_id: input.loProCompanyId ?? null,
        status: input.status,
        ticket_price_vvk: input.ticketPriceVvk ?? null,
        ticket_price_ak: input.ticketPriceAk ?? null,
        notes: input.notes,
        updated_at: new Date().toISOString()
      })
      .where(eq(schema.deal_memo.id, input.id))
      .returning()

    return result[0]
  }

  async delete(id: number) {
    await db.delete(schema.deal_memo).where(eq(schema.deal_memo.id, id))
  }
}
