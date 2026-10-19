// Invoice amounts in whole cents - the one place where money is rounded.
// Used by the invoice repository (stored totals), the invoice form (live
// totals) and the e-invoice XML, so all three agree to the cent.
//
// The method follows EN 16931, whose business rules (BR-CO-*) recompute
// every total from the lines:
//   line net     = quantity × unit price, rounded to cents
//   VAT per rate = (sum of the line nets at that rate) × rate, rounded once
//   VAT total    = sum of the per-rate VAT amounts
//   gross        = net total + VAT total
// The per-line VAT is only for display (standard template); it can differ
// from the per-rate VAT by a cent when several lines share a rate.

/** Rounds to an integer, halves away from zero, ignoring float noise (1.005 × 100) */
function roundHalfAway(value: number): number {
  const magnitude = Math.round(Number(Math.abs(value).toPrecision(15)))
  return value < 0 ? -magnitude : magnitude
}

export function toCents(amount: number): number {
  return roundHalfAway(amount * 100)
}

export function fromCents(cents: number): number {
  return cents / 100
}

/** Same rounding as toCents, as an amount (e.g. 1.005 -> 1.01) */
export function roundMoney(amount: number): number {
  return fromCents(toCents(amount))
}

export function lineNetCents(quantity: number, unitPriceNet: number): number {
  return toCents(quantity * unitPriceNet)
}

export function vatCents(netCents: number, rate: number): number {
  return roundHalfAway((netCents * rate) / 100)
}

export type AmountLine = { quantity: number; unitPriceNet: number; taxRate: number }

export type LineAmounts = { netCents: number; taxCents: number; grossCents: number }

export type RateGroup = { rate: number; netCents: number; taxCents: number }

export type InvoiceAmounts = {
  lines: LineAmounts[]
  /** One entry per distinct VAT rate, in order of first appearance */
  rates: RateGroup[]
  netCents: number
  taxCents: number
  grossCents: number
}

export function computeInvoiceAmounts(lines: AmountLine[]): InvoiceAmounts {
  const lineAmounts = lines.map((line) => {
    const netCents = lineNetCents(line.quantity, line.unitPriceNet)
    const taxCents = vatCents(netCents, line.taxRate)
    return { netCents, taxCents, grossCents: netCents + taxCents }
  })

  const byRate = new Map<number, number>()
  lines.forEach((line, index) => {
    byRate.set(line.taxRate, (byRate.get(line.taxRate) ?? 0) + lineAmounts[index].netCents)
  })
  const rates = [...byRate].map(([rate, netCents]) => ({
    rate,
    netCents,
    taxCents: vatCents(netCents, rate)
  }))

  const netCents = lineAmounts.reduce((sum, line) => sum + line.netCents, 0)
  const taxCents = rates.reduce((sum, group) => sum + group.taxCents, 0)
  return { lines: lineAmounts, rates, netCents, taxCents, grossCents: netCents + taxCents }
}

/** Amount with exactly two decimals and a dot ("1234.50"), as e-invoices need it */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
