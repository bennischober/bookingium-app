import { asc, eq } from 'drizzle-orm'
import { schema } from '../../db/schema'
import type { InvoiceLineItemInput } from '../../api/schemas/invoice.schema'
import { computeInvoiceAmounts } from '../../einvoice/amounts'
import type { Reader, Tx } from '../tx'

export type NormalizedLineItems = ReturnType<typeof normalizeLineItems>

/** Line items with amounts, and the invoice totals (rounded in einvoice/amounts) */
export function normalizeLineItems(
  lineItems: InvoiceLineItemInput[] | undefined,
  fallbackTotalAmount: number | undefined
) {
  const source =
    lineItems && lineItems.length > 0
      ? lineItems
      : [
          {
            description: 'General service fee',
            quantity: 1,
            unit: 'service',
            unitPriceNet: fallbackTotalAmount ?? 0,
            taxRate: 0,
            taxCode: 'other' as const
          }
        ]

  const lines = source.map((item) => ({
    description: item.description,
    quantity: item.quantity ?? 1,
    unit: item.unit ?? 'service',
    unitPriceNet: item.unitPriceNet,
    taxRate: item.taxRate ?? 0,
    taxCode: item.taxCode ?? 'standard'
  }))
  const amounts = computeInvoiceAmounts(lines)

  return {
    items: lines.map((line, index) => ({
      ...line,
      position: index + 1,
      lineNetCents: amounts.lines[index].netCents,
      lineTaxCents: amounts.lines[index].taxCents,
      lineGrossCents: amounts.lines[index].grossCents
    })),
    totals: {
      subtotalNetCents: amounts.netCents,
      subtotalTaxCents: amounts.taxCents,
      totalGrossCents: amounts.grossCents
    }
  }
}

/** Writes normalized line items to an invoice */
export function insertLineItems(tx: Tx, invoiceId: number, items: NormalizedLineItems['items']) {
  for (const item of items) {
    tx.insert(schema.invoice_line_item)
      .values({
        invoice_id: invoiceId,
        position: item.position,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price_net: item.unitPriceNet,
        line_net_cents: item.lineNetCents,
        tax_rate: item.taxRate,
        tax_code: item.taxCode,
        line_tax_cents: item.lineTaxCents,
        line_gross_cents: item.lineGrossCents
      })
      .run()
  }
}

/** An invoice's line items in position order */
export function lineItemsOf(reader: Reader, invoiceId: number) {
  return reader
    .select()
    .from(schema.invoice_line_item)
    .where(eq(schema.invoice_line_item.invoice_id, invoiceId))
    .orderBy(asc(schema.invoice_line_item.position), asc(schema.invoice_line_item.id))
    .all()
}
