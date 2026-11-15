import { describe, expect, it } from 'vitest'
import {
  EMPTY_LINE,
  computeTotals,
  initialLines,
  initialRecipient,
  lineAmounts,
  normalizeLineItems,
  recipientError,
  recipientOfKind,
  recipientPayload,
  removeLine,
  saveLine,
  type InvoiceLineDraft
} from '../src/renderer/src/components/invoice/invoiceFormState'
import type { InvoiceDto } from '../src/main/api/schemas/invoice.schema'

// #61: the invoice form's state rules, out of the component.

const invoice = (patch: Partial<InvoiceDto>) => ({ lineItems: [], ...patch }) as InvoiceDto

const line = (patch: Partial<InvoiceLineDraft>): InvoiceLineDraft => ({ ...EMPTY_LINE, ...patch })

describe('initialLines', () => {
  it('starts a new invoice with one empty line', () => {
    expect(initialLines(undefined)).toEqual([EMPTY_LINE])
  })

  it('shows a stored invoice without lines as one line of its total, tax-free', () => {
    expect(initialLines(invoice({ totalAmount: 250 }))).toEqual([
      { ...EMPTY_LINE, description: 'Leistungsposition', unitPriceNet: '250', taxRate: '0' }
    ])
  })

  it('turns stored lines into typed strings', () => {
    const lines = initialLines(
      invoice({
        lineItems: [
          {
            description: 'Gage',
            quantity: 2,
            unit: 'piece',
            unitPriceNet: 99.5,
            taxRate: 7,
            taxCode: 'standard'
          }
        ] as InvoiceDto['lineItems']
      })
    )
    expect(lines).toEqual([
      {
        description: 'Gage',
        quantity: '2',
        unit: 'piece',
        unitPriceNet: '99.5',
        taxRate: '7',
        taxCode: 'standard'
      }
    ])
  })
})

describe('normalizeLineItems', () => {
  it('clamps the numbers and fills blanks', () => {
    expect(
      normalizeLineItems([
        line({ description: '  ', quantity: '-3', unit: ' ', unitPriceNet: '-1', taxRate: '150' })
      ])
    ).toEqual([
      {
        description: 'Leistungsposition',
        quantity: 0.000001,
        unit: 'service',
        unitPriceNet: 0,
        taxRate: 100,
        taxCode: 'standard'
      }
    ])
  })

  it('reads unparsable numbers as their defaults', () => {
    const [normalized] = normalizeLineItems([
      line({ description: 'X', quantity: 'abc', unitPriceNet: '', taxRate: '' })
    ])
    expect(normalized).toMatchObject({ quantity: 1, unitPriceNet: 0, taxRate: 0 })
  })

  it('never returns an empty list', () => {
    expect(normalizeLineItems([])).toEqual([
      {
        description: 'Leistungsposition',
        quantity: 1,
        unit: 'service',
        unitPriceNet: 0,
        taxRate: 0,
        taxCode: 'other'
      }
    ])
  })
})

describe('totals', () => {
  it('sums net, tax and gross with the stored rounding', () => {
    const lines = normalizeLineItems([
      line({ description: 'A', quantity: '3', unitPriceNet: '33.33', taxRate: '19' }),
      line({ description: 'B', quantity: '1', unitPriceNet: '10', taxRate: '7' })
    ])
    expect(computeTotals(lines)).toEqual({
      subtotalNetAmount: 109.99,
      subtotalTaxAmount: 19.7,
      totalGrossAmount: 129.69
    })
  })

  it('shows one typed line with its net and gross', () => {
    expect(lineAmounts(line({ quantity: '2', unitPriceNet: '50', taxRate: '19' }))).toEqual({
      quantity: 2,
      unitPrice: 50,
      taxRate: 19,
      net: 100,
      gross: 119
    })
  })
})

describe('line list', () => {
  const a = line({ description: 'A' })
  const b = line({ description: 'B' })

  it('adds a line, or replaces the one being edited', () => {
    expect(saveLine([a], null, b)).toEqual([a, b])
    expect(saveLine([a, b], 0, line({ description: 'C' })).map((l) => l.description)).toEqual([
      'C',
      'B'
    ])
  })

  it('removes a line but empties the last one instead', () => {
    expect(removeLine([a, b], 0)).toEqual([b])
    expect(removeLine([a], 0)).toEqual([EMPTY_LINE])
  })
})

describe('recipient', () => {
  it('opens a new invoice on "company" and an edited one on its own recipient', () => {
    expect(initialRecipient(undefined)).toEqual(recipientOfKind('company'))
    expect(
      initialRecipient(invoice({ recipientKind: 'other', recipientName: 'Kulturamt' }))
    ).toMatchObject({ kind: 'other', nameOverride: 'Kulturamt' })
    // The stored name of a linked recipient is not a typed name
    expect(
      initialRecipient(
        invoice({ recipientKind: 'band', recipientBandId: 4, recipientName: 'Some Band' })
      )
    ).toMatchObject({ kind: 'band', bandId: 4, nameOverride: '' })
  })

  it('needs a band, a person or a name for those kinds; a company may be automatic', () => {
    expect(recipientError(recipientOfKind('company'))).toBeNull()
    expect(recipientError(recipientOfKind('band'))).toBe('Bitte eine Empfänger-Band auswählen')
    expect(recipientError(recipientOfKind('person'))).toBe('Bitte eine Empfänger-Person auswählen')
    expect(recipientError({ ...recipientOfKind('other'), nameOverride: '  ' })).toBe(
      'Bitte einen Empfängernamen eingeben'
    )
    expect(recipientError({ ...recipientOfKind('band'), bandId: 1 })).toBeNull()
  })

  it('sends the typed name only for "other", trimmed', () => {
    expect(recipientPayload({ ...recipientOfKind('other'), nameOverride: ' X ' })).toEqual({
      recipientKind: 'other',
      recipientCompanyId: null,
      recipientBandId: null,
      recipientPersonId: null,
      recipientNameOverride: 'X'
    })
    expect(
      recipientPayload({ ...recipientOfKind('company'), companyId: 2, nameOverride: 'stale' })
        .recipientNameOverride
    ).toBeUndefined()
  })
})
