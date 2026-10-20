// "Per E-Mail senden": the email text from the template, the .eml draft
// (decoded again here), the mailto: link and how each mail program is used.
import { describe, it, expect } from 'vitest'
import { buildEml, encodeHeader, mailtoUrl, type EmailDraft } from '../src/main/mail/eml'
import { isProgramPath, mailMethodOf, thunderbirdComposeArg } from '../src/main/mail/mailProgram'
import {
  fillPlaceholders,
  invoiceEmail,
  invoiceEmailValues,
  recipientEmailOf
} from '../src/main/mail/invoiceEmail'
import { DEFAULT_INVOICE_EMAIL } from '../src/main/api/schemas/settings.schema'
import type { InvoiceDto, InvoicePrintDto } from '../src/main/api/schemas/invoice.schema'
import { party } from './helpers/einvoiceFixtures'

function printData(overrides: Partial<InvoicePrintDto> = {}, invoice: Partial<InvoiceDto> = {}) {
  return {
    invoice: {
      kind: 'invoice',
      invoiceNumber: 1040,
      status: 'issued',
      issueDate: '2026-10-19',
      dueDate: '2026-11-02',
      currency: 'EUR',
      totalGrossAmount: 2675,
      companyName: 'Beispiel Booking GmbH',
      recipientName: 'Veranstalter GmbH',
      ...invoice
    } as InvoiceDto,
    issuer: party({ contactName: 'Erika Muster' }),
    recipient: party({
      legalName: 'Veranstalter GmbH',
      email: 'info@veranstalter.example',
      contactEmail: 'buchhaltung@veranstalter.example'
    }),
    venueName: null,
    eventDate: null,
    managementShare: null,
    bandName: 'Pretty Wild',
    ...overrides
  } satisfies InvoicePrintDto
}

const draft: EmailDraft = {
  to: 'buchhaltung@veranstalter.example',
  subject: 'Rechnung 1040 – Pretty Wild (Zürich)',
  body: 'Guten Tag,\n\nanbei die Rechnung über 2.675,00 €.\n\nGrüße'
}

/** Decodes =?UTF-8?B?…?= words (folded or not) */
function decodeHeader(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_match, data: string) =>
      Buffer.from(data, 'base64').toString('utf-8')
    )
}

/** Splits an .eml into its headers and the decoded parts */
function parseEml(eml: string) {
  const [head, ...rest] = eml.split('\r\n\r\n')
  const headers = head.replace(/\r\n /g, ' ').split('\r\n')
  const boundary = /boundary="([^"]+)"/.exec(head)?.[1] ?? ''
  const parts = rest
    .join('\r\n\r\n')
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const [partHead, data] = part.replace(/^\r\n/, '').split('\r\n\r\n')
      return { head: partHead, data: Buffer.from(data.replace(/\r\n/g, ''), 'base64') }
    })
  return { headers, parts, boundary }
}

describe('invoice email text', () => {
  it('fills the default templates', () => {
    expect(invoiceEmail(printData(), 'de', DEFAULT_INVOICE_EMAIL.de)).toEqual({
      to: 'buchhaltung@veranstalter.example',
      subject: 'Rechnung 1040 – Pretty Wild',
      body:
        'Guten Tag,\n\nanbei erhalten Sie die Rechnung 1040 vom 19.10.2026 über 2.675,00 €.\n\n' +
        'Mit freundlichen Grüßen\nErika Muster'
    })
    const en = invoiceEmail(
      printData({}, { kind: 'cancellation', totalGrossAmount: -2675 }),
      'en',
      DEFAULT_INVOICE_EMAIL.en
    )
    expect(en.subject).toBe('Credit note 1040 – Pretty Wild')
    expect(en.body).toContain('Credit note 1040 of 19.10.2026 for -€2,675.00')
  })

  it('drops the separator of an empty value', () => {
    const noBand = printData({ bandName: null })
    expect(invoiceEmail(noBand, 'de', DEFAULT_INVOICE_EMAIL.de).subject).toBe('Rechnung 1040')
    expect(
      invoiceEmail(noBand, 'de', { subject: '{Band} - {Dokument} {Rechnungsnummer}', body: '' })
        .subject
    ).toBe('Rechnung 1040')
  })

  it('takes the band of a management share and the issuer as fallback sender', () => {
    const values = invoiceEmailValues(
      printData({ managementShare: { bandName: 'The New Roses' }, issuer: null }),
      'de'
    )
    expect(values.Band).toBe('The New Roses')
    expect(values.Absender).toBe('Beispiel Booking GmbH')
    expect(values.Fällig).toBe('02.11.2026')
  })

  it('keeps unknown placeholders', () => {
    expect(fillPlaceholders('{Betrag} {Unbekannt} { Band }', { Betrag: '1 €', Band: 'X' })).toBe(
      '1 € {Unbekannt} X'
    )
  })

  it('sends to the contact email, else the general one', () => {
    expect(recipientEmailOf(printData())).toBe('buchhaltung@veranstalter.example')
    const general = printData({
      recipient: party({ email: ' info@veranstalter.example ', contactEmail: '' })
    })
    expect(recipientEmailOf(general)).toBe('info@veranstalter.example')
    expect(recipientEmailOf(printData({ recipient: null }))).toBe('')
  })
})

describe('.eml draft', () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff, 0x00])

  it('is an unsent draft with text and PDF that decode back', () => {
    const eml = buildEml(
      draft,
      { fileName: 'Rechnung_1040_Größe.pdf', contentType: 'application/pdf', data: pdf },
      'BOUNDARY'
    )
    expect(eml).not.toMatch(/[^\r]\n/)
    const { headers, parts, boundary } = parseEml(eml)
    expect(boundary).toBe('BOUNDARY')
    expect(headers[0]).toBe('X-Unsent: 1')
    expect(headers).toContain('To: buchhaltung@veranstalter.example')
    expect(headers).toContain('MIME-Version: 1.0')
    const subject = headers.find((line) => line.startsWith('Subject: '))!
    expect(decodeHeader(subject.slice(9))).toBe(draft.subject)

    expect(parts).toHaveLength(2)
    expect(parts[0].head).toContain('text/plain; charset=utf-8')
    expect(parts[0].data.toString('utf-8')).toBe(draft.body.replace(/\n/g, '\r\n'))
    expect(parts[1].head).toContain(
      "Content-Disposition: attachment; filename*=UTF-8''Rechnung_1040_Gr%C3%B6%C3%9Fe.pdf"
    )
    expect(decodeHeader(/name="([^"]+)"/.exec(parts[1].head)![1])).toBe('Rechnung_1040_Größe.pdf')
    expect(new Uint8Array(parts[1].data)).toEqual(pdf)
    for (const line of eml.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998)
  })

  it('leaves out an unknown recipient', () => {
    const eml = buildEml(
      { ...draft, to: '' },
      { fileName: 'Rechnung_1040.pdf', contentType: 'application/pdf', data: pdf }
    )
    expect(eml).not.toContain('To:')
    expect(eml).toContain('Content-Disposition: attachment; filename="Rechnung_1040.pdf"')
  })

  it('splits long headers into short encoded words of whole characters', () => {
    const subject = 'Stornorechnung 2026783 – Managementbeteiligung Ü'.repeat(3)
    const encoded = encodeHeader(subject)
    for (const line of encoded.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76)
    expect(decodeHeader(encoded)).toBe(subject)
    expect(encodeHeader('Rechnung 1040')).toBe('Rechnung 1040')
  })
})

describe('mailto: link', () => {
  it('carries recipient, subject and text', () => {
    const url = mailtoUrl(draft)
    expect(url.startsWith('mailto:buchhaltung@veranstalter.example?subject=')).toBe(true)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('subject')).toBe(draft.subject)
    expect(params.get('body')).toBe(draft.body.replace(/\n/g, '\r\n'))
    expect(url).not.toContain('+')
    expect(mailtoUrl({ ...draft, to: '' }).startsWith('mailto:?subject=')).toBe(true)
  })
})

describe('mail program', () => {
  it('picks the method by the program that opens email links', () => {
    expect(mailMethodOf('C:\\Program Files\\Microsoft Office\\root\\Office16\\OUTLOOK.EXE')).toBe(
      'outlook'
    )
    expect(mailMethodOf('C:\\Program Files\\Mozilla Thunderbird\\thunderbird.exe')).toBe(
      'thunderbird'
    )
    expect(
      mailMethodOf('C:\\Program Files\\WindowsApps\\Microsoft.OutlookForWindows\\olk.exe')
    ).toBe('mailto')
    expect(mailMethodOf('C:\\WINDOWS\\system32\\OpenWith.exe')).toBe('files')
    expect(mailMethodOf('')).toBe('files')
    expect(isProgramPath('C:\\x\\Thunderbird.EXE', 'thunderbird')).toBe(true)
    expect(isProgramPath('C:\\x\\olk.exe', 'outlook')).toBe(false)
  })

  it("builds Thunderbird's compose argument", () => {
    expect(
      thunderbirdComposeArg(
        { ...draft, subject: "Rechnung 1040 – Rock'n'Roll, live" },
        'C:\\E-Mail\\Rechnung_1040.txt',
        'file:///C:/E-Mail/Rechnung_1040.pdf'
      )
    ).toBe(
      "to='buchhaltung@veranstalter.example',subject='Rechnung 1040 – Rock’n’Roll, live'," +
        "message='C:\\E-Mail\\Rechnung_1040.txt',attachment='file:///C:/E-Mail/Rechnung_1040.pdf'"
    )
    expect(thunderbirdComposeArg({ ...draft, to: '' }, 'a.txt', 'file:///a.pdf')).not.toContain(
      'to='
    )
  })
})
