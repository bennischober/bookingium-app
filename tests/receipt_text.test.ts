// #225: guessing a receipt's fields from a plain PDF's text (no e-invoice data)
import { describe, expect, it } from 'vitest'
import {
  amountsIn,
  datesIn,
  hasReceiptTextFields,
  readReceiptText
} from '../src/main/receipts/receiptText'

const HOTEL = `Hotel Beispiel GmbH · Musterstraße 1 · 12345 Musterstadt
Agentur Beispiel GmbH
Beispielweg 2
54321 Beispielstadt
Rechnung
Rechnungsnummer: RE-2026/0815
Rechnungsdatum: 03.11.2026
Leistungszeitraum: 01.11.2026 - 02.11.2026
Pos. Bezeichnung Menge Einzelpreis Gesamt
1 Übernachtung Einzelzimmer 2 89,00 € 178,00 €
2 Frühstück 2 12,50 € 25,00 €
Summe netto 189,72 €
zzgl. 7 % MwSt. 13,28 €
Gesamtbetrag inkl. MwSt. 203,00 €
Zahlbar bis 17.11.2026
USt-IdNr.: DE123456789`

describe('readReceiptText', () => {
  it('reads date, total, number, supplier and USt-IdNr. from a hotel invoice', () => {
    expect(readReceiptText(HOTEL)).toEqual({
      receiptDate: '2026-11-03',
      amountCents: 20300,
      currency: 'EUR',
      reference: 'RE-2026/0815',
      supplierNames: ['Hotel Beispiel GmbH', 'Agentur Beispiel GmbH'],
      vatIds: ['DE123456789']
    })
  })

  it('reads a till receipt: SUMME line, short date, Bon-Nr.', () => {
    const text = `Tankstelle Muster
Musterstraße 5, 12345 Musterstadt
Super E10 45,20 l 1,799 EUR/l 81,31
SUMME EUR 81,31
Gegeben BAR 100,00
Rückgeld 18,69
MwSt 19% 12,98
Datum 14.10.26 Uhrzeit 13:44 Bon-Nr. 4711`
    expect(readReceiptText(text)).toMatchObject({
      receiptDate: '2026-10-14',
      amountCents: 8131,
      currency: 'EUR',
      reference: '4711',
      supplierNames: []
    })
  })

  it('takes the amount from the next line in two-column layouts', () => {
    const text = `Rechnungsbetrag\n1.190,00 EUR\nRechnungsdatum\n2026-11-03`
    expect(readReceiptText(text)).toMatchObject({
      amountCents: 119000,
      receiptDate: '2026-11-03'
    })
  })

  it('reads English invoices and other currencies', () => {
    const text = `Example Ltd
Invoice No: INV-1234
Invoice date: 5 November 2026
Subtotal 1,000.00
VAT 200.00
Total due £1,200.00`
    expect(readReceiptText(text)).toMatchObject({
      receiptDate: '2026-11-05',
      amountCents: 120000,
      currency: 'GBP',
      reference: 'INV-1234',
      supplierNames: ['Example Ltd']
    })
  })

  it('skips due and delivery dates for the invoice date', () => {
    const text = `Lieferdatum 01.11.2026\nFällig am 20.11.2026\nDatum: 04.11.2026`
    expect(readReceiptText(text).receiptDate).toBe('2026-11-04')
    // Without a label the first date counts
    expect(readReceiptText('Musterstadt, den 02.11.2026').receiptDate).toBe('2026-11-02')
  })

  it('ignores register-court lines as supplier names', () => {
    const text = `Registergericht: AG Musterstadt HRB 1234\nBeispiel Events GmbH & Co. KG`
    expect(readReceiptText(text).supplierNames).toEqual(['Beispiel Events GmbH & Co. KG'])
  })

  it('finds nothing in text without receipt data', () => {
    const fields = readReceiptText('Sehr geehrte Damen und Herren, anbei die Unterlagen.')
    expect(fields).toMatchObject({ receiptDate: null, amountCents: null, currency: null })
    expect(hasReceiptTextFields(fields)).toBe(false)
  })
})

describe('datesIn / amountsIn', () => {
  it('rejects impossible dates', () => {
    expect(datesIn('31.02.2026 und 31.12.2026')).toEqual(['2026-12-31'])
    expect(datesIn('Version 1.2.3')).toEqual([])
  })

  it('reads German, English and Swiss amounts, but not quantities or versions', () => {
    expect(amountsIn('1.234,56 € und 7,00')).toEqual([123456, 700])
    expect(amountsIn("1,234.56 und CHF 1'234.50")).toEqual([123456, 123450])
    expect(amountsIn('-12,50')).toEqual([-1250])
    expect(amountsIn('2 Stück, Version 1.2.34, 1.234.56')).toEqual([])
  })
})
