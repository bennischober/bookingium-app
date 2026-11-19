import { injectable, inject } from 'tsyringe'
import { and, asc, eq, gte, isNotNull, isNull, lt, lte, ne, notExists, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import { notArchived } from '../repositories/archiveFilter'
import { fromCents } from '../einvoice/amounts'
import { SettingsService } from './SettingsService'
import type { OpenItemDto } from '../api/schemas/open_items.schema'

/** The local calendar day as 2026-10-21 */
export function localIsoDate(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number)
  return localIsoDate(new Date(year, month - 1, day + days))
}

type EventRow = { eventId: number; eventName: string; eventDate: string; bandName: string | null }

const ORDER: Record<OpenItemDto['kind'], number> = {
  contract: 0,
  deposit: 1,
  invoice: 2,
  hotel: 3,
  advancing: 4,
  tickets: 5
}

/** #235: advancing is due this many days before a show */
export const ADVANCING_DAYS = 21
/** #235: a quota's sales report is old after this many days */
export const TICKET_REPORT_DAYS = 14

/**
 * #201: the "Offene Punkte" of the dashboard and of each event page, computed from the data
 * the app already holds. An event counts until its final invoice is paid: an event with a paid
 * invoice, a cancelled and an archived event have no open points.
 *
 * - contract: sent, but not back signed
 * - deposit: unpaid and due (a deposit without a due date is due once the contract is back)
 * - invoice: a confirmed show is over and no invoice for it has been issued
 * - hotel: a confirmed show within the next `openItemsHotelDays` days has no hotel
 *
 * Follow-ups (Wiedervorlagen) are open points too; the renderer takes them from followUp.listOpen.
 */
@injectable()
export class OpenItemsService {
  constructor(@inject(SettingsService) private settings: SettingsService) {}

  async list(eventId?: number, today: string = localIsoDate()): Promise<OpenItemDto[]> {
    const memo = schema.deal_memo
    const invoice = schema.invoice
    const hotelHorizon = addDays(today, this.settings.get().openItemsHotelDays)

    const paidInvoice = db
      .select({ one: sql`1` })
      .from(invoice)
      .where(
        and(
          eq(invoice.deal_memo_id, memo.id),
          eq(invoice.kind, 'invoice'),
          eq(invoice.status, 'paid')
        )
      )
    const working = and(
      notArchived(),
      ne(memo.status, 'cancelled'),
      notExists(paidInvoice),
      eventId === undefined ? undefined : eq(memo.id, eventId)
    )
    const base = {
      eventId: memo.id,
      eventName: memo.name,
      eventDate: memo.date,
      bandName: schema.band.name
    }

    const advancingHorizon = addDays(today, ADVANCING_DAYS)
    const reportCutoff = addDays(today, -TICKET_REPORT_DAYS)
    const lastReport = sql<
      string | null
    >`(select max(${schema.ticket_report.report_date}) from ${schema.ticket_report} where ${schema.ticket_report.deal_memo_id} = ${memo.id})`

    const [contracts, deposits, shows, hotels, advancing, tickets] = await Promise.all([
      db
        .select({ ...base, date: memo.contract_sent_at })
        .from(memo)
        .leftJoin(schema.band, eq(memo.band_id, schema.band.id))
        .where(and(working, isNotNull(memo.contract_sent_at), isNull(memo.contract_returned_at))),
      db
        .select({
          ...base,
          date: sql<string>`coalesce(${schema.deal_memo_deposit.due_date}, ${memo.contract_returned_at})`,
          position: schema.deal_memo_deposit.position,
          amountCents: schema.deal_memo_deposit.amount_cents
        })
        .from(schema.deal_memo_deposit)
        .innerJoin(memo, eq(schema.deal_memo_deposit.deal_memo_id, memo.id))
        .leftJoin(schema.band, eq(memo.band_id, schema.band.id))
        .where(
          and(
            working,
            isNull(schema.deal_memo_deposit.paid_at),
            sql`coalesce(${schema.deal_memo_deposit.due_date}, ${memo.contract_returned_at}) <= ${today}`
          )
        )
        .orderBy(asc(schema.deal_memo_deposit.position)),
      db
        .select({
          ...base,
          issued: sql<number>`(select count(*) from ${invoice} where ${invoice.deal_memo_id} = ${memo.id}
            and ${invoice.kind} = 'invoice' and ${invoice.status} in ('issued', 'overdue', 'paid'))`,
          drafts: sql<number>`(select count(*) from ${invoice} where ${invoice.deal_memo_id} = ${memo.id}
            and ${invoice.kind} = 'invoice' and ${invoice.status} = 'draft')`
        })
        .from(memo)
        .leftJoin(schema.band, eq(memo.band_id, schema.band.id))
        .where(and(working, eq(memo.status, 'confirmed'), lt(memo.date, today))),
      db
        .select(base)
        .from(memo)
        .leftJoin(schema.band, eq(memo.band_id, schema.band.id))
        .where(
          and(
            working,
            eq(memo.status, 'confirmed'),
            isNull(memo.hotel_id),
            gte(memo.date, today),
            lte(memo.date, hotelHorizon)
          )
        ),
      db
        .select({
          ...base,
          status: schema.event_advancing.status,
          since: schema.event_advancing.status_date
        })
        .from(memo)
        .leftJoin(schema.band, eq(memo.band_id, schema.band.id))
        .leftJoin(schema.event_advancing, eq(schema.event_advancing.deal_memo_id, memo.id))
        .where(
          and(
            working,
            eq(memo.status, 'confirmed'),
            gte(memo.date, today),
            lte(memo.date, advancingHorizon),
            sql`coalesce(${schema.event_advancing.status}, 'open') <> 'done'`
          )
        ),
      db
        .select({ ...base, lastReport })
        .from(memo)
        .innerJoin(schema.event_ticket_quota, eq(schema.event_ticket_quota.deal_memo_id, memo.id))
        .leftJoin(schema.band, eq(memo.band_id, schema.band.id))
        .where(
          and(
            working,
            ne(memo.status, 'cancelled'),
            gte(memo.date, today),
            isNotNull(schema.event_ticket_quota.quota),
            sql`coalesce(${lastReport}, '') < ${reportCutoff}`
          )
        )
    ])

    const item = (
      kind: OpenItemDto['kind'],
      row: EventRow,
      date: string,
      extra: Partial<OpenItemDto> = {}
    ): OpenItemDto => ({
      kind,
      eventId: row.eventId,
      eventName: row.eventName,
      eventDate: row.eventDate,
      bandName: row.bandName,
      date,
      depositPosition: null,
      depositAmount: null,
      hasDraftInvoice: false,
      advancingStatus: null,
      advancingSince: null,
      lastReportAt: null,
      ...extra
    })

    const items: OpenItemDto[] = [
      ...contracts.map((row) => item('contract', row, row.date ?? row.eventDate)),
      ...deposits.map((row) =>
        item('deposit', row, row.date, {
          depositPosition: row.position,
          depositAmount: fromCents(row.amountCents)
        })
      ),
      ...shows
        .filter((row) => Number(row.issued) === 0)
        .map((row) =>
          item('invoice', row, row.eventDate, { hasDraftInvoice: Number(row.drafts) > 0 })
        ),
      ...hotels.map((row) => item('hotel', row, row.eventDate)),
      ...advancing.map((row) =>
        item('advancing', row, row.eventDate, {
          advancingStatus: row.status ?? 'open',
          advancingSince: row.since ?? null
        })
      ),
      ...tickets.map((row) =>
        item('tickets', row, row.lastReport ?? row.eventDate, { lastReportAt: row.lastReport })
      )
    ]

    // Oldest first: what has waited longest comes first; then by kind, then event
    return items.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || ORDER[a.kind] - ORDER[b.kind] || a.eventId - b.eventId
    )
  }
}
