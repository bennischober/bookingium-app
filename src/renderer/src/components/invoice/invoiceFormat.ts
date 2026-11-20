import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import type { Lang } from '../../../../main/invoice/taxSummary'
import { formatMoney as formatAmount } from '../../../../main/invoice/money'
import { unitLabelOf } from '../../../../main/einvoice/codes'

// Formatting helpers and the shared hatch style of the invoice print templates

// German invoices "3.500,00 €", English ones "€3,500.00"
const NUMBER_LOCALE: Record<Lang, string> = { de: 'de-DE', en: 'en-GB' }

export function formatMoney(value: number, currency: string, lang: Lang = 'de'): string {
  return formatAmount(value, currency, NUMBER_LOCALE[lang])
}

// Formats date-only ISO strings (YYYY-MM-DD) without timezone pitfalls
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}.${month}.${year}`
}

export function formatQuantity(value: number, lang: Lang = 'de'): string {
  return new Intl.NumberFormat(NUMBER_LOCALE[lang], { maximumFractionDigits: 3 }).format(value)
}

/** "19 %" in German, "19%" in English */
export function formatRate(rate: number, lang: Lang): string {
  return lang === 'en' ? `${formatQuantity(rate, lang)}%` : `${formatQuantity(rate)} %`
}

// English labels of the stored units (the German ones are INVOICE_UNITS' labels)
const UNIT_LABELS_EN: Record<string, string> = {
  service: 'Lump sum',
  piece: 'Piece',
  hour: 'Hour',
  day: 'Day',
  month: 'Month',
  km: 'Kilometre'
}

/** Printed label of a stored unit ("service" -> "Pauschale" / "Lump sum"); free text as is */
export function unitLabel(unit: string, lang: Lang): string {
  return lang === 'en' ? (UNIT_LABELS_EN[unit] ?? unit) : unitLabelOf(unit)
}

const WATERMARKS: Record<Lang, { draft: string; cancelled: string }> = {
  de: { draft: 'ENTWURF', cancelled: 'STORNIERT' },
  en: { draft: 'DRAFT', cancelled: 'CANCELLED' }
}

/** The watermark across every page of a draft or cancelled invoice, in its language */
export function watermarkOf(status: string, lang: Lang): string | null {
  if (status === 'draft') return WATERMARKS[lang].draft
  if (status === 'cancelled') return WATERMARKS[lang].cancelled
  return null
}

// Stornorechnung: number and date of the invoice it cancels
export function cancellationOf(data: InvoicePrintDto): { number: string; date: string } | null {
  const { invoice } = data
  if (invoice.kind !== 'cancellation') return null
  return {
    number: String(invoice.cancelsInvoiceNumber ?? ''),
    date: formatDate(invoice.cancelsInvoiceIssueDate)
  }
}

// Hatch-shaded header cell style (Word-style diagonal stripes, like the
// reference). A tiled SVG, not a CSS gradient: Chromium sometimes prints
// repeating gradients as function-based shadings (ShadingType 1), which
// pdf.js (the preview) can't draw and fills pink.
const HATCH_TILE =
  "<svg xmlns='http://www.w3.org/2000/svg' width='3' height='3'>" +
  "<path d='M-1 1L1 -1M0 3L3 0M2 4L4 2' stroke='#e0e0e0' stroke-width='1'/></svg>"
export const HATCH_STYLE = {
  backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(HATCH_TILE)}")`
}
