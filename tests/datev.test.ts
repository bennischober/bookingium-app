// DATEV hand-over by DATEV Upload Mail: the mail (one PDF to the company's upload address),
// the exactly-once bookkeeping of its send (pending, confirmed once, dropped when refused,
// kept when unclear), the upload address per issuing company.
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { container } from 'tsyringe'
import { CompanyService } from '../src/main/services/CompanyService'
import { DatevService } from '../src/main/services/DatevService'
import { InvoiceService } from '../src/main/services/InvoiceService'
import {
  confirmDatevSendFromOp,
  datevMail,
  datevRefusal,
  datevSubject,
  sendDatevMail,
  type DatevSendLedger
} from '../src/main/mail/datevSend'
import { SetDatevUploadEmailInput, type DatevCategory } from '../src/main/api/schemas/datev.schema'
import { DatevMapper } from '../src/main/api/mappers/datev.mapper'
import { InvoiceMapper } from '../src/main/api/mappers/invoice.mapper'
import type { InvoicePrintDto } from '../src/main/api/schemas/invoice.schema'
import type { DraftInput, OpSummary } from '../src/main/mailclient/core/types'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const PDF = new Uint8Array([37, 80, 68, 70])

function printData(overrides: Partial<InvoicePrintDto['invoice']> = {}): InvoicePrintDto {
  return {
    invoice: {
      invoiceNumber: 1040,
      kind: 'invoice',
      status: 'issued',
      issueDate: '2026-11-02',
      totalGrossAmount: 4200,
      currency: 'EUR',
      recipientName: 'Club Nord',
      ...overrides
    } as InvoicePrintDto['invoice'],
    issuer: null,
    recipient: null,
    venueName: null,
    eventDate: null,
    managementShare: null,
    bandName: null
  }
}

describe('the DATEV mail', () => {
  it('carries exactly the one PDF, to the upload address, without a letter around it', () => {
    const mail = datevMail({
      data: printData(),
      to: 'upload@duo.example.test',
      fileName: 'Rechnung_1040_Club Nord.pdf',
      pdf: PDF,
      sendKey: 'key-1'
    })
    expect(mail.to).toEqual([{ name: '', email: 'upload@duo.example.test' }])
    expect(mail.cc).toEqual([])
    expect(mail.subject).toBe('Rechnung 1040 – Club Nord')
    expect(mail.bodyText).toContain('Rechnungsdatum: 02.11.2026')
    expect(mail.bodyText).toMatch(/Betrag: 4\.200,00\s€/)
    expect(mail.attachments).toEqual([
      {
        filename: 'Rechnung_1040_Club Nord.pdf',
        contentType: 'application/pdf',
        base64: Buffer.from(PDF).toString('base64')
      }
    ])
    expect(mail.sendKey).toBe('key-1')
  })

  it('names a Stornorechnung as such', () => {
    expect(datevSubject(printData({ kind: 'cancellation', invoiceNumber: 1041 }))).toBe(
      'Stornorechnung 1041 – Club Nord'
    )
  })

  it('refuses a draft: it has no number and is not a document yet', () => {
    expect(datevRefusal(printData({ status: 'draft', invoiceNumber: null }).invoice)).toMatch(
      /Entwurf/
    )
    expect(datevRefusal(printData({ status: 'paid' }).invoice)).toBeNull()
    expect(datevRefusal(printData({ status: 'cancelled' }).invoice)).toBeNull()
  })
})

describe('sendDatevMail', () => {
  function setup(send: (mail: DraftInput, accountId: string) => Promise<{ messageId: string }>) {
    const calls: string[] = []
    const ledger: DatevSendLedger = {
      addPending: (input) =>
        calls.push(`pending ${input.sendKey} ${input.category} ${input.to} ${input.fileName}`),
      dropPending: (key) => calls.push(`drop ${key}`),
      hasPending: () => true,
      confirm: (key, accountId, messageId) => {
        calls.push(`confirm ${key} ${accountId} ${messageId}`)
        return 7
      }
    }
    const sendSpy = vi.fn(send)
    const mail = datevMail({
      data: printData(),
      to: 'upload@duo.example.test',
      fileName: 'R.pdf',
      pdf: PDF,
      sendKey: 'key-1'
    })
    const run = (overrides: Partial<DraftInput> = {}) =>
      sendDatevMail(
        { ledger, send: sendSpy },
        {
          invoiceId: 7,
          category: 'outgoing',
          accountId: 'sandbox-1',
          mail: { ...mail, ...overrides }
        }
      )
    return { calls, sendSpy, run }
  }

  it('records the send as pending first and confirms it once it is out', async () => {
    const { calls, run } = setup(async () => ({ messageId: '<key-1@example.test>' }))
    await expect(run()).resolves.toEqual({ messageId: '<key-1@example.test>' })
    expect(calls).toEqual([
      'pending key-1 outgoing upload@duo.example.test R.pdf',
      'confirm key-1 sandbox-1 key-1@example.test'
    ])
  })

  it('refuses a mail without exactly one PDF: DATEV files each mail as one document', async () => {
    const { run, sendSpy } = setup(async () => ({ messageId: 'x@y' }))
    await expect(run({ attachments: [] })).rejects.toThrow(/genau ein PDF/)
    const pdf = { filename: 'a.pdf', contentType: 'application/pdf', base64: 'JVBERg==' }
    await expect(run({ attachments: [pdf, pdf] })).rejects.toThrow(/genau ein PDF/)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('refuses a mail without a send key: it could be delivered twice', async () => {
    const { run, sendSpy } = setup(async () => ({ messageId: 'x@y' }))
    await expect(run({ sendKey: null })).rejects.toThrow(/Sendeschlüssel/)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('drops the pending send when the server refused it', async () => {
    const { run, calls } = setup(async () => {
      throw new Error('Senden fehlgeschlagen: 550 rejected')
    })
    await expect(run()).rejects.toThrow(/Senden fehlgeschlagen/)
    expect(calls.at(-1)).toBe('drop key-1')
  })

  it('keeps the pending send when the outcome is unclear, so a later check can confirm it', async () => {
    const { run, calls } = setup(async () => {
      throw new Error('Versand unklar, bitte im Ordner Gesendet prüfen')
    })
    await expect(run()).rejects.toThrow(/Versand unklar/)
    expect(calls).toEqual(['pending key-1 outgoing upload@duo.example.test R.pdf'])
  })
})

describe('the DATEV hand-overs (DatevService)', () => {
  async function issuedInvoice() {
    const company = await container.resolve(CompanyService).createCompany({
      name: 'DATEV Issuer GmbH',
      isDefaultForInvoicing: false
    })
    const invoice = await container.resolve(InvoiceService).createInvoice({
      companyId: company.id,
      status: 'issued',
      lineItems: [
        { description: 'A', quantity: 1, unitPriceNet: 100, taxRate: 19, taxCode: 'standard' }
      ]
    })
    return { company, invoice, datev: container.resolve(DatevService) }
  }

  const pending = (
    datev: DatevService,
    invoiceId: number,
    sendKey: string,
    category: DatevCategory = 'outgoing'
  ) =>
    datev.addPending({
      invoiceId,
      category,
      to: 'upload@duo.example.test',
      fileName: 'R.pdf',
      mailAccountId: 'sandbox-1',
      sendKey
    })

  it('is pending until confirmed, and confirmed only once', async () => {
    const { invoice, datev } = await issuedInvoice()
    pending(datev, invoice.id, 'key-a')
    expect(datev.hasPending('sandbox-1')).toBe(true)
    expect(datev.listForInvoice(invoice.id)).toMatchObject([
      {
        status: 'pending',
        category: 'outgoing',
        sent_at: null,
        to: 'upload@duo.example.test',
        file_name: 'R.pdf'
      }
    ])

    expect(datev.confirm('key-a', 'sandbox-1', 'key-a@example.test')).toBe(invoice.id)
    expect(datev.confirm('key-a', 'sandbox-1', 'key-a@example.test')).toBeNull()
    const [row] = datev.listForInvoice(invoice.id)
    expect(row).toMatchObject({ status: 'sent', message_id: 'key-a@example.test' })
    expect(row.sent_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(datev.hasPending('sandbox-1')).toBe(false)
  })

  it('confirms only under the account it was sent from', async () => {
    const { invoice, datev } = await issuedInvoice()
    pending(datev, invoice.id, 'key-b')
    expect(datev.confirm('key-b', 'other-account', 'key-b@example.test')).toBeNull()
    expect(datev.listForInvoice(invoice.id)[0].status).toBe('pending')
  })

  it('forgets a refused send, but never a confirmed one', async () => {
    const { invoice, datev } = await issuedInvoice()
    pending(datev, invoice.id, 'key-c')
    datev.dropPending('key-c')
    expect(datev.listForInvoice(invoice.id)).toEqual([])

    pending(datev, invoice.id, 'key-d')
    datev.confirm('key-d', 'sandbox-1', 'key-d@example.test')
    datev.dropPending('key-d')
    expect(datev.listForInvoice(invoice.id)).toHaveLength(1)
  })

  it('keeps one row when the same send key is recorded twice', async () => {
    const { invoice, datev } = await issuedInvoice()
    pending(datev, invoice.id, 'key-e')
    pending(datev, invoice.id, 'key-e')
    expect(datev.listForInvoice(invoice.id)).toHaveLength(1)
  })

  it('stores the upload address per company, without touching its invoice numbering', async () => {
    const { company, datev } = await issuedInvoice()
    const invoices = container.resolve(InvoiceService)
    const numberBefore = (await invoices.getCompanyInvoiceSettings(company.id))?.next_invoice_number

    await datev.setUploadEmail({
      companyId: company.id,
      datevUploadEmail: 'upload@duo.example.test'
    })
    expect(await datev.uploadEmailOf(company.id)).toBe('upload@duo.example.test')
    expect((await invoices.getCompanyInvoiceSettings(company.id))?.next_invoice_number).toBe(
      numberBefore
    )

    await datev.setUploadEmail({ companyId: company.id, datevUploadEmail: '' })
    expect(await datev.uploadEmailOf(company.id)).toBe('')
  })

  it('keeps one upload address per DATEV category, Rechnungsausgang by default', async () => {
    const { company, datev } = await issuedInvoice()
    await datev.setUploadEmail({
      companyId: company.id,
      datevUploadEmail: 'ausgang@duo.example.test'
    })
    await datev.setUploadEmail({
      companyId: company.id,
      category: 'incoming',
      datevUploadEmail: 'eingang@duo.example.test'
    })
    expect(await datev.uploadEmailOf(company.id)).toBe('ausgang@duo.example.test')
    expect(await datev.uploadEmailOf(company.id, 'outgoing')).toBe('ausgang@duo.example.test')
    expect(await datev.uploadEmailOf(company.id, 'incoming')).toBe('eingang@duo.example.test')
    expect(await datev.uploadEmailOf(company.id, 'cash')).toBe('')
    const settings = await container.resolve(InvoiceService).getCompanyInvoiceSettings(company.id)
    expect(InvoiceMapper.toSettingsDto(settings!).datevUploadEmails).toEqual({
      outgoing: 'ausgang@duo.example.test',
      incoming: 'eingang@duo.example.test',
      cash: '',
      other: '',
      credit_card: ''
    })
    // Out of the "not handed over" list of the next tests (they share the database)
    await datev.setUploadEmail({ companyId: company.id, datevUploadEmail: '' })
  })

  it('records which category a hand-over went to', async () => {
    const { invoice, datev } = await issuedInvoice()
    pending(datev, invoice.id, 'key-cat', 'incoming')
    expect(datev.listForInvoice(invoice.id)).toMatchObject([{ category: 'incoming' }])
    expect(DatevMapper.toTransferDto(datev.listForInvoice(invoice.id)[0]).category).toBe('incoming')
  })

  it('gives a company without settings its row, starting the numbering at 1', async () => {
    const company = await container.resolve(CompanyService).createCompany({
      name: 'Fresh Issuer GmbH',
      isDefaultForInvoicing: false
    })
    const datev = container.resolve(DatevService)
    expect(await datev.uploadEmailOf(company.id)).toBe('')
    const row = await datev.setUploadEmail({
      companyId: company.id,
      datevUploadEmail: 'upload@duo.example.test'
    })
    expect(row).toMatchObject({
      next_invoice_number: 1,
      datev_upload_email: 'upload@duo.example.test'
    })
  })
})

describe('the invoices not handed to DATEV yet', () => {
  it('lists issued invoices of DATEV companies until a hand-over is under way', async () => {
    const companies = container.resolve(CompanyService)
    const invoices = container.resolve(InvoiceService)
    const datev = container.resolve(DatevService)
    const withDatev = await companies.createCompany({
      name: 'Pending DATEV GmbH',
      isDefaultForInvoicing: false
    })
    const without = await companies.createCompany({
      name: 'No DATEV GmbH',
      isDefaultForInvoicing: false
    })
    await datev.setUploadEmail({ companyId: withDatev.id, datevUploadEmail: 'u@duo.example.test' })
    const line = [
      {
        description: 'A',
        quantity: 1,
        unitPriceNet: 100,
        taxRate: 19,
        taxCode: 'standard' as const
      }
    ]
    const issued = await invoices.createInvoice({
      companyId: withDatev.id,
      status: 'issued',
      issueDate: '2026-11-02',
      lineItems: line
    })
    await invoices.createInvoice({ companyId: withDatev.id, lineItems: line }) // draft
    await invoices.createInvoice({ companyId: without.id, status: 'issued', lineItems: line })

    const pendingIds = () => datev.listNotHandedOver().map((row) => row.id)
    expect(pendingIds()).toEqual([issued.id])

    datev.addPending({
      invoiceId: issued.id,
      category: 'outgoing',
      to: 'u@duo.example.test',
      fileName: 'R.pdf',
      mailAccountId: 'sandbox-1',
      sendKey: 'key-list'
    })
    expect(pendingIds()).toEqual([])
  })
})

describe('SetDatevUploadEmailInput', () => {
  it('takes an address or nothing, trimmed', () => {
    expect(
      SetDatevUploadEmailInput.parse({
        companyId: 1,
        datevUploadEmail: ' upload@duo.example.test '
      })
    ).toEqual({ companyId: 1, category: 'outgoing', datevUploadEmail: 'upload@duo.example.test' })
    expect(SetDatevUploadEmailInput.parse({ companyId: 1, datevUploadEmail: '' })).toEqual({
      companyId: 1,
      category: 'outgoing',
      datevUploadEmail: ''
    })
    expect(
      SetDatevUploadEmailInput.parse({
        companyId: 1,
        category: 'credit_card',
        datevUploadEmail: 'karte@duo.example.test'
      }).category
    ).toBe('credit_card')
    expect(() =>
      SetDatevUploadEmailInput.parse({ companyId: 1, category: 'bank', datevUploadEmail: '' })
    ).toThrow()
    expect(() =>
      SetDatevUploadEmailInput.parse({ companyId: 1, datevUploadEmail: 'kein' })
    ).toThrow()
  })
})

describe('confirmDatevSendFromOp', () => {
  function setup(ops: OpSummary[], pendingFor = 'sandbox-1') {
    const confirmed: string[] = []
    const ledger: DatevSendLedger = {
      addPending: () => {},
      dropPending: () => {},
      hasPending: (accountId) => accountId === pendingFor,
      confirm: (key, accountId, messageId) => {
        confirmed.push(`${key} ${accountId} ${messageId}`)
        return 1
      }
    }
    return { confirmed, deps: { ledger, listOps: async () => ops } }
  }
  const op = { id: 'op-1', kind: 'send', messageId: '<key-9@example.test>' } as OpSummary
  const event = {
    type: 'op-event',
    accountId: 'sandbox-1',
    opId: 'op-1',
    kind: 'send',
    outcome: 'done'
  }

  it('confirms a pending hand-over once its send is settled as delivered', async () => {
    const { confirmed, deps } = setup([op])
    await confirmDatevSendFromOp(deps, event)
    expect(confirmed).toEqual(['key-9 sandbox-1 key-9@example.test'])
  })

  it('ignores other ops, other outcomes and accounts without pending hand-overs', async () => {
    const { confirmed, deps } = setup([op])
    await confirmDatevSendFromOp(deps, { ...event, kind: 'move' })
    await confirmDatevSendFromOp(deps, { ...event, outcome: 'unknown' })
    await confirmDatevSendFromOp(deps, { ...event, accountId: 'other' })
    expect(confirmed).toEqual([])
  })
})
