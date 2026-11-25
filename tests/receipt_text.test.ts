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
      supplierVatIds: ['DE123456789'],
      recipientVatIds: []
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

// Every supplier lays out its invoices differently; these follow real layouts with made-up data
describe('readReceiptText across layouts', () => {
  it('column layout: labels and values apart, supplier at the bottom, recipient block', () => {
    // An online ad platform: an overview box, then a totals table whose values come first
    const text = `Seite 1 von 2
Rechnung
Rechnungsnummer: 9100000042
........ 9100000042
........ 31. Okt. 2026
........ 1111-2222-3333
Details
Rechnungsnummer
Rechnungsdatum
Kontonummer
7,29 €
Beispiel Ads
Gesamtsumme in EUR
7,14 €
0,00 €
0,15 €
7,29 €
Übersicht für den Zeitraum 1. Okt. 2026 - 31. Okt. 2026
Betrag in EUR
Umsatzsteuer (0%)
Gebühren für Österreich*
Gesamtsumme in EUR
Beispiel Werbung Ireland Limited
Musterhaus
Musterstraße
Dublin 4
Ireland
Umsatzsteuer-Identifikationsnummer: IE 1234567X
Rechnungsempfänger
Erika Mustermann
Agentur Beispiel AG
Beispielweg 2
54321 Beispielstadt
Germany
Umsatzsteuer-Identifikationsnummer: DE 123456789
Handelsregisternummer von Beispiel Werbung Ireland: 123456
Seite 2 von 2
7,14 €
0,00 €
7,14 €
Zwischensumme in EUR
Umsatzsteuer (0%)
Gesamtsumme in EUR
Beschreibung Menge Einheiten Betrag
Kampagne Herbst 1492 Klicks 7,23`
    expect(readReceiptText(text)).toEqual({
      receiptDate: '2026-10-31',
      amountCents: 729,
      currency: 'EUR',
      reference: '9100000042',
      supplierNames: ['Beispiel Werbung Ireland Limited'],
      supplierVatIds: ['IE1234567X'],
      recipientVatIds: ['DE123456789']
    })
  })

  it('telecom bill: Rechnungsbetrag, billing period, customer number', () => {
    const text = `Musterfon GmbH, Postfach 1, 12345 Musterstadt
Agentur Beispiel GmbH
Beispielweg 2
54321 Beispielstadt
Ihre Rechnung für Oktober 2026
Kundennummer 123 456 789
Rechnungsnummer 2026-10-998877
Datum 05.11.2026
Abrechnungszeitraum 01.10.2026 - 31.10.2026
Monatlicher Grundpreis 33,61 €
Summe netto 33,61 €
Umsatzsteuer 19 % 6,38 €
Rechnungsbetrag 39,99 €
Der Betrag wird am 15.11.2026 abgebucht.`
    expect(readReceiptText(text)).toMatchObject({
      receiptDate: '2026-11-05',
      amountCents: 3999,
      currency: 'EUR',
      reference: '2026-10-998877',
      supplierNames: ['Musterfon GmbH', 'Agentur Beispiel GmbH']
    })
  })

  it('English shop invoice with "Bill to" and a foreign legal form', () => {
    const text = `INVOICE
Beispielshop Europe S.à r.l.
1 Rue Exemple, L-1234 Luxembourg
VAT: LU12345678
Bill to
Agentur Beispiel GmbH
Beispielweg 2, 54321 Beispielstadt
VAT: DE123456789
Invoice number: LU-2026-77
Invoice date: 07 November 2026
Item Qty Unit price Amount
USB microphone 1 49.58 49.58
Subtotal 49.58
VAT 19% 9.42
Invoice total EUR 59.00`
    expect(readReceiptText(text)).toMatchObject({
      receiptDate: '2026-11-07',
      amountCents: 5900,
      currency: 'EUR',
      reference: 'LU-2026-77',
      supplierNames: ['Beispielshop Europe S.à r.l.'],
      supplierVatIds: ['LU12345678'],
      recipientVatIds: ['DE123456789']
    })
  })

  it('ticket: no invoice-date label, travel period skipped, total from "Summe"', () => {
    const text = `Musterbahn AG
Online-Ticket
Gültigkeit: vom 20.11.2026 bis 21.11.2026
Buchungsdatum 12.11.2026
Hinfahrt Musterstadt → Beispielstadt
Flexpreis 1 Erwachsener 49,90 €
Summe 49,90 €
Enthaltene MwSt 7 % 3,26 €
Auftragsnummer: AB1234`
    expect(readReceiptText(text)).toMatchObject({
      receiptDate: '2026-11-12',
      amountCents: 4990,
      reference: '',
      supplierNames: ['Musterbahn AG']
    })
  })

  it('values block above the labels: the largest repeated amount is the total', () => {
    const text = `Beispiel Software Inc.
Receipt
119,00 €
100,00 €
19,00 €
119,00 €
Gesamtbetrag
Nettobetrag
Umsatzsteuer
Bezahlt`
    expect(readReceiptText(text)).toMatchObject({ amountCents: 11900, currency: 'EUR' })
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
