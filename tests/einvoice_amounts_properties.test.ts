import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  computeInvoiceAmounts,
  formatCents,
  fromCents,
  lineNetCents,
  roundMoney,
  toCents,
  vatCents,
  type AmountLine
} from '../src/main/einvoice/amounts'

// Property-based tests for the one place money is rounded. Instead of a few
// hand-picked examples (einvoice.test.ts), each property states a rule that
// must hold for EVERY input and fast-check tries a few hundred generated
// inputs. A failure prints the seed and the smallest input that breaks it.
//
// The reference for the rounding rules is exact decimal arithmetic in BigInt:
// the float implementation has to agree with it to the cent.

/** Exact n / d (d > 0), rounded half away from zero */
function divRoundHalfAway(n: bigint, d: bigint): bigint {
  const abs = n < 0n ? -n : n
  let q = abs / d
  if (2n * (abs % d) >= d) q += 1n
  return n < 0n ? -q : q
}

// The supported range: an invoice of up to 10 Mio. € net. Within it every
// intermediate value has at most 15 significant digits, the precision
// roundHalfAway works at. Lines have prices up to 100.000,00 €, quantities up
// to 10.000 with three decimals (hours, kilometres) and a line net of at most
// 500.000 €; VAT rates are anything the schema allows (0-100, two decimals),
// with the German rates weighted in.
const MAX_LINES = 20
const MAX_LINE_NET_MILLICENTS = 50_000_000_000 // 500.000 € × 1000 (quantity in thousandths)
const quantityMillis = fc.integer({ min: 1, max: 10_000_000 })
const rateHundredths = fc.oneof(fc.constantFrom(0, 700, 1900), fc.integer({ min: 0, max: 10_000 }))
/** Net amounts up to 10 Mio. €, either sign (credit notes) */
const netCents = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 })

type GeneratedLine = { qm: number; pc: number; rh: number }

const generatedLine: fc.Arbitrary<GeneratedLine> = quantityMillis.chain((qm) =>
  fc.record({
    qm: fc.constant(qm),
    pc: fc.integer({ min: 0, max: Math.min(10_000_000, Math.floor(MAX_LINE_NET_MILLICENTS / qm)) }),
    rh: rateHundredths
  })
)
const generatedLines = fc.array(generatedLine, { maxLength: MAX_LINES })

const toLine = ({ qm, pc, rh }: GeneratedLine): AmountLine => ({
  quantity: qm / 1000,
  unitPriceNet: pc / 100,
  taxRate: rh / 100
})

/** Exact line net in cents: quantity × price, rounded once */
const exactLineNet = ({ qm, pc }: GeneratedLine): bigint =>
  divRoundHalfAway(BigInt(qm) * BigInt(pc), 1000n)

/** Exact VAT in cents for a net amount at a rate given in hundredths of a percent */
const exactVat = (net: number, rh: number): bigint =>
  divRoundHalfAway(BigInt(net) * BigInt(rh), 10_000n)

describe('toCents', () => {
  it('round-trips every cent amount', () => {
    fc.assert(
      fc.property(netCents, (cents) => {
        expect(toCents(fromCents(cents))).toBe(cents)
      })
    )
  })

  it('rounds a written half cent away from zero (1.005 -> 1.01)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000_000 }), (cents) => {
        const halfway = Number(`${(cents / 100).toFixed(2)}5`)
        expect(toCents(halfway)).toBe(cents + 1)
        expect(toCents(-halfway)).toBe(-(cents + 1))
      })
    )
  })

  it('is symmetric around zero', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), (amount) => {
        // + 0 folds -0 into 0: the sign of a zero is not a cent
        expect(toCents(-amount) + 0).toBe(-toCents(amount) + 0)
      })
    )
  })

  it('never decreases when the amount grows', () => {
    const amount = fc.double({ min: -1e9, max: 1e9, noNaN: true })
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a]
        expect(toCents(low)).toBeLessThanOrEqual(toCents(high))
      })
    )
  })

  it('moves an amount by at most half a cent (plus the float noise it ignores)', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), (amount) => {
        const noise = Math.abs(amount * 100) * 1e-13 + 1e-9
        expect(Math.abs(toCents(amount) - amount * 100)).toBeLessThanOrEqual(0.5 + noise)
      })
    )
  })
})

describe('negative zero', () => {
  it('never comes out of the rounding (Intl writes it as "-0,00 €")', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), rateHundredths, (amount, rh) => {
        expect(Object.is(toCents(amount), -0)).toBe(false)
        expect(Object.is(roundMoney(amount), -0)).toBe(false)
        expect(Object.is(vatCents(Math.trunc(amount), rh / 100), -0)).toBe(false)
      })
    )
  })

  it('found by fast-check: lines that cancel out round to plain zero', () => {
    const total = [0.3, -0.1, -0.2].reduce((sum, value) => sum + value, 0)
    expect(total).toBeLessThan(0) // -2.8e-17, float noise
    expect(Object.is(roundMoney(total), 0)).toBe(true)
  })
})

describe('roundMoney and formatCents', () => {
  it('rounding twice changes nothing', () => {
    fc.assert(
      fc.property(fc.double({ min: -1e9, max: 1e9, noNaN: true }), (amount) => {
        expect(roundMoney(roundMoney(amount))).toBe(roundMoney(amount))
      })
    )
  })

  it('writes two decimals with a dot and reads back to the same cents', () => {
    fc.assert(
      fc.property(netCents, (cents) => {
        const text = formatCents(cents)
        expect(text).toMatch(/^-?\d+\.\d{2}$/)
        expect(toCents(Number(text))).toBe(cents)
      })
    )
  })
})

describe('lineNetCents', () => {
  it('agrees with exact decimal arithmetic', () => {
    fc.assert(
      fc.property(generatedLine, (line) => {
        const { quantity, unitPriceNet } = toLine(line)
        expect(BigInt(lineNetCents(quantity, unitPriceNet))).toBe(exactLineNet(line))
      }),
      { numRuns: 2000 }
    )
  })
})

describe('vatCents', () => {
  it('agrees with exact decimal arithmetic', () => {
    fc.assert(
      fc.property(netCents, rateHundredths, (net, rh) => {
        expect(BigInt(vatCents(net, rh / 100))).toBe(exactVat(net, rh))
      }),
      { numRuns: 2000 }
    )
  })

  it('is zero at 0 % and for a zero net amount', () => {
    fc.assert(
      fc.property(netCents, rateHundredths, (net, rh) => {
        expect(vatCents(net, 0)).toBe(0)
        expect(vatCents(0, rh / 100)).toBe(0)
      })
    )
  })

  it('never decreases when the net amount grows', () => {
    fc.assert(
      fc.property(netCents, netCents, rateHundredths, (a, b, rh) => {
        const [low, high] = a <= b ? [a, b] : [b, a]
        expect(vatCents(low, rh / 100)).toBeLessThanOrEqual(vatCents(high, rh / 100))
      })
    )
  })
})

describe('computeInvoiceAmounts (EN 16931 sum rules)', () => {
  it('BR-CO-10/13/14/15: totals are the sums of their parts', () => {
    fc.assert(
      fc.property(generatedLines, (generated) => {
        const amounts = computeInvoiceAmounts(generated.map(toLine))
        const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

        // BR-CO-10: net total = sum of the line nets
        expect(amounts.netCents).toBe(sum(amounts.lines.map((line) => line.netCents)))
        // the rate groups split the net total without losing a cent
        expect(sum(amounts.rates.map((group) => group.netCents))).toBe(amounts.netCents)
        // BR-CO-14: VAT total = sum of the per-rate VAT amounts
        expect(amounts.taxCents).toBe(sum(amounts.rates.map((group) => group.taxCents)))
        // BR-CO-15: gross = net + VAT
        expect(amounts.grossCents).toBe(amounts.netCents + amounts.taxCents)
        for (const line of amounts.lines) {
          expect(line.grossCents).toBe(line.netCents + line.taxCents)
        }
      })
    )
  })

  it('BR-CO-17: VAT is rounded once per rate, exactly', () => {
    fc.assert(
      fc.property(generatedLines, (generated) => {
        const amounts = computeInvoiceAmounts(generated.map(toLine))

        const exactByRate = new Map<number, bigint>()
        for (const line of generated) {
          exactByRate.set(line.rh, (exactByRate.get(line.rh) ?? 0n) + exactLineNet(line))
        }
        expect(amounts.rates.map((group) => group.rate)).toEqual(
          [...exactByRate.keys()].map((rh) => rh / 100)
        )
        amounts.rates.forEach((group, index) => {
          const [rh, exactNet] = [...exactByRate][index]
          expect(BigInt(group.netCents)).toBe(exactNet)
          expect(BigInt(group.taxCents)).toBe(exactVat(Number(exactNet), rh))
        })
      })
    )
  })

  it('the order of the lines does not change any total', () => {
    fc.assert(
      fc.property(
        generatedLines.chain((lines) =>
          fc.tuple(fc.constant(lines), fc.shuffledSubarray(lines, { minLength: lines.length }))
        ),
        ([lines, shuffled]) => {
          const a = computeInvoiceAmounts(lines.map(toLine))
          const b = computeInvoiceAmounts(shuffled.map(toLine))
          expect([b.netCents, b.taxCents, b.grossCents]).toEqual([
            a.netCents,
            a.taxCents,
            a.grossCents
          ])
          const byRate = (groups: typeof a.rates) => [...groups].sort((x, y) => x.rate - y.rate)
          expect(byRate(b.rates)).toEqual(byRate(a.rates))
        }
      )
    )
  })

  it('splitting an invoice in two moves VAT by at most a cent per shared rate', () => {
    fc.assert(
      fc.property(generatedLines, generatedLines, (first, second) => {
        const a = computeInvoiceAmounts(first.map(toLine))
        const b = computeInvoiceAmounts(second.map(toLine))
        const both = computeInvoiceAmounts([...first, ...second].map(toLine))
        const sharedRates = a.rates.filter((group) =>
          b.rates.some((other) => other.rate === group.rate)
        ).length

        expect(both.netCents).toBe(a.netCents + b.netCents)
        expect(Math.abs(both.taxCents - a.taxCents - b.taxCents)).toBeLessThanOrEqual(sharedRates)
      })
    )
  })

  it('the per-line VAT shown on the invoice stays within half a cent per line of the total', () => {
    fc.assert(
      fc.property(generatedLines, (generated) => {
        const amounts = computeInvoiceAmounts(generated.map(toLine))
        const lineVat = amounts.lines.reduce((total, line) => total + line.taxCents, 0)
        const bound = (amounts.lines.length + amounts.rates.length) / 2
        expect(Math.abs(lineVat - amounts.taxCents)).toBeLessThanOrEqual(bound)
      })
    )
  })

  it('an empty invoice is zero everywhere', () => {
    expect(computeInvoiceAmounts([])).toEqual({
      lines: [],
      rates: [],
      netCents: 0,
      taxCents: 0,
      grossCents: 0
    })
  })
})
