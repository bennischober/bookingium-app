// The Geschäftsbrief invoice template: plain amounts under "Betrag EUR" and the totals block
// "Summe / x % USt. auf EUR … / Endbetrag"
import { describe, expect, it } from 'vitest'
import type { InvoicePrintDto } from '../src/main/api/schemas/invoice.schema'
import {
  letterAmount,
  letterRate,
  letterServiceLabel,
  letterTotals
} from '../src/renderer/src/components/invoice/letterFormat'

type Item = { taxRate: number; taxCode: string; lineNetAmount: number }

function data(items: Item[], totals: { net: number; gross: number }, currency = 'EUR') {
  return {
    invoice: {
      currency,
      subtotalNetAmount: totals.net,
      totalGrossAmount: totals.gross,
      lineItems: items
    }
  } as unknown as InvoicePrintDto
}

describe('letterFormat', () => {
  it('writes amounts and rates the German way, without a currency sign', () => {
    expect(letterAmount(34.86)).toBe('34,86')
    expect(letterAmount(1234.5)).toBe('1.234,50')
    expect(letterAmount(-41.48)).toBe('-41,48')
    expect(letterRate(19)).toBe('19,00 %')
    expect(letterRate(7)).toBe('7,00 %')
  })

  it('lists Summe, the VAT on its base, and the Endbetrag', () => {
    expect(
      letterTotals(
        data([{ taxRate: 19, taxCode: 'standard', lineNetAmount: 34.86 }], {
          net: 34.86,
          gross: 41.48
        })
      )
    ).toEqual([
      { label: 'Summe:', value: '34,86', kind: 'sum' },
      { label: '19,00 % USt. auf EUR 34,86:', value: '6,62', kind: 'vat' },
      { label: 'Endbetrag:', value: '41,48', kind: 'total' }
    ])
  })

  it('gives each rate its own line, and none to a 0 % group the tax note explains', () => {
    const lines = letterTotals(
      data(
        [
          { taxRate: 19, taxCode: 'standard', lineNetAmount: 100 },
          { taxRate: 7, taxCode: 'standard', lineNetAmount: 50 },
          { taxRate: 0, taxCode: 'reverse_charge', lineNetAmount: 200 }
        ],
        { net: 350, gross: 372.5 },
        'CHF'
      )
    )
    expect(lines.map((line) => [line.label, line.value])).toEqual([
      ['Summe:', '350,00'],
      ['19,00 % USt. auf CHF 100,00:', '19,00'],
      ['7,00 % USt. auf CHF 50,00:', '3,50'],
      ['Endbetrag:', '372,50']
    ])
  })

  it('names one service day "Liefer-/Leistungsdatum", a period as it is', () => {
    expect(letterServiceLabel('Leistungsdatum')).toBe('Liefer-/Leistungsdatum')
    expect(letterServiceLabel('Leistungszeitraum')).toBe('Leistungszeitraum')
  })
})
