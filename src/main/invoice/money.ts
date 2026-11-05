// An invoice's currency: an ISO 4217 code, stored per invoice (default EUR), and how its
// amounts are written. The e-invoice needs the ISO code and the payment QR code only knows EUR.
//
// Pure (no Node or DOM APIs): used by the invoice form, the templates and the invoice mail.

/** The currencies the invoice form offers, EUR first */
export const INVOICE_CURRENCIES = [
  'EUR',
  'CHF',
  'GBP',
  'USD',
  'DKK',
  'NOK',
  'SEK',
  'PLN',
  'CZK',
  'HUF'
] as const

/** A three-letter ISO code, as the e-invoice requires it */
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

/**
 * An amount in its currency ("3.500,00 €"). Intl throws on a code that is not three letters;
 * such a code, stored before the form only offered a list, is written after the number
 * instead of breaking the page.
 */
export function formatMoney(value: number, currency: string, locale = 'de-DE'): string {
  const code = currency || 'EUR'
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(value)
  } catch {
    const amount = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value)
    return `${amount} ${code}`
  }
}
