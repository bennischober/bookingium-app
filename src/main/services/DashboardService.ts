import { injectable } from 'tsyringe'
import { and, count, eq, gte, isNotNull, lt, lte, ne, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { DashboardStatsDto } from '../api/routers/dashboard.router'

@injectable()
export class DashboardService {
  /**
   * Computes all dashboard statistics in SQL (single IPC round-trip, tiny
   * payload) instead of shipping 500 invoices + full directory tables to the
   * renderer and aggregating there.
   */
  async getStats(): Promise<DashboardStatsDto> {
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const in7Days = new Date(today)
    in7Days.setDate(in7Days.getDate() + 7)
    const in7DaysStr = in7Days.toISOString().slice(0, 10)
    const monthStartStr = todayStr.slice(0, 8) + '01'
    const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    const nextMonthStartStr = nextMonthStart.toISOString().slice(0, 10)

    const [upcoming, pending, thisMonth, openInvoices, overdue, bands, venues, companies, persons] =
      await Promise.all([
        db
          .select({
            id: schema.deal_memo.id,
            name: schema.deal_memo.name,
            date: schema.deal_memo.date,
            status: schema.deal_memo.status,
            bandName: schema.band.name,
            venueName: schema.venue.name
          })
          .from(schema.deal_memo)
          .leftJoin(schema.band, eq(schema.deal_memo.band_id, schema.band.id))
          .leftJoin(schema.venue, eq(schema.deal_memo.venue_id, schema.venue.id))
          .where(
            and(
              gte(schema.deal_memo.date, todayStr),
              lte(schema.deal_memo.date, in7DaysStr),
              ne(schema.deal_memo.status, 'cancelled')
            )
          )
          .orderBy(schema.deal_memo.date)
          .limit(6),
        db
          .select({ n: count() })
          .from(schema.deal_memo)
          .where(eq(schema.deal_memo.status, 'pending')),
        db
          .select({ n: count() })
          .from(schema.deal_memo)
          .where(
            and(
              gte(schema.deal_memo.date, monthStartStr),
              lt(schema.deal_memo.date, nextMonthStartStr)
            )
          ),
        db
          .select({
            n: count(),
            amount: sql<number>`coalesce(sum(${schema.invoice.total_amount}), 0)`
          })
          .from(schema.invoice)
          // Stornorechnungen offset their invoice and are never open
          .where(
            and(
              ne(schema.invoice.status, 'paid'),
              ne(schema.invoice.status, 'cancelled'),
              eq(schema.invoice.kind, 'invoice')
            )
          ),
        db
          .select({ n: count() })
          .from(schema.invoice)
          .where(
            and(
              ne(schema.invoice.status, 'paid'),
              ne(schema.invoice.status, 'cancelled'),
              eq(schema.invoice.kind, 'invoice'),
              isNotNull(schema.invoice.due_date),
              lt(schema.invoice.due_date, todayStr)
            )
          ),
        db.select({ n: count() }).from(schema.band),
        db.select({ n: count() }).from(schema.venue),
        db.select({ n: count() }).from(schema.company),
        db.select({ n: count() }).from(schema.person)
      ])

    return {
      upcomingNext7Days: upcoming.map((event) => ({
        id: event.id,
        name: event.name,
        date: event.date,
        status: event.status ?? 'pending',
        bandName: event.bandName ?? '-',
        venueName: event.venueName
      })),
      pendingEventsCount: pending[0]?.n ?? 0,
      eventsThisMonthCount: thisMonth[0]?.n ?? 0,
      openInvoicesCount: openInvoices[0]?.n ?? 0,
      overdueInvoicesCount: overdue[0]?.n ?? 0,
      openInvoiceAmount: openInvoices[0]?.amount ?? 0,
      directory: {
        bands: bands[0]?.n ?? 0,
        venues: venues[0]?.n ?? 0,
        companies: companies[0]?.n ?? 0,
        persons: persons[0]?.n ?? 0
      }
    }
  }
}
