import { parseNumber } from '@/lib/invoiceLabels'
import type {
  InvoiceDto,
  InvoiceLineItemInput,
  InvoiceRecipientKind,
  InvoiceStatus,
  InvoiceTaxCode
} from '../../../../main/api/schemas/invoice.schema'
import {
  computeInvoiceAmounts,
  fromCents,
  lineNetCents,
  vatCents
} from '../../../../main/einvoice/amounts'

/**
 * The invoice form's state as plain data, and the rules that turn it into the
 * payload: kept out of the components so they can be tested (#61).
 */

/** One line item as typed: numbers stay strings until the form is saved */
export type InvoiceLineDraft = {
  description: string
  quantity: string
  unit: string
  unitPriceNet: string
  taxRate: string
  taxCode: InvoiceTaxCode
}

// The form only handles drafts: save as draft, or issue (which assigns the
// number and locks the invoice). Later status changes happen on the locked
// invoice (paid, overdue, Storno).
export const INVOICE_FORM_STATUSES: InvoiceStatus[] = ['draft', 'issued']

export const INVOICE_RECIPIENT_KINDS: InvoiceRecipientKind[] = [
  'company',
  'band',
  'person',
  'other'
]

export const RECIPIENT_KIND_LABELS: Record<InvoiceRecipientKind, string> = {
  company: 'Firma',
  band: 'Band',
  person: 'Person',
  other: 'Sonstige'
}

export const EMPTY_LINE: InvoiceLineDraft = {
  description: '',
  quantity: '1',
  unit: 'service',
  unitPriceNet: '0',
  taxRate: '19',
  taxCode: 'standard'
}

/** Who receives the invoice: one id per kind, or a typed name for "Sonstige" */
export type RecipientDraft = {
  kind: InvoiceRecipientKind
  companyId: number | null
  bandId: number | null
  personId: number | null
  nameOverride: string
}

export function initialRecipient(invoice: InvoiceDto | undefined): RecipientDraft {
  return {
    kind: invoice?.recipientKind ?? 'company',
    companyId: invoice?.recipientCompanyId ?? null,
    bandId: invoice?.recipientBandId ?? null,
    personId: invoice?.recipientPersonId ?? null,
    nameOverride: invoice?.recipientKind === 'other' ? invoice.recipientName : ''
  }
}

/** Another kind starts empty: an id of the old kind would point at the wrong record */
export function recipientOfKind(kind: InvoiceRecipientKind): RecipientDraft {
  return { kind, companyId: null, bandId: null, personId: null, nameOverride: '' }
}

/** Why the recipient cannot be saved, or null */
export function recipientError(recipient: RecipientDraft): string | null {
  if (recipient.kind === 'band' && !recipient.bandId) return 'Bitte eine Empfänger-Band auswählen'
  if (recipient.kind === 'person' && !recipient.personId)
    return 'Bitte eine Empfänger-Person auswählen'
  if (recipient.kind === 'other' && !recipient.nameOverride.trim())
    return 'Bitte einen Empfängernamen eingeben'
  return null
}

/** The recipient fields of the create/update payload and the parties preview */
export function recipientPayload(recipient: RecipientDraft) {
  return {
    recipientKind: recipient.kind,
    recipientCompanyId: recipient.companyId,
    recipientBandId: recipient.bandId,
    recipientPersonId: recipient.personId,
    recipientNameOverride: recipient.kind === 'other' ? recipient.nameOverride.trim() : undefined
  }
}

/**
 * The lines an invoice opens with. An invoice stored without lines (older data)
 * shows its total as one line, so saving it keeps the amount.
 */
export function initialLines(invoice: InvoiceDto | undefined): InvoiceLineDraft[] {
  if (!invoice) return [EMPTY_LINE]
  if (invoice.lineItems.length === 0)
    return [
      {
        ...EMPTY_LINE,
        description: 'Leistungsposition',
        unitPriceNet: String(invoice.totalAmount),
        taxRate: '0'
      }
    ]
  return invoice.lineItems.map((line) => ({
    description: line.description,
    quantity: String(line.quantity),
    unit: line.unit,
    unitPriceNet: String(line.unitPriceNet),
    taxRate: String(line.taxRate),
    taxCode: line.taxCode
  }))
}

/** The typed lines as stored: numbers clamped, blanks filled, never an empty list */
export function normalizeLineItems(lines: InvoiceLineDraft[]): InvoiceLineItemInput[] {
  const normalized = lines
    .map((line) => {
      const quantity = Math.max(0.000001, parseNumber(line.quantity, 1))
      const unitPriceNet = Math.max(0, parseNumber(line.unitPriceNet, 0))
      const taxRate = Math.max(0, Math.min(100, parseNumber(line.taxRate, 0)))
      const description = line.description.trim() || 'Leistungsposition'

      return {
        description,
        quantity,
        unit: line.unit.trim() || 'service',
        unitPriceNet,
        taxRate,
        taxCode: line.taxCode
      } as InvoiceLineItemInput
    })
    .filter((line) => line.description || line.unitPriceNet > 0)

  return normalized.length > 0
    ? normalized
    : [
        {
          description: 'Leistungsposition',
          quantity: 1,
          unit: 'service',
          unitPriceNet: 0,
          taxRate: 0,
          taxCode: 'other'
        }
      ]
}

// Same rounding as the stored totals and the e-invoice (einvoice/amounts)
export function computeTotals(lines: InvoiceLineItemInput[]) {
  const amounts = computeInvoiceAmounts(lines)
  return {
    subtotalNetAmount: fromCents(amounts.netCents),
    subtotalTaxAmount: fromCents(amounts.taxCents),
    totalGrossAmount: fromCents(amounts.grossCents)
  }
}

/** One typed line's numbers and amounts, for its card in the list */
export function lineAmounts(line: InvoiceLineDraft) {
  const quantity = parseNumber(line.quantity, 1)
  const unitPrice = parseNumber(line.unitPriceNet, 0)
  const taxRate = parseNumber(line.taxRate, 0)
  const netCents = lineNetCents(quantity, unitPrice)
  return {
    quantity,
    unitPrice,
    taxRate,
    net: fromCents(netCents),
    gross: fromCents(netCents + vatCents(netCents, taxRate))
  }
}

/** Adds the line (`index` null) or replaces the one at `index` */
export function saveLine(
  lines: InvoiceLineDraft[],
  index: number | null,
  line: InvoiceLineDraft
): InvoiceLineDraft[] {
  if (index === null) return [...lines, { ...line }]
  return lines.map((current, i) => (i === index ? { ...line } : current))
}

/** Removes the line; the last one is emptied instead, so the list is never empty */
export function removeLine(lines: InvoiceLineDraft[], index: number): InvoiceLineDraft[] {
  if (lines.length === 1) return [{ ...EMPTY_LINE }]
  return lines.filter((_, i) => i !== index)
}
