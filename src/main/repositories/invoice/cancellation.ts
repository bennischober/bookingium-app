import { schema } from '../../db/schema'
import type { Tx } from '../tx'
import { logStatusTx } from './history'
import { lineItemsOf } from './lineItems'
import { claimDatevInvoiceNumber, takeNextInvoiceNumber } from './numbering'

type InvoiceRow = typeof schema.invoice.$inferSelect

/** "2026-10-16" -> "16.10.2026" */
function germanDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}.${month}.${year}`
}

/**
 * The Stornorechnung of a cancelled invoice: its own next number, the
 * same (frozen) parties and lines with negated quantities and amounts, so
 * the two add up to zero. Issued right away; it never changes.
 *
 * An invoice written in DATEV is cancelled in DATEV as well: its Stornorechnung takes the
 * number DATEV gave the Storno and, like the original, is not handed over to DATEV again.
 */
export function createCancellationTx(
  tx: Tx,
  original: InvoiceRow,
  datevCancellationNumber?: number
) {
  const lines = lineItemsOf(tx, original.id)
  const today = new Date().toISOString().slice(0, 10)
  const inDatev = original.created_in_datev
  if (inDatev && !datevCancellationNumber) {
    throw new Error('Bitte die Nummer der Stornorechnung aus DATEV eintragen.')
  }

  const [created] = tx
    .insert(schema.invoice)
    .values({
      invoice_number: inDatev
        ? claimDatevInvoiceNumber(tx, original.company_id, datevCancellationNumber as number)
        : takeNextInvoiceNumber(tx, original.company_id, today),
      company_id: original.company_id,
      issuer_snapshot_id: original.issuer_snapshot_id,
      recipient_snapshot_id: original.recipient_snapshot_id,
      deal_memo_id: original.deal_memo_id,
      period_start_date: original.period_start_date,
      period_end_date: original.period_end_date,
      period_label: original.period_label,
      issue_date: today,
      due_date: null,
      status: 'issued',
      currency: original.currency,
      subtotal_net_cents: -original.subtotal_net_cents,
      subtotal_tax_cents: -original.subtotal_tax_cents,
      total_gross_cents: -original.total_gross_cents,
      payment_terms: `Storno der Rechnung Nr. ${original.invoice_number} vom ${germanDate(original.issue_date)}`,
      reverse_charge_note: original.reverse_charge_note,
      buyer_reference: original.buyer_reference,
      xrechnung: original.xrechnung,
      kind: 'cancellation',
      cancels_invoice_id: original.id,
      created_in_datev: inDatev,
      notes: ''
    })
    .returning()
    .all()
  logStatusTx(tx, created.id, 'issued')

  for (const line of lines) {
    tx.insert(schema.invoice_line_item)
      .values({
        invoice_id: created.id,
        position: line.position,
        description: line.description,
        quantity: -line.quantity,
        unit: line.unit,
        unit_price_net: line.unit_price_net,
        line_net_cents: -line.line_net_cents,
        tax_rate: line.tax_rate,
        tax_code: line.tax_code,
        line_tax_cents: -line.line_tax_cents,
        line_gross_cents: -line.line_gross_cents
      })
      .run()
  }
  return created
}
