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
  isEuCountry,
  vatCategoryOf
} from '../einvoice/codes'
import { findCountry } from '../import/normalize'

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

// ========================================
// Foreign recipients: language and tax code hints
// ========================================

// Countries whose recipients get German documents by default
const GERMAN_SPEAKING = new Set(['DE', 'AT', 'CH', 'LI'])

/** The recipient's ISO country: the snapshot's code, else its country name ("Österreich") */
export function recipientCountryCode(data: InvoicePrintDto): string | null {
  const recipient = data.recipient
  if (!recipient) return null
  const code = recipient.countryCode.trim().toUpperCase()
  if (code) return code
  return findCountry(recipient.country.trim())?.code ?? null
}

/**
 * The document language an invoice starts with: German for a German-speaking or unknown
 * country, English for every other one. Only the default; the print page can change it.
 */
export function suggestDocumentLang(data: InvoicePrintDto): Lang {
  const code = recipientCountryCode(data)
  return !code || GERMAN_SPEAKING.has(code) ? 'de' : 'en'
}

export type ForeignRecipientHint = {
  /** ISO code of the recipient's country, null when unknown */
  countryCode: string | null
  /**
   * Where the recipient sits, as far as the tax code goes: an EU business with a VAT ID,
   * an EU recipient without one, a country outside the EU. Null for a German recipient.
   */
  situation: 'eu_vat_id' | 'eu_no_vat_id' | 'non_eu' | null
  /** The tax code that usually fits the situation; a suggestion, never applied by itself */
  suggestedTaxCode: Extract<InvoiceTaxCode, 'reverse_charge' | 'not_taxable'> | null
  /** Some line charges German VAT although the situation suggests none */
  chargesGermanVat: boolean
  /** Reverse charge or an intra-Community supply without the buyer's VAT ID */
  missingVatId: boolean
}

/**
 * A hint for invoices abroad: which tax code usually fits a foreign
 * recipient, and a warning when reverse charge lacks the buyer's VAT ID. It decides nothing:
 * the tax code stays what the invoice says, and the tax advisor has the last word.
 * Null when there is nothing to point out.
 */
export function foreignRecipientHint(data: InvoicePrintDto): ForeignRecipientHint | null {
  const countryCode = recipientCountryCode(data)
  const vatId = data.recipient?.vatId.trim() ?? ''
  const missingVatId = needsBuyerVatId(data) && !vatId
  const foreign = countryCode !== null && countryCode !== 'DE'
  const situation: ForeignRecipientHint['situation'] = !foreign
    ? null
    : isEuCountry(countryCode)
      ? vatId
        ? 'eu_vat_id'
        : 'eu_no_vat_id'
      : 'non_eu'
  const suggestedTaxCode =
    situation === 'eu_vat_id' ? 'reverse_charge' : situation === 'non_eu' ? 'not_taxable' : null
  const chargesGermanVat =
    suggestedTaxCode !== null && data.invoice.lineItems.some((item) => item.taxRate > 0)
  if (!situation && !missingVatId) return null
  return { countryCode, situation, suggestedTaxCode, chargesGermanVat, missingVatId }
}
