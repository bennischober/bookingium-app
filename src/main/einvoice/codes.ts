// Code lists of the e-invoice (EN 16931) and how our stored values map to
// them: VAT categories (UNCL 5305), exemption reason codes (VATEX), unit
// codes (UN/ECE Recommendation 20), country codes (ISO 3166-1).
// Pure - shared by main (XML) and renderer (labels, completeness check).
import type { InvoiceTaxCode } from '../api/schemas/invoice.schema'

// ========================================
// Tax codes -> VAT categories
// ========================================

export type VatCategory = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O'

/** German labels of the stored tax codes (Steuerschlüssel) */
export const TAX_CODE_LABELS: Record<InvoiceTaxCode, string> = {
  standard: 'Regelsatz',
  reduced: 'ermäßigt',
  zero_rated: 'Nullsatz',
  reverse_charge: 'Reverse Charge',
  exempt: 'steuerfrei',
  intra_community: 'innergemeinschaftliche Lieferung',
  export: 'Ausfuhr (Drittland)',
  not_taxable: 'nicht steuerbar',
  other: 'sonstig'
}

/** Order of the tax codes in pickers */
export const TAX_CODES: InvoiceTaxCode[] = [
  'standard',
  'reduced',
  'reverse_charge',
  'exempt',
  'not_taxable',
  'intra_community',
  'export',
  'zero_rated',
  'other'
]

// Codes whose VAT rate must be 0 %; the rest (standard, reduced) need > 0 %
const ZERO_RATE_CATEGORY: Partial<Record<InvoiceTaxCode, VatCategory>> = {
  zero_rated: 'Z',
  reverse_charge: 'AE',
  exempt: 'E',
  intra_community: 'K',
  export: 'G',
  not_taxable: 'O'
}

export type CategoryResult =
  | { category: VatCategory }
  | { problem: 'rate_must_be_zero' | 'rate_must_be_positive' | 'unspecified' }

/** The VAT category of a line, or why it has none */
export function vatCategoryOf(taxCode: InvoiceTaxCode, taxRate: number): CategoryResult {
  const zeroCategory = ZERO_RATE_CATEGORY[taxCode]
  if (zeroCategory) {
    return taxRate === 0 ? { category: zeroCategory } : { problem: 'rate_must_be_zero' }
  }
  if (taxRate > 0) return { category: 'S' }
  // "sonstig" with 0 % says nothing about why there is no VAT
  return taxCode === 'other' ? { problem: 'unspecified' } : { problem: 'rate_must_be_positive' }
}

/**
 * Exemption reason (BT-120/BT-121) used when the invoice's tax note is
 * empty. Exempt lines (E) have no default: the legal basis (e.g. § 4 Nr.
 * 20 a UStG) must be written on the invoice. S and Z carry no reason.
 */
export const DEFAULT_EXEMPTION: Partial<Record<VatCategory, { reason: string; code: string }>> = {
  AE: { reason: 'Steuerschuldnerschaft des Leistungsempfängers', code: 'VATEX-EU-AE' },
  K: { reason: 'Steuerfreie innergemeinschaftliche Lieferung', code: 'VATEX-EU-IC' },
  G: { reason: 'Steuerfreie Ausfuhrlieferung', code: 'VATEX-EU-G' },
  O: { reason: 'Nicht steuerbar', code: 'VATEX-EU-O' }
}

/** Categories that need an exemption reason in the VAT breakdown */
export function needsExemptionReason(category: VatCategory): boolean {
  return category !== 'S' && category !== 'Z'
}

// ========================================
// Units -> UN/ECE Recommendation 20
// ========================================

/** Units offered in the invoice form (stored value, label, unit code) */
export const INVOICE_UNITS = [
  { value: 'service', label: 'Pauschale', code: 'LS' },
  { value: 'piece', label: 'Stück', code: 'C62' },
  { value: 'hour', label: 'Stunde', code: 'HUR' },
  { value: 'day', label: 'Tag', code: 'DAY' },
  { value: 'month', label: 'Monat', code: 'MON' },
  { value: 'km', label: 'Kilometer', code: 'KMT' }
] as const

// Free-text units from older invoices and imports (lower case)
const UNIT_ALIASES: Record<string, string> = {
  pauschal: 'LS',
  pauschale: 'LS',
  psch: 'LS',
  'psch.': 'LS',
  'lump sum': 'LS',
  ls: 'LS',
  stück: 'C62',
  stk: 'C62',
  'stk.': 'C62',
  st: 'C62',
  'st.': 'C62',
  pcs: 'C62',
  pc: 'C62',
  c62: 'C62',
  h: 'HUR',
  std: 'HUR',
  'std.': 'HUR',
  stunde: 'HUR',
  stunden: 'HUR',
  hours: 'HUR',
  hur: 'HUR',
  tag: 'DAY',
  tage: 'DAY',
  days: 'DAY',
  monat: 'MON',
  monate: 'MON',
  months: 'MON',
  mon: 'MON',
  kilometer: 'KMT',
  kmt: 'KMT'
}

/** Unit code of a stored unit, null if the e-invoice can't express it */
export function unitCodeOf(unit: string): string | null {
  const key = unit.trim().toLowerCase()
  const known = INVOICE_UNITS.find((option) => option.value === key)
  return known?.code ?? UNIT_ALIASES[key] ?? null
}

/** Display label of a stored unit ("service" -> "Pauschale"); free text as is */
export function unitLabelOf(unit: string): string {
  return INVOICE_UNITS.find((option) => option.value === unit)?.label ?? unit
}

// ========================================
// Countries, VAT ids
// ========================================

let countryNames: Map<string, string> | null = null

// "deutschland"/"germany" -> "DE", built once from the runtime's ICU data
function countryNameIndex(): Map<string, string> {
  if (countryNames) return countryNames
  countryNames = new Map()
  const names = ['de', 'en'].map((locale) => new Intl.DisplayNames([locale], { type: 'region' }))
  for (let first = 65; first <= 90; first++) {
    for (let second = 65; second <= 90; second++) {
      const code = String.fromCharCode(first, second)
      for (const display of names) {
        const name = display.of(code)
        if (name && name !== code) countryNames.set(name.toLowerCase(), code)
      }
    }
  }
  return countryNames
}

/** ISO 3166-1 alpha-2 code from the stored code, else from the country name */
export function countryCodeOf(countryCode: string, country: string): string | null {
  const code = countryCode.trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(code)) return code
  const name = country.trim().toLowerCase()
  return name ? (countryNameIndex().get(name) ?? null) : null
}

/** A VAT id with country prefix ("DE 123 456 789" -> "DE123456789"), else null */
export function vatIdOf(value: string): string | null {
  const compact = value.replace(/[\s.-]/g, '').toUpperCase()
  return /^[A-Z]{2}[0-9A-Z+*]{2,13}$/.test(compact) ? compact : null
}

// EU member states (ISO codes; Greece is GR here, EL only in VAT ids)
const EU_COUNTRIES = new Set([
  'AT',
  'BE',
  'BG',
  'CY',
  'CZ',
  'DE',
  'DK',
  'EE',
  'ES',
  'FI',
  'FR',
  'GR',
  'HR',
  'HU',
  'IE',
  'IT',
  'LT',
  'LU',
  'LV',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SE',
  'SI',
  'SK'
])

export function isEuCountry(countryCode: string): boolean {
  return EU_COUNTRIES.has(countryCode.toUpperCase())
}

/**
 * One-click texts for the invoice's tax note (Steuerhinweis), which is
 * printed and becomes the e-invoice exemption reason
 */
export const TAX_NOTE_PRESETS = [
  {
    label: 'Reverse Charge',
    text: 'Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge)'
  },
  { label: '§ 4 Nr. 20 a UStG', text: 'Steuerfrei nach § 4 Nr. 20 a UStG' },
  { label: 'Nicht steuerbar', text: 'Nicht im Inland steuerbare Leistung' }
] as const
