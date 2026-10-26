// I7: sending an invoice from bookingum's own editor - the token registry (MR-21), the
// sending account (MR-12), the PDF that must be there (MR-14), and an invoice that counts
// as emailed exactly once, also when an unclear send is confirmed later (H3).
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { container } from 'tsyringe'
import { InvoiceService } from '../src/main/services/InvoiceService'
import { CompanyService } from '../src/main/services/CompanyService'
import {
  confirmInvoiceSendFromOp,
  createInvoiceComposeRegistry,
  invoiceSendAccount,
  sendInvoiceMail,
  sendKeyOf,
  type InvoiceCompose,
  type InvoiceSendLedger
} from '../src/main/mail/invoiceSend'
import { SendInvoiceMailInput } from '../src/main/api/schemas/invoice.schema'
import type { MailAccountDto } from '../src/main/mailclient/accounts'
import type { DraftInput, OpSummary } from '../src/main/mailclient/core/types'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const account = (overrides: Partial<MailAccountDto> = {}): MailAccountDto => ({
  id: 'sandbox-1',
  kind: 'sandbox',
  host: '127.0.0.1',
  port: 3143,
  security: 'none',
  user: 'bookingum-e2e',
  email: 'bookingum-e2e@example.test',
  smtpHost: '127.0.0.1',
  smtpPort: 1025,
  smtpSecurity: 'none',
  canary: false,
  ...overrides
})

describe('invoiceSendAccount (MR-12)', () => {
  const to = 'buchhaltung@club.example.test'

  it('takes the chosen account', () => {
    const chosen = account({ id: 'b' })
    expect(invoiceSendAccount('b', [account({ id: 'a' }), chosen], to)).toEqual({
      account: chosen
    })
  })

  it('refuses when none is chosen, even with a writable account at hand', () => {
    expect(invoiceSendAccount('', [account()], to)).toEqual({
      error: expect.stringContaining('Kein Absenderkonto gewählt')
    })
  })

  it('refuses a chosen account that was deleted', () => {
    expect(invoiceSendAccount('gone', [account()], to)).toEqual({
      error: expect.stringContaining('gibt es nicht mehr')
    })
  })

  it('refuses a production account, which is read-only', () => {
    const prod = account({ id: 'prod', kind: 'production-readonly' })
    expect(invoiceSendAccount('prod', [prod], to)).toEqual({
      error: expect.stringContaining('schreibgeschützt')
    })
  })

  it('refuses the canary for anyone but its own address', () => {
    const canary = account({ id: 'c', host: 'imap.example.test', canary: true })
    expect(invoiceSendAccount('c', [canary], to)).toEqual({
      error: expect.stringContaining('nur an die eigene Adresse')
    })
    expect(invoiceSendAccount('c', [canary], 'bookingum-e2e@example.test')).toEqual({
      account: canary
    })
  })
})

describe('sendKeyOf', () => {
  it('is the local part of the Message-ID, with or without brackets', () => {
    expect(sendKeyOf('<key-1@example.test>')).toBe('key-1')
    expect(sendKeyOf('key-1@example.test')).toBe('key-1')
    expect(sendKeyOf('no-domain')).toBe('')
  })
})

const compose = (overrides: Partial<InvoiceCompose> = {}): InvoiceCompose => ({
  invoiceId: 7,
  kind: 'invoice',
  accountId: 'sandbox-1',
  pdfPath: 'C:/data/Rechnung-7.pdf',
  fileName: 'Rechnung-7.pdf',
  ...overrides
})

describe('the compose registry (MR-21)', () => {
  it('gives a window its compose only for the account it was opened with', () => {
    const registry = createInvoiceComposeRegistry(() => 'tok')
    const token = registry.register(compose())
    expect(registry.get(token, 'sandbox-1')?.pdfPath).toBe('C:/data/Rechnung-7.pdf')
    expect(registry.get(token, 'other')).toBeUndefined()
    expect(registry.get('made-up', 'sandbox-1')).toBeUndefined()
  })

  it('forgets the token when the window closes, and reports whether the mail went out', () => {
    let n = 0
    const registry = createInvoiceComposeRegistry(() => `tok-${++n}`)
    const sent = registry.register(compose())
    const unsent = registry.register(compose())
    registry.noteSend(sent, 'key-1')
    registry.confirmed('key-1', 'key-1@example.test')
    expect(registry.release(sent)).toEqual({ sent: true, messageId: 'key-1@example.test' })
    expect(registry.release(unsent)).toEqual({ sent: false })
    expect(registry.get(sent, 'sandbox-1')).toBeUndefined()
  })
})

const mail = (overrides: Partial<DraftInput> = {}): DraftInput =>
  ({
    to: [{ name: '', email: 'buchhaltung@club.example.test' }],
    cc: [],
    bcc: [],
    subject: 'Rechnung',
    text: 'Grüße',
    attachments: [],
    sendKey: 'key-1',
    ...overrides
  }) as DraftInput

/** A ledger that records what happened, for the flow tests */
function fakeLedger() {
  const calls: string[] = []
  const ledger: InvoiceSendLedger = {
    queueInvoiceEmail: (input) => void calls.push(`queue ${input.sendKey}`),
    dropQueuedInvoiceEmail: (key) => void calls.push(`drop ${key}`),
    hasQueuedInvoiceEmails: () => true,
    confirmInvoiceEmail: (key, accountId, messageId) => {
      calls.push(`confirm ${key} ${accountId} ${messageId}`)
      return 7
    }
  }
  return { ledger, calls }
}

describe('sendInvoiceMail', () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46])

  function setup(
    send: (mail: DraftInput) => Promise<{ messageId: string }>,
    readPdf: () => Promise<Uint8Array> = async () => PDF
  ) {
    const registry = createInvoiceComposeRegistry(() => 'tok')
    const token = registry.register(compose())
    const { ledger, calls } = fakeLedger()
    const sendSpy = vi.fn(send)
    const run = (input: Partial<{ token: string; accountId: string; mail: DraftInput }> = {}) =>
      sendInvoiceMail(
        { registry, ledger, readPdf, send: sendSpy },
        { token, accountId: 'sandbox-1', draftUid: null, mail: mail(), ...input }
      )
    return { registry, token, calls, sendSpy, run }
  }

  it('attaches the registered PDF, sends, and marks the invoice once', async () => {
    const { calls, sendSpy, run, registry, token } = setup(async () => ({
      messageId: 'key-1@example.test'
    }))
    await expect(run()).resolves.toEqual({ messageId: 'key-1@example.test' })
    const attachments = sendSpy.mock.calls[0][0].attachments ?? []
    expect(attachments).toEqual([
      {
        filename: 'Rechnung-7.pdf',
        contentType: 'application/pdf',
        base64: Buffer.from(PDF).toString('base64')
      }
    ])
    expect(calls).toEqual(['queue key-1', 'confirm key-1 sandbox-1 key-1@example.test'])
    expect(registry.release(token)).toEqual({ sent: true, messageId: 'key-1@example.test' })
  })

  it('refuses a token it never issued, and one of another account', async () => {
    const { run, sendSpy } = setup(async () => ({ messageId: 'x@y' }))
    await expect(run({ token: 'made-up' })).rejects.toThrow(/keiner geöffneten Rechnung/)
    await expect(run({ accountId: 'other' })).rejects.toThrow(/keiner geöffneten Rechnung/)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('stops when the PDF is gone instead of mailing an invoice without it (MR-14)', async () => {
    const { run, sendSpy, calls } = setup(
      async () => ({ messageId: 'x@y' }),
      async () => {
        throw new Error('ENOENT')
      }
    )
    await expect(run()).rejects.toThrow(/Rechnungs-PDF fehlt/)
    expect(sendSpy).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('stops on an empty PDF (MR-14)', async () => {
    const { run, sendSpy } = setup(
      async () => ({ messageId: 'x@y' }),
      async () => new Uint8Array()
    )
    await expect(run()).rejects.toThrow(/Rechnungs-PDF ist leer/)
    expect(sendSpy).not.toHaveBeenCalled()
  })

  it('drops the pending send when the server refused it', async () => {
    const { run, calls } = setup(async () => {
      throw new Error('Senden fehlgeschlagen: 550 rejected')
    })
    await expect(run()).rejects.toThrow(/Senden fehlgeschlagen/)
    expect(calls).toEqual(['queue key-1', 'drop key-1'])
  })

  it('keeps the pending send when the outcome is unclear, so a later check can confirm it (H3)', async () => {
    const { run, calls, registry, token } = setup(async () => {
      throw new Error('Versand unklar, bitte im Ordner Gesendet prüfen')
    })
    await expect(run()).rejects.toThrow(/Versand unklar/)
    expect(calls).toEqual(['queue key-1'])
    expect(registry.release(token)).toEqual({ sent: false })
  })
})

describe('SendInvoiceMailInput', () => {
  it('hands the mail on as the editor built it, recipient names included', () => {
    const mail = {
      to: [{ name: 'Veranstalter', email: 'booking@example.test' }],
      cc: [{ name: 'Kopie', email: 'cc@example.test' }],
      bcc: [],
      subject: 'Rechnung',
      bodyText: 'Grüße',
      bodyHtml: null,
      attachments: [],
      sendKey: 'key-1'
    }
    const input = { token: 'tok-1', accountId: 'sandbox-1', draftUid: null, mail }
    expect(SendInvoiceMailInput.parse(input)).toEqual(input)
  })

  it('refuses a mail without recipients list', () => {
    expect(() =>
      SendInvoiceMailInput.parse({ token: 't', accountId: 'a', draftUid: null, mail: {} })
    ).toThrow()
  })
})

describe('confirmInvoiceSendFromOp (H3)', () => {
  const op = (overrides: Partial<OpSummary> = {}) =>
    ({ id: 'op-1', kind: 'send', messageId: '<key-1@example.test>', ...overrides }) as OpSummary
  const event = {
    type: 'op-event',
    accountId: 'sandbox-1',
    opId: 'op-1',
    kind: 'send',
    outcome: 'done'
  }

  function setup(ops: OpSummary[], queued = true) {
    const registry = createInvoiceComposeRegistry(() => 'tok')
    const token = registry.register(compose())
    registry.noteSend(token, 'key-1')
    const { ledger, calls } = fakeLedger()
    ledger.hasQueuedInvoiceEmails = () => queued
    const listOps = vi.fn(async () => ops)
    const run = (e: object) => confirmInvoiceSendFromOp({ registry, ledger, listOps }, e)
    return { registry, token, calls, listOps, run }
  }

  it('confirms a send the core settled later, and the open window learns of it', async () => {
    const { run, calls, registry, token } = setup([op()])
    await run(event)
    expect(calls).toEqual(['confirm key-1 sandbox-1 key-1@example.test'])
    expect(registry.release(token)).toEqual({ sent: true, messageId: 'key-1@example.test' })
  })

  it('confirms on noop, the outcome of a probe that found the mail in Sent', async () => {
    const { run, calls } = setup([op()])
    await run({ ...event, outcome: 'noop' })
    expect(calls).toHaveLength(1)
  })

  it('ignores failed or unclear sends, other ops and other event types', async () => {
    const { run, calls, listOps } = setup([op()])
    await run({ ...event, outcome: 'failed' })
    await run({ ...event, outcome: 'unclear' })
    await run({ ...event, kind: 'move' })
    await run({ ...event, type: 'sync' })
    expect(calls).toEqual([])
    expect(listOps).not.toHaveBeenCalled()
  })

  it('does not look up the op when nothing is pending for the account', async () => {
    const { run, listOps } = setup([op()], false)
    await run(event)
    expect(listOps).not.toHaveBeenCalled()
  })

  it('does nothing for an op it cannot find or one without a Message-ID', async () => {
    const missing = setup([op({ id: 'op-2' })])
    await missing.run(event)
    expect(missing.calls).toEqual([])
    const bare = setup([op({ messageId: null } as Partial<OpSummary>)])
    await bare.run(event)
    expect(bare.calls).toEqual([])
  })
})

describe('the pending invoice mail (InvoiceService)', () => {
  async function issuedInvoice() {
    const company = await container.resolve(CompanyService).createCompany({
      name: 'Pending Issuer GmbH',
      isDefaultForInvoicing: false
    })
    const invoices = container.resolve(InvoiceService)
    const invoice = await invoices.createInvoice({
      companyId: company.id,
      status: 'issued',
      lineItems: [
        { description: 'A', quantity: 1, unitPriceNet: 100, taxRate: 19, taxCode: 'standard' }
      ]
    })
    return { invoices, invoice }
  }

  const queue = (invoices: InvoiceService, invoiceId: number, sendKey: string) =>
    invoices.queueInvoiceEmail({
      invoiceId,
      kind: 'invoice',
      to: 'buchhaltung@club.example.test',
      mailAccountId: 'sandbox-1',
      sendKey
    })

  it('is not emailed while pending, and is emailed once when confirmed', async () => {
    const { invoices, invoice } = await issuedInvoice()
    queue(invoices, invoice.id, 'key-a')
    expect(invoices.hasQueuedInvoiceEmails('sandbox-1')).toBe(true)
    expect((await invoices.getInvoiceById(invoice.id))?.emails).toEqual([])

    expect(invoices.confirmInvoiceEmail('key-a', 'sandbox-1', 'key-a@example.test')).toBe(
      invoice.id
    )
    // The send itself and the op-event both confirm; only the first one counts
    expect(invoices.confirmInvoiceEmail('key-a', 'sandbox-1', 'key-a@example.test')).toBeNull()

    const emails = (await invoices.getInvoiceById(invoice.id))?.emails ?? []
    expect(emails).toHaveLength(1)
    expect(emails[0]).toMatchObject({
      kind: 'invoice',
      to: 'buchhaltung@club.example.test',
      message_id: 'key-a@example.test',
      mail_account_id: 'sandbox-1'
    })
    expect(invoices.hasQueuedInvoiceEmails('sandbox-1')).toBe(false)
  })

  it('confirms only for the account it was sent from', async () => {
    const { invoices, invoice } = await issuedInvoice()
    queue(invoices, invoice.id, 'key-b')
    expect(invoices.confirmInvoiceEmail('key-b', 'other', 'key-b@example.test')).toBeNull()
    expect(invoices.hasQueuedInvoiceEmails('other')).toBe(false)
    expect(invoices.confirmInvoiceEmail('key-b', 'sandbox-1', 'key-b@example.test')).toBe(
      invoice.id
    )
  })

  it('a refused send leaves nothing to confirm', async () => {
    const { invoices, invoice } = await issuedInvoice()
    queue(invoices, invoice.id, 'key-c')
    invoices.dropQueuedInvoiceEmail('key-c')
    expect(invoices.confirmInvoiceEmail('key-c', 'sandbox-1', 'key-c@example.test')).toBeNull()
    expect((await invoices.getInvoiceById(invoice.id))?.emails).toEqual([])
  })

  it('a second send under the same key is the same mail', async () => {
    const { invoices, invoice } = await issuedInvoice()
    queue(invoices, invoice.id, 'key-d')
    expect(() => queue(invoices, invoice.id, 'key-d')).not.toThrow()
    invoices.confirmInvoiceEmail('key-d', 'sandbox-1', 'key-d@example.test')
    expect((await invoices.getInvoiceById(invoice.id))?.emails).toHaveLength(1)
  })
})
