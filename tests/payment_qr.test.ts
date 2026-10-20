// Payment QR code (EPC "GiroCode"): the exact text banking apps read, when
// an invoice gets none, and that the printed code decodes to that text.
import { describe, it, expect } from 'vitest'
import QRCode from 'qrcode'
import jsQR from 'jsqr'
import {
  EPC_MAX_BYTES,
  epcPayload,
  invoicePayment,
  isValidIban,
  type EpcPayment
} from '../src/main/payment/epcQr'
import type { InvoiceDto, InvoicePrintDto } from '../src/main/api/schemas/invoice.schema'
import { party } from './helpers/einvoiceFixtures'

const payment = (overrides: Partial<EpcPayment> = {}): EpcPayment => ({
  name: 'Beispiel Booking GmbH',
  iban: 'DE02 1203 0000 0000 2020 51',
  bic: 'BYLADEM1001',
  amountCents: 267500,
  reference: 'Rechnung 1040',
  ...overrides
})

function printData(invoice: Partial<InvoiceDto> = {}, issuer = party()): InvoicePrintDto {
  return {
    invoice: {
      kind: 'invoice',
      invoiceNumber: 1040,
      status: 'issued',
      currency: 'EUR',
      totalGrossAmount: 2675,
      ...invoice
    } as InvoiceDto,
    issuer,
    recipient: party({ legalName: 'Veranstalter GmbH' }),
    venueName: null,
    eventDate: null,
    managementShare: null
  }
}

/** Draws the QR code like the template (4-module quiet zone) and decodes it */
function decode(text: string): string | null {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const scale = 4
  const quiet = 4
  const size = (qr.modules.size + quiet * 2) * scale
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255)
  for (let row = 0; row < qr.modules.size; row++) {
    for (let col = 0; col < qr.modules.size; col++) {
      if (!qr.modules.get(row, col)) continue
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const offset = (((row + quiet) * scale + y) * size + (col + quiet) * scale + x) * 4
          pixels.fill(0, offset, offset + 3)
        }
      }
    }
  }
  return jsQR(pixels, size, size)?.data ?? null
}

describe('EPC payload', () => {
  it('writes the fields in the EPC order', () => {
    expect(epcPayload(payment())).toBe(
      [
        'BCD',
        '002',
        '1',
        'SCT',
        'BYLADEM1001',
        'Beispiel Booking GmbH',
        'DE02120300000000202051',
        'EUR2675.00',
        '',
        '',
        'Rechnung 1040'
      ].join('\n')
    )
  })

  it('formats cents exactly and leaves out an invalid BIC', () => {
    const text = epcPayload(payment({ amountCents: 1, bic: 'nope' }))!.split('\n')
    expect(text[4]).toBe('')
    expect(text[7]).toBe('EUR0.01')
  })

  it('refuses invalid IBANs, empty names and out-of-range amounts', () => {
    expect(epcPayload(payment({ iban: 'DE02 1203 0000 0000 2020 52' }))).toBeNull()
    expect(epcPayload(payment({ name: '  ' }))).toBeNull()
    expect(epcPayload(payment({ amountCents: 0 }))).toBeNull()
    expect(epcPayload(payment({ amountCents: 100_000_000_000 }))).toBeNull()
  })

  it('cuts long names and references and stays within 331 bytes', () => {
    const text = epcPayload(
      payment({ name: 'Ä'.repeat(100), reference: 'Verwendungszweck mit Ümläuten '.repeat(10) })
    )!
    const lines = text.split('\n')
    expect(lines[5]).toBe('Ä'.repeat(70))
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(EPC_MAX_BYTES)
    expect(lines[10].length).toBeGreaterThan(0)
  })

  it('checks IBANs with mod 97', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(isValidIban('AT61 1904 3002 3457 3201')).toBe(true)
    expect(isValidIban('DE89 3704 0044 0532 0130 01')).toBe(false)
    expect(isValidIban('')).toBe(false)
  })

  it('prints as a QR code that decodes to the same text', () => {
    const text = epcPayload(payment({ name: 'Müller & Söhne Booking' }))!
    expect(decode(text)).toBe(text)
  })
})

describe('invoice payment', () => {
  it('asks for the gross total to the issuer account', () => {
    expect(invoicePayment(printData(), 'de')).toEqual({
      name: 'Beispiel Booking GmbH',
      iban: 'DE02 1203 0000 0000 2020 51',
      bic: 'BYLADEM1001',
      amountCents: 267500,
      reference: 'Rechnung 1040'
    })
    expect(invoicePayment(printData(), 'en')?.reference).toBe('Invoice 1040')
  })

  it('uses the account holder when one is set', () => {
    const data = printData({}, party({ accountHolder: 'Erika Muster' }))
    expect(invoicePayment(data, 'de')?.name).toBe('Erika Muster')
    const noHolder = printData({}, party({ accountHolder: '' }))
    expect(invoicePayment(noHolder, 'de')?.name).toBe('Beispiel Booking GmbH')
  })

  it('keeps paid and overdue invoices payable', () => {
    expect(invoicePayment(printData({ status: 'paid' }), 'de')).not.toBeNull()
    expect(invoicePayment(printData({ status: 'overdue' }), 'de')).not.toBeNull()
  })

  it('gives drafts, cancelled invoices and Stornorechnungen no code', () => {
    expect(invoicePayment(printData({ status: 'draft', invoiceNumber: null }), 'de')).toBeNull()
    expect(invoicePayment(printData({ status: 'cancelled' }), 'de')).toBeNull()
    expect(
      invoicePayment(printData({ kind: 'cancellation', totalGrossAmount: -2675 }), 'de')
    ).toBeNull()
  })

  it('gives no code without something to pay in EUR to a valid IBAN', () => {
    expect(invoicePayment(printData({ currency: 'CHF' }), 'de')).toBeNull()
    expect(invoicePayment(printData({ totalGrossAmount: 0 }), 'de')).toBeNull()
    expect(invoicePayment(printData({}, party({ iban: '' })), 'de')).toBeNull()
    expect(invoicePayment({ ...printData(), issuer: null }, 'de')).toBeNull()
  })
})
