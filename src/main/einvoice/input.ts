import type { InvoicePrintDto } from '../api/schemas/invoice.schema'
import type { EInvoiceInput } from './prepare'

/** The e-invoice input of an invoice's print data: what the PDF shows */
export function eInvoiceInputOf(data: InvoicePrintDto): EInvoiceInput {
  const { invoice } = data
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
      quantity: line.quantity,
      unit: line.unit,
      unitPriceNet: line.unitPriceNet,
      taxRate: line.taxRate,
      taxCode: line.taxCode
    })),
    storedTotals: {
      net: invoice.subtotalNetAmount,
      tax: invoice.subtotalTaxAmount,
      gross: invoice.totalGrossAmount
    }
  }
}
