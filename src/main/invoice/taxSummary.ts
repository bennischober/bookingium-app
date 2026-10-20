// What a printed invoice must say about VAT (§ 14 Abs. 4 UStG): the net
// amount broken down by rate and exemption (Nr. 7), rate and tax amount per
// group (Nr. 8), the reason for any exemption, the buyer's VAT ID for
// reverse charge and intra-Community supplies (§ 14a), and the date of
// supply (Nr. 6).
//
// Pure (no Node or DOM APIs): used by the invoice templates in the renderer.

import type { InvoicePrintDto, InvoiceTaxCode } from '../api/schemas/invoice.schema'
import { toCents, vatCents } from '../einvoice/amounts'
import {
  DEFAULT_EXEMPTION,
  TAX_CODE_LABELS,
  TAX_NOTE_PRESETS,
  vatCategoryOf
} from '../einvoice/codes'

export type Lang = 'de' | 'en'

export type VatGroup = {
  rate: number
  /** Why there is no VAT (0 % groups); 'standard' for every rate above 0 */
  taxCode: InvoiceTaxCode
  netCents: number
  taxCents: number
}

/**
 * Net and VAT per group — one per rate, and per tax code at 0 % (exempt and
 * reverse charge are different groups). VAT is rounded once per group, like
 * the stored totals and the e-invoice.
 */
export function vatGroups(data: InvoicePrintDto): VatGroup[] {
  const groups = new Map<string, VatGroup>()
  for (const item of data.invoice.lineItems) {
    const taxCode: InvoiceTaxCode = item.taxRate > 0 ? 'standard' : item.taxCode
    const key = `${item.taxRate}|${taxCode}`
    const group = groups.get(key) ?? { rate: item.taxRate, taxCode, netCents: 0, taxCents: 0 }
    group.netCents += toCents(item.lineNetAmount)
    groups.set(key, group)
  }
  return [...groups.values()].map((group) => ({
    ...group,
    taxCents: vatCents(group.netCents, group.rate)
  }))
}

const ZERO_LABELS_EN: Record<InvoiceTaxCode, string> = {
  standard: 'standard rate',
  reduced: 'reduced rate',
  zero_rated: 'zero rate',
  reverse_charge: 'reverse charge',
  exempt: 'exempt',
  intra_community: 'intra-Community supply',
  export: 'export',
  not_taxable: 'not taxable',
  other: 'other'
}

/**
 * Label of a VAT line in the totals. With one group the net amount is the
 * invoice's net total; with several each line names its net amount.
 */
export function vatGroupLabel(
  group: VatGroup,
  single: boolean,
  lang: Lang,
  formatMoney: (cents: number) => string
): string {
  const number = new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'de-DE', {
    maximumFractionDigits: 2
  }).format(group.rate)
  // "19 %" in German, "19%" in English
  const rate = lang === 'en' ? `${number}%` : `${number} %`
  const on = single
    ? ''
    : lang === 'en'
      ? ` on ${formatMoney(group.netCents)}`
      : ` auf ${formatMoney(group.netCents)}`
  if (group.rate > 0) {
    if (single) return lang === 'en' ? `plus ${rate} VAT` : `zzgl. ${rate} USt.`
    return lang === 'en' ? `${rate} VAT${on}` : `${rate} USt.${on}`
  }
  const why = lang === 'en' ? ZERO_LABELS_EN[group.taxCode] : TAX_CODE_LABELS[group.taxCode]
  return lang === 'en' ? `0% VAT (${why})${on}` : `0 % USt. (${why})${on}`
}

// Standard wording for the categories that have one (English for the
// English template; exempt lines need the legal basis in the tax note)
const DEFAULT_NOTE_EN: Partial<Record<string, string>> = {
  AE: 'Reverse charge: VAT to be accounted for by the recipient',
  K: 'VAT-exempt intra-Community supply',
  G: 'VAT-exempt export',
  O: 'Not taxable in Germany'
}

/**
 * The tax note under the totals: the invoice's Steuerhinweis, else the
 * standard wording of its 0 % categories (reverse charge, …), else null.
 */
export function taxNoteOf(data: InvoicePrintDto, lang: Lang): string | null {
  const note = data.invoice.reverseChargeNote.trim()
  if (note) {
    // A preset gets its translation on English invoices; own text stays as typed
    const preset = TAX_NOTE_PRESETS.find((candidate) => candidate.text === note)
    return lang === 'en' && preset ? `${note} / ${preset.en}` : note
  }
  const defaults = new Set<string>()
  for (const item of data.invoice.lineItems) {
    if (item.taxRate !== 0) continue
    const result = vatCategoryOf(item.taxCode, item.taxRate)
    if (!('category' in result)) continue
    const text =
      lang === 'en' ? DEFAULT_NOTE_EN[result.category] : DEFAULT_EXEMPTION[result.category]?.reason
    if (text) defaults.add(text)
  }
  return defaults.size > 0 ? [...defaults].join('. ') : null
}

/** Reverse charge and intra-Community supplies print the buyer's VAT ID */
export function needsBuyerVatId(data: InvoicePrintDto): boolean {
  return data.invoice.lineItems.some(
    (item) => item.taxCode === 'reverse_charge' || item.taxCode === 'intra_community'
  )
}

/** "YYYY-MM-DD" -> "DD.MM.YYYY" */
function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [year, month, day] = iso.split('-')
  return year && month && day ? `${day}.${month}.${year}` : iso
}

/**
 * When the service was performed: the invoice's period (label or dates),
 * else the event date. Without either the date of supply is the invoice
 * date, which the invoice then has to say.
 */
export function serviceDateOf(data: InvoicePrintDto, lang: Lang): { label: string; value: string } {
  const { invoice } = data
  const start = formatDate(invoice.periodStartDate)
  const end = formatDate(invoice.periodEndDate)
  const period = lang === 'en' ? 'Service period' : 'Leistungszeitraum'
  const date = lang === 'en' ? 'Date of service' : 'Leistungsdatum'
  if (start && end && start !== end) return { label: period, value: `${start} – ${end}` }
  if (invoice.periodLabel) return { label: period, value: invoice.periodLabel }
  if (start || end) return { label: date, value: start || end }
  if (data.eventDate) return { label: date, value: formatDate(data.eventDate) }
  return { label: date, value: lang === 'en' ? 'as invoice date' : 'entspricht Rechnungsdatum' }
}
