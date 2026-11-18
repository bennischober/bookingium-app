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
