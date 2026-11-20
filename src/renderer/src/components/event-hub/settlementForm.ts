// #228: text ↔ cents for the settlement tab's money fields. Pure, so it is tested.
import { fromCents, toCents } from '../../../../main/einvoice/amounts'
import { parseAmount } from '@/lib/invoiceLabels'

/** 422150 → "4.221,50" */
export function centsText(cents: number): string {
  return fromCents(cents).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

/** "4.221,50 €" → 422150; '' → 0; null when it is no number */
export function parseCents(text: string): number | null {
  if (!text.trim()) return 0
  const amount = parseAmount(text)
  return amount === null ? null : toCents(amount)
}

/** "7", "7,5" → 7.5; null when it is no number */
export function parsePercent(text: string): number | null {
  const value = Number(text.replace(',', '.').trim() || '0')
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

/** 422150 → "4.221,50 €" */
export const euroText = (cents: number): string => `${centsText(cents)} €`

/** An amount in the settlement's currency: "4.221,50 €", "3.600,00 GBP" */
export const moneyText = (cents: number, currency: string): string =>
  currency === 'EUR' ? euroText(cents) : `${centsText(cents)} ${currency}`

/** The currencies offered for a settlement; EUR first, the others of tours abroad */
export const SETTLEMENT_CURRENCIES = [
  'EUR',
  'GBP',
  'CHF',
  'USD',
  'DKK',
  'SEK',
  'NOK',
  'PLN',
  'CZK'
] as const

/** 1.17 → "1,17"; '' for none */
export function rateText(rate: number | null): string {
  return rate === null
    ? ''
    : rate.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

/**
 * "1,17" or "1.17" → 1.17 (a rate has no thousands, so a single dot is the decimal point);
 * '' → null (no rate yet); undefined when it is no positive number
 */
export function parseRate(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (!trimmed) return null
  const value = Number(
    trimmed.includes(',') ? trimmed.replace(/\./g, '').replace(',', '.') : trimmed
  )
  return Number.isFinite(value) && value > 0 ? value : undefined
}
