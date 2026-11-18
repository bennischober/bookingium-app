import { describe, expect, it } from 'vitest'
import {
  amountText,
  fieldsOf,
  formStateOf
} from '../src/renderer/src/components/receipts/receiptForm'
import type { ReceiptFields } from '../src/main/api/schemas/receipt.schema'

const fields: ReceiptFields = {
  companyId: null,
  category: 'cash',
  receiptDate: '2026-11-03',
  amountCents: 119000,
  currency: 'EUR',
  supplierCompanyId: null,
  supplierName: 'Kiosk',
  reference: '',
  notes: '',
  fileName: 'Kiosk'
}

describe('receipt form', () => {
  it('shows amounts the German way', () => {
    expect(amountText(119000)).toBe('1.190,00')
    expect(amountText(5)).toBe('0,05')
    expect(amountText(null)).toBe('')
  })

  it('round-trips the fields', () => {
    expect(fieldsOf(formStateOf(fields))).toEqual(fields)
  })

  it('reads typed amounts, empty ones and dates', () => {
    const state = formStateOf(fields)
    expect(fieldsOf({ ...state, amount: '12,5 €' })).toMatchObject({ amountCents: 1250 })
    expect(fieldsOf({ ...state, amount: '', receiptDate: '' })).toMatchObject({
      amountCents: null,
      receiptDate: null
    })
    expect(fieldsOf({ ...state, currency: 'chf' })).toMatchObject({ currency: 'CHF' })
  })

  it('names what is wrong', () => {
    const state = formStateOf(fields)
    expect(fieldsOf({ ...state, amount: 'zwölf' })).toEqual({ error: 'Der Betrag ist keine Zahl' })
    expect(fieldsOf({ ...state, fileName: ' ' })).toEqual({
      error: 'Bitte einen Dateinamen angeben'
    })
    expect(fieldsOf({ ...state, currency: 'EURO' })).toEqual({
      error: 'Währung mit 3 Buchstaben (z. B. EUR)'
    })
  })
})
