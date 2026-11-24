import { injectable } from 'tsyringe'
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { db } from '../db'
import { schema } from '../db/schema'
import type { MarketingActionFields, MarketingActionScope } from '../api/schemas/marketing.schema'

const action = schema.marketing_action

/**
 * Maßnahmen of a band (radio spots, posters, ads …): what is actually booked, as opposed to the
 * atlas, which is the research. A measure may name the show it is for (its tour follows), the
 * partner company and the atlas entry it comes from; cost, receipt and the invoice that passes
 * the cost on hang on it too.
 */
@injectable()
export class MarketingActionRepository {
  list(scope: MarketingActionScope) {
    const conditions: SQL[] = []
    if (scope.bandId !== undefined) conditions.push(eq(action.band_id, scope.bandId))
    if (scope.dealMemoId !== undefined) conditions.push(eq(action.deal_memo_id, scope.dealMemoId))
    if (scope.companyId !== undefined) conditions.push(eq(action.company_id, scope.companyId))
    return db
      .select({
        action,
        bandName: schema.band.name,
        showName: schema.deal_memo.name,
        showDate: schema.deal_memo.date,
        venueName: schema.venue.name,
        companyName: schema.company.name,
        itemName: schema.marketing_item.name,
        receiptName: schema.receipt.file_name,
        invoiceNumber: schema.invoice.invoice_number
      })
      .from(action)
      .innerJoin(schema.band, eq(schema.band.id, action.band_id))
      .leftJoin(schema.deal_memo, eq(schema.deal_memo.id, action.deal_memo_id))
      .leftJoin(schema.venue, eq(schema.venue.id, schema.deal_memo.venue_id))
      .leftJoin(schema.company, eq(schema.company.id, action.company_id))
      .leftJoin(schema.marketing_item, eq(schema.marketing_item.id, action.marketing_item_id))
      .leftJoin(schema.receipt, eq(schema.receipt.id, action.receipt_id))
      .leftJoin(schema.invoice, eq(schema.invoice.id, action.invoice_id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        desc(sql`coalesce(${action.start_date}, ${schema.deal_memo.date}, ${action.created_at})`),
        desc(action.id)
      )
      .all()
  }

  getById(id: number) {
    return db.select().from(action).where(eq(action.id, id)).get()
  }

  /** The measures of these atlas entries, for the atlas rows */
  forItems(itemIds: number[]) {
    if (itemIds.length === 0) return []
    return db
      .select({ itemId: action.marketing_item_id, status: action.status })
      .from(action)
      .where(inArray(action.marketing_item_id, itemIds))
      .all()
  }

  private columns(fields: MarketingActionFields) {
    // a show sets the tour unless one is typed
    const tour =
      fields.tour ||
      (fields.dealMemoId !== null
        ? (db
            .select({ tour: schema.deal_memo.tour })
            .from(schema.deal_memo)
            .where(eq(schema.deal_memo.id, fields.dealMemoId))
            .get()?.tour ?? '')
        : '')
    return {
      band_id: fields.bandId,
      kind: fields.kind,
      title: fields.title,
      status: fields.status,
      deal_memo_id: fields.dealMemoId,
      tour,
      release: fields.release,
      company_id: fields.companyId,
      marketing_item_id: fields.marketingItemId,
      start_date: fields.startDate,
      end_date: fields.endDate,
      region: fields.region,
      cost_cents: fields.costCents,
      payer: fields.payer,
      receipt_id: fields.receiptId,
      notes: fields.notes
    }
  }

  create(fields: MarketingActionFields): number {
    this.pickItem(fields.marketingItemId)
    return db.insert(action).values(this.columns(fields)).returning({ id: action.id }).get().id
  }

  update(id: number, fields: MarketingActionFields): void {
    const changed = db
      .update(action)
      .set({ ...this.columns(fields), updated_at: sql`datetime('now')` })
      .where(eq(action.id, id))
      .run().changes
    if (changed === 0) throw new Error('Diese Maßnahme gibt es nicht mehr.')
    this.pickItem(fields.marketingItemId)
  }

  /** An atlas entry a measure is booked for belongs on the working list */
  private pickItem(itemId: number | null | undefined): void {
    if (!itemId) return
    db.update(schema.marketing_item)
      .set({ picked: true, updated_at: sql`datetime('now')` })
      .where(and(eq(schema.marketing_item.id, itemId), eq(schema.marketing_item.picked, false)))
      .run()
  }

  delete(id: number): void {
    db.delete(action).where(eq(action.id, id)).run()
  }

  setInvoice(id: number, invoiceId: number): void {
    db.update(action)
      .set({ invoice_id: invoiceId, updated_at: sql`datetime('now')` })
      .where(eq(action.id, id))
      .run()
  }
}
