import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import { fromCents } from '../../../../main/einvoice/amounts'
import { vatGroups, type Lang } from '../../../../main/invoice/taxSummary'

// The "Geschäftsbrief" invoice template writes amounts as plain numbers ("34,86") under a
// column named after the currency ("Betrag EUR"), like a business letter from accounting
// software. Pure, so the totals block is unit tested.

const NUMBER_LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' }

/** "34,86" (German) / "34.86" (English) - two decimals, no currency sign */
export function letterAmount(value: number, lang: Lang = 'de'): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[lang], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value)
}

/** "19,00 %" (German) / "19.00%" (English) */
export function letterRate(rate: number, lang: Lang = 'de'): string {
  return lang === 'en' ? `${letterAmount(rate, lang)}%` : `${letterAmount(rate)} %`
}

export type LetterTotalsLine = { label: string; value: string; kind: 'sum' | 'vat' | 'total' }

const TOTALS_LABELS: Record<Lang, { sum: string; vat: string; total: string }> = {
  de: { sum: 'Summe:', vat: 'USt. auf', total: 'Endbetrag:' },
  en: { sum: 'Subtotal:', vat: 'VAT on', total: 'Total amount:' }
}

/**
 * Summe, one line per VAT group ("19,00 % USt. auf EUR 34,86:"), Endbetrag. A 0 % group
 * without VAT (reverse charge, exempt) gets no line: the tax note under the totals says why.
 */
export function letterTotals(data: InvoicePrintDto, lang: Lang = 'de'): LetterTotalsLine[] {
  const { invoice } = data
  const currency = invoice.currency || 'EUR'
  const L = TOTALS_LABELS[lang]
  const vat = vatGroups(data)
    .filter((group) => group.rate > 0)
    .map(
      (group): LetterTotalsLine => ({
        label: `${letterRate(group.rate, lang)} ${L.vat} ${currency} ${letterAmount(fromCents(group.netCents), lang)}:`,
        value: letterAmount(fromCents(group.taxCents), lang),
        kind: 'vat'
      })
    )
  return [
    { label: L.sum, value: letterAmount(invoice.subtotalNetAmount, lang), kind: 'sum' },
    ...vat,
    { label: L.total, value: letterAmount(invoice.totalGrossAmount, lang), kind: 'total' }
  ]
}

/**
 * The service date line of the info block: "Liefer-/Leistungsdatum" for one day,
 * "Leistungszeitraum" for a period (§ 14 UStG asks for one of them). Takes the label
 * serviceDateOf gave in the same language.
 */
export function letterServiceLabel(label: string): string {
  if (label === 'Leistungsdatum') return 'Liefer-/Leistungsdatum'
  if (label === 'Date of service') return 'Date of supply/service'
  return label
}
