import { injectable } from 'tsyringe'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'

// #225 step 2: business trips and the receipts that belong to them

type TripInsert = typeof schema.trip.$inferInsert

@injectable()
export class TripRepository {
  list() {
    return db
      .select({ trip: schema.trip, companyName: schema.company.name })
      .from(schema.trip)
      .leftJoin(schema.company, eq(schema.company.id, schema.trip.company_id))
      .orderBy(desc(schema.trip.start_at), desc(schema.trip.id))
      .all()
  }

  getById(id: number) {
    return db
      .select({ trip: schema.trip, companyName: schema.company.name })
      .from(schema.trip)
      .leftJoin(schema.company, eq(schema.company.id, schema.trip.company_id))
      .where(eq(schema.trip.id, id))
      .get()
  }

  create(values: TripInsert): number {
    return db.insert(schema.trip).values(values).returning({ id: schema.trip.id }).get().id
  }

  update(id: number, values: Partial<TripInsert>): void {
    db.update(schema.trip)
      .set({ ...values, updated_at: sql`datetime('now')` })
      .where(eq(schema.trip.id, id))
      .run()
  }

  /** The receipts go back to the list on their own (trip_id set null); a report stays a receipt */
  delete(id: number): void {
    db.transaction((tx) => {
      tx.update(schema.receipt)
        .set({ trip_report: false })
        .where(and(eq(schema.receipt.trip_id, id), eq(schema.receipt.trip_report, true)))
        .run()
      tx.delete(schema.trip).where(eq(schema.trip.id, id)).run()
    })
  }

  /** The trip's receipts (not its report), by date */
  receipts(tripId: number) {
    return db
      .select({ receipt: schema.receipt, supplierCompanyName: schema.company.name })
      .from(schema.receipt)
      .leftJoin(schema.company, eq(schema.company.id, schema.receipt.supplier_company_id))
      .where(and(eq(schema.receipt.trip_id, tripId), eq(schema.receipt.trip_report, false)))
      .orderBy(schema.receipt.receipt_date, schema.receipt.id)
      .all()
  }

  /** The trip's generated report, with whether it went to DATEV */
  report(tripId: number) {
    return db
      .select({
        receipt: schema.receipt,
        sent: sql<number>`EXISTS (SELECT 1 FROM ${schema.datev_transfer}
          WHERE ${schema.datev_transfer.receipt_id} = ${schema.receipt.id}
          AND ${schema.datev_transfer.status} = 'sent')`,
        any: sql<number>`EXISTS (SELECT 1 FROM ${schema.datev_transfer}
          WHERE ${schema.datev_transfer.receipt_id} = ${schema.receipt.id})`
      })
      .from(schema.receipt)
      .where(and(eq(schema.receipt.trip_id, tripId), eq(schema.receipt.trip_report, true)))
      .orderBy(desc(schema.receipt.id))
      .get()
  }

  /** Receipts that belong to no trip, for "Beleg zuordnen" */
  unassignedReceipts() {
    return db
      .select({ receipt: schema.receipt, supplierCompanyName: schema.company.name })
      .from(schema.receipt)
      .leftJoin(schema.company, eq(schema.company.id, schema.receipt.supplier_company_id))
      .where(isNull(schema.receipt.trip_id))
      .orderBy(desc(schema.receipt.receipt_date), desc(schema.receipt.id))
      .limit(200)
      .all()
  }

  assignReceipt(receiptId: number, tripId: number | null): void {
    db.update(schema.receipt)
      .set({ trip_id: tripId, updated_at: sql`datetime('now')` })
      .where(and(eq(schema.receipt.id, receiptId), eq(schema.receipt.trip_report, false)))
      .run()
  }

  markReport(receiptId: number, tripId: number): void {
    db.update(schema.receipt)
      .set({ trip_id: tripId, trip_report: true })
      .where(eq(schema.receipt.id, receiptId))
      .run()
  }
}
