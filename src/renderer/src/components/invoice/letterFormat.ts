import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import { fromCents } from '../../../../main/einvoice/amounts'
import { vatGroups } from '../../../../main/invoice/taxSummary'

// The "Geschäftsbrief" invoice template writes amounts as plain numbers ("34,86") under a
// column named after the currency ("Betrag EUR"), like a business letter from accounting
// software. Pure, so the totals block is unit tested.

/** "34,86" - two decimals, German grouping, no currency sign */
export function letterAmount(value: number): string {
  return new Intl.NumberFormat('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
}

/** "19,00 %" */
export function letterRate(rate: number): string {
  return `${letterAmount(rate)} %`
}

export type LetterTotalsLine = { label: string; value: string; kind: 'sum' | 'vat' | 'total' }

/**
 * Summe, one line per VAT group ("19,00 % USt. auf EUR 34,86:"), Endbetrag. A 0 % group
 * without VAT (reverse charge, exempt) gets no line: the tax note under the totals says why.
 */
export function letterTotals(data: InvoicePrintDto): LetterTotalsLine[] {
  const { invoice } = data
  const currency = invoice.currency || 'EUR'
  const vat = vatGroups(data)
    .filter((group) => group.rate > 0)
    .map(
      (group): LetterTotalsLine => ({
        label: `${letterRate(group.rate)} USt. auf ${currency} ${letterAmount(fromCents(group.netCents))}:`,
        value: letterAmount(fromCents(group.taxCents)),
        kind: 'vat'
      })
    )
  return [
    { label: 'Summe:', value: letterAmount(invoice.subtotalNetAmount), kind: 'sum' },
    ...vat,
    { label: 'Endbetrag:', value: letterAmount(invoice.totalGrossAmount), kind: 'total' }
  ]
}

/**
 * The service date line of the info block: "Liefer-/Leistungsdatum" for one day,
 * "Leistungszeitraum" for a period (§ 14 UStG asks for one of them)
 */
export function letterServiceLabel(label: string): string {
  return label === 'Leistungsdatum' ? 'Liefer-/Leistungsdatum' : label
}
