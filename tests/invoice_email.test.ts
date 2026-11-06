// "Per E-Mail senden": the email text from the template. #136: it opens in bookingum's own
// compose window only, so the .eml draft, the mailto: link and the mail programs are gone.
import { describe, it, expect } from 'vitest'
import {
  fillPlaceholders,
  invoiceEmail,
  invoiceEmailValues,
  recipientEmailOf
} from '../src/main/mail/invoiceEmail'
import {
  DEFAULT_DUNNING_EMAIL,
  DEFAULT_INVOICE_EMAIL,
  DEFAULT_REMINDER_EMAIL
} from '../src/main/api/schemas/settings.schema'
import {
  nextReminderKind,
  type InvoiceDto,
  type InvoicePrintDto
} from '../src/main/api/schemas/invoice.schema'
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
      email: 'info@veranstalter.example.test',
      contactEmail: 'buchhaltung@veranstalter.example.test'
    }),
    venueName: null,
    eventDate: null,
    managementShare: null,
    bandName: 'Pretty Wild',
    ...overrides
  } satisfies InvoicePrintDto
}

describe('invoice email text', () => {
  it('fills the default templates', () => {
    expect(invoiceEmail(printData(), 'de', DEFAULT_INVOICE_EMAIL.de)).toEqual({
      to: 'buchhaltung@veranstalter.example.test',
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

  it('fills the reminder templates, with a Frist a week from today', () => {
    // 28.10. plus 7 days crosses the month (and the end of summer time)
    const now = new Date(2026, 9, 28, 23, 30)
    const reminder = invoiceEmail(printData(), 'de', DEFAULT_REMINDER_EMAIL.de, now)
    expect(reminder.subject).toBe('Zahlungserinnerung: Rechnung 1040 – Pretty Wild')
    expect(reminder.body).toContain(
      'Unsere Rechnung 1040 vom 19.10.2026 über 2.675,00 € war am 02.11.2026 fällig. ' +
        'Bitte überweisen Sie den Betrag bis zum 04.11.2026.'
    )
    const dunning = invoiceEmail(printData(), 'en', DEFAULT_DUNNING_EMAIL.en, now)
    expect(dunning.subject).toBe('Overdue notice: Invoice 1040 – Pretty Wild')
    expect(dunning.body).toContain('by 04.11.2026 at the latest')
    expect(dunning.to).toBe('buchhaltung@veranstalter.example.test')
  })

  it('keeps unknown placeholders', () => {
    expect(fillPlaceholders('{Betrag} {Unbekannt} { Band }', { Betrag: '1 €', Band: 'X' })).toBe(
      '1 € {Unbekannt} X'
    )
  })

  it('sends to the contact email, else the general one', () => {
    expect(recipientEmailOf(printData())).toBe('buchhaltung@veranstalter.example.test')
    const general = printData({
      recipient: party({ email: ' info@veranstalter.example.test ', contactEmail: '' })
    })
    expect(recipientEmailOf(general)).toBe('info@veranstalter.example.test')
    expect(recipientEmailOf(printData({ recipient: null }))).toBe('')
  })
})

describe('payment reminders', () => {
  const open = {
    kind: 'invoice' as const,
    status: 'issued' as const,
    dueDate: '2026-10-01',
    emails: [{ kind: 'invoice' as const }]
  }

  it('first a Zahlungserinnerung, after it Mahnungen', () => {
    expect(nextReminderKind(open, '2026-10-02')).toBe('reminder')
    const reminded = { ...open, emails: [...open.emails, { kind: 'reminder' as const }] }
    expect(nextReminderKind({ ...reminded, status: 'overdue' }, '2026-10-02')).toBe('dunning')
    expect(
      nextReminderKind({ ...reminded, emails: [{ kind: 'dunning' as const }] }, '2026-10-02')
    ).toBe('dunning')
  })

  it('only for open invoices past their due date, or marked überfällig', () => {
    expect(nextReminderKind(open, '2026-10-01')).toBeNull()
    expect(nextReminderKind({ ...open, dueDate: null }, '2026-10-02')).toBeNull()
    expect(nextReminderKind({ ...open, dueDate: null, status: 'overdue' }, '2026-10-02')).toBe(
      'reminder'
    )
    for (const status of ['draft', 'paid', 'cancelled'] as const) {
      expect(nextReminderKind({ ...open, status }, '2026-10-02')).toBeNull()
    }
    expect(nextReminderKind({ ...open, kind: 'cancellation' }, '2026-10-02')).toBeNull()
  })
})
