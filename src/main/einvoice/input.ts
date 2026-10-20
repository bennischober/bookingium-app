import type { InvoicePrintDto } from '../api/schemas/invoice.schema'
import type { EInvoiceInput } from './prepare'

/**
 * The e-invoice input of an invoice's print data: what the PDF shows. A
 * Stornorechnung is stored as a negative copy; as an e-invoice it is a
 * credit note (381) with positive amounts.
 */
export function eInvoiceInputOf(data: InvoicePrintDto): EInvoiceInput {
  const { invoice } = data
  const sign = invoice.kind === 'cancellation' ? -1 : 1
  return {
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    buyerReference: invoice.buyerReference,
    periodStartDate: invoice.periodStartDate,
    periodEndDate: invoice.periodEndDate,
    eventDate: data.eventDate,
    paymentTerms: invoice.paymentTerms,
    taxNote: invoice.reverseChargeNote,
    notes: invoice.notes,
    seller: data.issuer,
    buyer: data.recipient,
    lines: invoice.lineItems.map((line) => ({
      description: line.description,
      quantity: sign * line.quantity,
      unit: line.unit,
      unitPriceNet: line.unitPriceNet,
      taxRate: line.taxRate,
      taxCode: line.taxCode
    })),
    storedTotals: {
      net: sign * invoice.subtotalNetAmount,
      tax: sign * invoice.subtotalTaxAmount,
      gross: sign * invoice.totalGrossAmount
    },
    cancels:
      invoice.kind === 'cancellation'
        ? {
            invoiceNumber: invoice.cancelsInvoiceNumber,
            issueDate: invoice.cancelsInvoiceIssueDate
          }
        : null,
    xrechnung: invoice.xrechnung
  }
}
