import { describe, expect, it } from 'vitest'
import { formatMoney } from '../src/main/invoice/money'
import { CreateInvoiceInput, UpdateInvoiceInput } from '../src/main/api/schemas/invoice.schema'

// Intl puts a narrow no-break space between amount and symbol
const plain = (text: string) => text.replace(/\s/g, ' ')

describe('formatMoney', () => {
  it('writes an amount in its currency', () => {
    expect(plain(formatMoney(3500, 'EUR'))).toBe('3.500,00 €')
    expect(plain(formatMoney(3500, 'USD'))).toBe('3.500,00 $')
    expect(plain(formatMoney(3500, 'EUR', 'en-GB'))).toBe('€3,500.00')
  })

  it('takes EUR when there is no code', () => {
    expect(plain(formatMoney(12.5, ''))).toBe('12,50 €')
  })

  it('writes a code Intl rejects after the number instead of throwing', () => {
    expect(plain(formatMoney(3500, 'EU'))).toBe('3.500,00 EU')
    expect(plain(formatMoney(3500, '€'))).toBe('3.500,00 €')
  })
})

describe('invoice currency input', () => {
  const base = { companyId: 1, recipientKind: 'company' as const }

  it('accepts an ISO code and normalizes its case', () => {
    expect(CreateInvoiceInput.parse({ ...base, currency: ' chf ' }).currency).toBe('CHF')
    expect(CreateInvoiceInput.parse(base).currency).toBe('EUR')
  })

  it('rejects anything that is not three letters', () => {
    for (const currency of ['EU', 'EURO', '€', 'U5D']) {
      expect(CreateInvoiceInput.safeParse({ ...base, currency }).success).toBe(false)
      expect(UpdateInvoiceInput.safeParse({ id: 1, currency }).success).toBe(false)
    }
  })
})
