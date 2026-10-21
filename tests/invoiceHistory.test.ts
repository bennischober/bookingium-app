// The Verlauf on the invoice page, built from the invoice's status changes and emails
import { describe, it, expect } from 'vitest'
import { invoiceHistory } from '../src/renderer/src/lib/invoiceHistory'
import { invoiceMomentLabel } from '../src/renderer/src/lib/invoiceLabels'

const base = {
  createdAt: '2026-10-01 08:00:00',
  kind: 'invoice' as const,
  statusChanges: [],
  emails: [],
  cancelsInvoiceId: null,
  cancelsInvoiceNumber: null,
  cancelledByInvoiceId: null,
  cancelledByInvoiceNumber: null
}

describe('invoiceHistory', () => {
  it('lists created, status changes and emails, oldest first', () => {
    const history = invoiceHistory({
      ...base,
      statusChanges: [
        { status: 'issued', createdAt: '2026-10-01' },
        { status: 'overdue', createdAt: '2026-10-20 09:00:00' },
        { status: 'issued', createdAt: '2026-10-20 09:05:00' },
        { status: 'paid', createdAt: '2026-10-22 10:00:00' },
        { status: 'cancelled', createdAt: '2026-10-23 10:00:00' }
      ],
      // latest first, as the invoice carries them
      emails: [
        { kind: 'dunning', createdAt: '2026-10-24 12:00:00', to: 'x@club.de' },
        { kind: 'reminder', createdAt: '2026-10-21 12:00:00', to: 'x@club.de' },
        { kind: 'invoice', createdAt: '2026-10-21 11:00:00', to: '' },
        { kind: 'invoice', createdAt: '2026-10-02 08:30:00', to: 'x@club.de' }
      ],
      cancelledByInvoiceId: 7,
      cancelledByInvoiceNumber: 1041
    })

    expect(history).toEqual([
      { at: '2026-10-01 08:00:00', label: 'Angelegt' },
      // a plain date counts as the start of its day, after Angelegt though
      { at: '2026-10-01', label: 'Gestellt' },
      { at: '2026-10-02 08:30:00', label: 'E-Mail erstellt', detail: 'an x@club.de' },
      { at: '2026-10-20 09:00:00', label: 'Als überfällig markiert' },
      { at: '2026-10-20 09:05:00', label: 'Wieder offen (gestellt)' },
      { at: '2026-10-21 11:00:00', label: 'E-Mail erstellt' },
      { at: '2026-10-21 12:00:00', label: 'Zahlungserinnerung erstellt', detail: 'an x@club.de' },
      { at: '2026-10-22 10:00:00', label: 'Als bezahlt markiert' },
      {
        at: '2026-10-23 10:00:00',
        label: 'Storniert',
        link: { invoiceId: 7, label: 'Stornorechnung #1041' }
      },
      { at: '2026-10-24 12:00:00', label: 'Mahnung erstellt', detail: 'an x@club.de' }
    ])
  })

  it('links a Stornorechnung to the invoice it cancels', () => {
    const history = invoiceHistory({
      ...base,
      kind: 'cancellation',
      statusChanges: [{ status: 'issued', createdAt: '2026-10-01 08:00:00' }],
      cancelsInvoiceId: 3,
      cancelsInvoiceNumber: 1040
    })
    expect(history[1]).toEqual({
      at: '2026-10-01 08:00:00',
      label: 'Gestellt als Storno zu',
      link: { invoiceId: 3, label: 'Rechnung #1040' }
    })
  })
})

describe('invoiceMomentLabel', () => {
  it('shows a plain date as a date, a datetime with the time', () => {
    expect(invoiceMomentLabel('2026-10-01')).toBe('01.10.2026')
    expect(invoiceMomentLabel('2026-10-01 08:00:00')).toMatch(/^01\.10\.2026, \d\d:00$/)
  })
})
