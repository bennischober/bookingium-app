// How an invoice number is built from a company's numbering settings. Pure, so the rules are
// unit tested; the counter itself lives in company_invoice_settings (repositories/invoice/numbering).

import type { InvoiceNumberFormat } from '../api/schemas/invoice.schema'

export type NumberingSettings = {
  format: InvoiceNumberFormat
  /** Format `year`: the running number's minimum length (2026 + 013) */
  digits: number
  /** Format `year`: start at 1 again when the issue year changes */
  yearlyReset: boolean
  /** The next running number */
  next: number
  /** The issue year of the last number taken, null before the first */
  lastYear: number | null
}

/**
 * The number an invoice issued in `year` gets, and the counter after it. With format `year`
 * the running number is padded ("2026" + "013" = 2026013); a yearly restart begins at 1 in a
 * year after the last one taken.
 */
export function takeNumber(
  settings: NumberingSettings,
  year: number
): { number: number; next: number; year: number } {
  const restart =
    settings.format === 'year' &&
    settings.yearlyReset &&
    settings.lastYear !== null &&
    year > settings.lastYear
  const running = restart ? 1 : settings.next
  const number =
    settings.format === 'year'
      ? Number(`${year}${String(running).padStart(settings.digits, '0')}`)
      : running
  return { number, next: running + 1, year: Math.max(year, settings.lastYear ?? year) }
}

/** The number the next invoice would get, for the settings preview */
export function previewNumber(settings: NumberingSettings, year: number): number {
  return takeNumber(settings, year).number
}
