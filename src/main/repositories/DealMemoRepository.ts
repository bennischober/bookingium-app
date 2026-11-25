import { injectable } from 'tsyringe'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  isNotNull,
  like,
  lte,
  ne,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import { listOrder, listPage } from './listQuery'
import { notArchived, onlyArchived } from './archiveFilter'
import { withGenres } from './genres'
import { db } from '../db'
import { schema } from '../db/schema'
import { sqlTimestamp } from '../db/timestamps'
import { toCents, toNullableCents } from '../einvoice/amounts'
import type {
  CreateDealMemoInput,
  DealMemoStatus,
  SetDealMemoStatusesInput,
  UpdateDealMemoInput
} from '../api/schemas/deal_memo.schema'
import type { PaginationInput } from '../api/schemas/base.schema'

@injectable()
export class DealMemoRepository {
  async getAllPaginated(pagination: PaginationInput & { tour?: string }) {
    const { search, tour } = pagination
    const { page, pageSize, offset } = listPage(pagination)

    // D3: an archived event is out of the working list; the archive view asks for it
    const whereClause = and(
      notArchived(),
      search
        ? or(like(schema.deal_memo.name, `%${search}%`), like(schema.deal_memo.tour, `%${search}%`))
        : undefined,
      tour !== undefined ? eq(schema.deal_memo.tour, tour) : undefined
    )

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
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .where(whereClause)
      .orderBy(
        ...listOrder(
          pagination,
          {
            name: [schema.deal_memo.name],
            date: [schema.deal_memo.date],
            bandName: [schema.band.name],
            venueName: [schema.venue.name],
            venueCity: [schema.address.city, schema.venue.name],
            status: [schema.deal_memo.status],
            tour: [schema.deal_memo.tour, schema.deal_memo.date]
          },
          { key: 'date', dir: 'asc' },
          schema.deal_memo.id
        )
      )
      .limit(pageSize)
      .offset(offset)

    const items = rows.map((row) => ({
      ...row.deal_memo,
      band: row.band,
      venue: row.venue,
      venueCity: row.address?.city ?? null
    }))

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    }
  }

  /** Events matching `where`, newest first, with band and venue. Archived ones are out. */
  private async listWhere(where: SQL | undefined) {
    const rows = await db
      .select()
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .where(where ? and(notArchived(), where) : notArchived())
      .orderBy(desc(schema.deal_memo.date), desc(schema.deal_memo.id))
    return rows.map((row) => ({
      ...row.deal_memo,
      band: row.band,
      venue: row.venue,
      venueCity: row.address?.city ?? null
    }))
  }

  /** Events from `from` to `to` (yyyy-MM-dd, both included), for the calendar: all of them */
  async listBetween(from: string, to: string) {
    return this.listWhere(and(gte(schema.deal_memo.date, from), lte(schema.deal_memo.date, to)))
  }

  /** The tours events name, sorted; archived events count too (a tour may be over) */
  async listTours(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ tour: schema.deal_memo.tour })
      .from(schema.deal_memo)
      .where(ne(schema.deal_memo.tour, ''))
      .orderBy(asc(schema.deal_memo.tour))
    return rows.map((row) => row.tour)
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

  /** Events where the person is the LoPro contact or the band's TL, newest first */
  async listByPerson(personId: number) {
    return this.listWhere(
      or(
        eq(schema.deal_memo.lopro_person_id, personId),
        eq(schema.band.responsible_person_id, personId)
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
      band: row.band ? withGenres('band', [row.band])[0] : null,
      venue: row.venue,
      hotel: row.hotel,
      loProPerson: row.person,
      loProCompany: row.company,
      deposits: await this.listDeposits(id)
    }
  }

  /** The prepayments ("Vorkasse") of an event, in contract order */
  async listDeposits(dealMemoId: number) {
    return await db
      .select()
      .from(schema.deal_memo_deposit)
      .where(eq(schema.deal_memo_deposit.deal_memo_id, dealMemoId))
      .orderBy(asc(schema.deal_memo_deposit.position))
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
        ticket_price_vvk_cents: toNullableCents(input.ticketPriceVvk ?? null),
        ticket_price_ak_cents: toNullableCents(input.ticketPriceAk ?? null),
        notes: input.notes ?? '',
        tour: input.tour ?? '',
        posters: '',
        amount_of_people: 0,
        room_information: '',
        performance_duration: '',
        performance_time: '',
        performance_information: '',
        guarantee_cents: toNullableCents(input.guaranteeAmount ?? null),
        guarantee_vat_rate: input.guaranteeVatRate ?? null,
        contract_notes: input.contractNotes ?? ''
      })
      .returning()

    return result[0]
  }

  async update(input: UpdateDealMemoInput) {
    const values: Record<string, unknown> = {
      updated_at: sqlTimestamp()
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
    if ('ticketPriceVvk' in input)
      values.ticket_price_vvk_cents = toNullableCents(input.ticketPriceVvk ?? null)
    if ('ticketPriceAk' in input)
      values.ticket_price_ak_cents = toNullableCents(input.ticketPriceAk ?? null)
    if ('notes' in input) values.notes = input.notes
    if ('posters' in input) values.posters = input.posters
    if ('amountOfPeople' in input) values.amount_of_people = input.amountOfPeople ?? null
    if ('roomInformation' in input) values.room_information = input.roomInformation ?? null
    if ('performanceDuration' in input)
      values.performance_duration = input.performanceDuration ?? null
    if ('performanceTime' in input) values.performance_time = input.performanceTime ?? null
    if ('performanceInformation' in input)
      values.performance_information = input.performanceInformation ?? null
    if ('guaranteeAmount' in input)
      values.guarantee_cents = toNullableCents(input.guaranteeAmount ?? null)
    if ('guaranteeVatRate' in input) values.guarantee_vat_rate = input.guaranteeVatRate ?? null
    if ('contractNotes' in input) values.contract_notes = input.contractNotes ?? ''
    if ('contractSentAt' in input) values.contract_sent_at = input.contractSentAt ?? null
    if ('contractReturnedAt' in input)
      values.contract_returned_at = input.contractReturnedAt ?? null
    if ('tour' in input) values.tour = input.tour ?? ''
    if ('radiusKm' in input) values.radius_km = input.radiusKm ?? null
    if ('radiusWeeksBefore' in input) values.radius_weeks_before = input.radiusWeeksBefore ?? null
    if ('radiusWeeksAfter' in input) values.radius_weeks_after = input.radiusWeeksAfter ?? null

    // better-sqlite3 is synchronous: the callback must not be async
    return db.transaction((tx) => {
      const updated = tx
        .update(schema.deal_memo)
        .set(values)
        .where(eq(schema.deal_memo.id, input.id))
        .returning()
        .get()

      // The deposits are a list: an update that names them replaces all of them
      if (updated && input.deposits !== undefined) {
        tx.delete(schema.deal_memo_deposit)
          .where(eq(schema.deal_memo_deposit.deal_memo_id, input.id))
          .run()
        if (input.deposits.length > 0) {
          tx.insert(schema.deal_memo_deposit)
            .values(
              input.deposits.map((deposit, index) => ({
                deal_memo_id: input.id,
                position: index + 1,
                amount_cents: toCents(deposit.amount),
                due_date: deposit.dueDate,
                paid_at: deposit.paidAt ?? null
              }))
            )
            .run()
        }
      }
      return updated
    })
  }

  async delete(id: number) {
    await db.delete(schema.deal_memo).where(eq(schema.deal_memo.id, id))
  }

  /** D3: takes an event out of every working view without destroying anything */
  async archive(id: number) {
    const result = await db
      .update(schema.deal_memo)
      .set({ archived_at: sqlTimestamp() })
      .where(eq(schema.deal_memo.id, id))
      .returning()
    return result[0] ?? null
  }

  /**
   * #200: sets each event's status in one transaction and returns the statuses they had, for
   * the events that exist and actually change (so undoing touches nothing else)
   */
  setStatuses(changes: SetDealMemoStatusesInput['changes']) {
    return db.transaction((tx) => {
      const before: Array<{ id: number; status: DealMemoStatus }> = []
      for (const change of changes) {
        const row = tx
          .select({ status: schema.deal_memo.status })
          .from(schema.deal_memo)
          .where(eq(schema.deal_memo.id, change.id))
          .get()
        if (!row || row.status === change.status) continue
        tx.update(schema.deal_memo)
          .set({ status: change.status, updated_at: sqlTimestamp() })
          .where(eq(schema.deal_memo.id, change.id))
          .run()
        before.push({ id: change.id, status: row.status as DealMemoStatus })
      }
      return before
    })
  }

  /** #200: archives the events not archived yet; returns their ids, for undoing */
  archiveMany(ids: number[]) {
    return db
      .update(schema.deal_memo)
      .set({ archived_at: sqlTimestamp() })
      .where(and(inArray(schema.deal_memo.id, ids), isNull(schema.deal_memo.archived_at)))
      .returning({ id: schema.deal_memo.id })
      .all()
      .map((row) => row.id)
  }

  /** #200: brings the archived ones of these events back; returns their ids */
  restoreMany(ids: number[]) {
    return db
      .update(schema.deal_memo)
      .set({ archived_at: null })
      .where(and(inArray(schema.deal_memo.id, ids), isNotNull(schema.deal_memo.archived_at)))
      .returning({ id: schema.deal_memo.id })
      .all()
      .map((row) => row.id)
  }

  /** D3: brings an archived event back into the working view */
  async restore(id: number) {
    const result = await db
      .update(schema.deal_memo)
      .set({ archived_at: null })
      .where(eq(schema.deal_memo.id, id))
      .returning()
    return result[0] ?? null
  }

  /** D3: the archive view - archived events only, newest archived first */
  async listArchived() {
    const rows = await db
      .select()
      .from(schema.deal_memo)
      .leftJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
      .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
      .leftJoin(schema.address, eq(schema.venue.address_id, schema.address.id))
      .where(onlyArchived())
      .orderBy(desc(schema.deal_memo.archived_at), desc(schema.deal_memo.id))
    return rows.map((row) => ({
      ...row.deal_memo,
      band: row.band,
      venue: row.venue,
      venueCity: row.address?.city ?? null
    }))
  }

  /** D3: whether an invoice still points at this event, which blocks a hard delete */
  async hasLinkedInvoice(id: number): Promise<boolean> {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.invoice)
      .where(eq(schema.invoice.deal_memo_id, id))
    return (rows[0]?.count ?? 0) > 0
  }
}
