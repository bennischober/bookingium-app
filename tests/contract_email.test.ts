// #120: "Per E-Mail senden" of a contract - the recipient and values of either contract,
// the template filled per language, the language default, and the send of a contract
// from bookingum's own editor (attached like an invoice, nothing recorded).
import { describe, expect, it, vi } from 'vitest'
import {
  concertContractEmailData,
  contractEmail,
  contractEmailLang,
  managementContractEmailData
} from '../src/main/mail/contractEmail'
import { createInvoiceComposeRegistry, sendInvoiceMail } from '../src/main/mail/invoiceSend'
import { DEFAULT_CONTRACT_EMAIL, EMAIL_TEMPLATES } from '../src/main/api/schemas/settings.schema'
import type { ContractData, ContractParty } from '../src/main/api/schemas/contract.schema'
import type { ManagementContractPrintData } from '../src/main/api/schemas/management_contract.schema'
import type { DraftInput } from '../src/main/mailclient/core/types'

function party(overrides: Partial<ContractParty> = {}): ContractParty {
  return {
    id: 1,
    name: 'Beispiel Firma GmbH',
    street: 'Musterweg',
    streetNumber: '2',
    zipCode: '10115',
    city: 'Berlin',
    country: 'Deutschland',
    email: 'kontakt@firma.example.test',
    phone: '',
    vatNumber: '',
    ustNumber: '',
    taxNumber: '',
    kskNumber: '',
    bankName: '',
    accountHolder: '',
    iban: '',
    bic: '',
    signaturePath: '',
    representative: '',
    ...overrides
  }
}

const concert = (overrides: Partial<ContractData> = {}) =>
  ({
    dealMemo: { id: 3, name: 'Show', date: '2026-10-21' },
    band: { id: 1, name: 'Die Beispielband' },
    artist: party({ name: 'Beispielband GbR', email: 'band@example.test' }),
    representative: party({
      name: 'Beispiel Booking GmbH',
      representative: 'Erika Muster',
      email: 'booking@example.test'
    }),
    promoter: party({ name: 'Veranstalter GmbH', email: ' booking@club.example.test ' }),
    venue: { id: 2, name: 'Beispielhalle', city: 'Berlin' },
    ...overrides
  }) as unknown as ContractData

const management = (overrides: Partial<ManagementContractPrintData> = {}) =>
  ({
    contract: { id: 5, startDate: '2026-11-01' },
    band: { id: 1, name: 'Die Beispielband' },
    management: party({ name: 'Beispiel Management GmbH', representative: 'Max Muster' }),
    artist: party({ name: 'Beispielband GbR', email: 'band@example.test', country: 'AT' }),
    ...overrides
  }) as unknown as ManagementContractPrintData

describe('the contract email (#120)', () => {
  it('sends a concert contract to the promoter, from the representing agency', () => {
    const draft = contractEmail(
      concertContractEmailData(concert()),
      'de',
      DEFAULT_CONTRACT_EMAIL.de
    )
    expect(draft.to).toBe('booking@club.example.test')
    expect(draft.subject).toBe('Konzertvertrag – Die Beispielband – 21.10.2026')
    expect(draft.body).toContain('anbei erhalten Sie den Konzertvertrag für Die Beispielband.')
    expect(draft.body).toMatch(/Mit freundlichen Grüßen\nErika Muster$/)
  })

  it('signs as the artist when no agency represents it', () => {
    const data = concertContractEmailData(concert({ representative: null }))
    expect(contractEmail(data, 'de', DEFAULT_CONTRACT_EMAIL.de).body).toMatch(/\nBeispielband GbR$/)
  })

  it('sends a management contract to the band company, from the management, in English', () => {
    const draft = contractEmail(
      managementContractEmailData(management()),
      'en',
      DEFAULT_CONTRACT_EMAIL.en
    )
    expect(draft.to).toBe('band@example.test')
    expect(draft.subject).toBe('Management Agreement – Die Beispielband – 01.11.2026')
    expect(draft.body).toContain(
      'please find attached the Management Agreement for Die Beispielband.'
    )
    expect(draft.body).toMatch(/Kind regards\nMax Muster$/)
  })

  it('leaves no dangling separator for a missing date, and no address without a recipient', () => {
    const data = managementContractEmailData(
      management({ artist: null, contract: { id: 5, startDate: null } as never })
    )
    const draft = contractEmail(data, 'de', DEFAULT_CONTRACT_EMAIL.de)
    expect(draft.subject).toBe('Managementvertrag – Die Beispielband')
    expect(draft.to).toBe('')
  })

  it('fills every placeholder of a custom template; unknown ones stay', () => {
    const draft = contractEmail(concertContractEmailData(concert()), 'de', {
      subject: '{Dokument} {Veranstaltungsort} {Datum}',
      body: '{Empfänger}|{Absender}|{Band}|{Rechnungsnummer}'
    })
    expect(draft.subject).toBe('Konzertvertrag Beispielhalle 21.10.2026')
    expect(draft.body).toBe('Veranstalter GmbH|Erika Muster|Die Beispielband|{Rechnungsnummer}')
  })

  it('has a template per language in the settings', () => {
    expect(EMAIL_TEMPLATES.contract.de).toEqual({
      key: 'contractEmailDe',
      fallback: DEFAULT_CONTRACT_EMAIL.de
    })
    expect(EMAIL_TEMPLATES.contract.en.key).toBe('contractEmailEn')
  })
})

describe('contractEmailLang', () => {
  it('is German for German-speaking, empty and unrecognised countries, else English', () => {
    for (const country of [
      'DE',
      'Deutschland',
      'Österreich',
      'AT',
      'Schweiz',
      '',
      null,
      'Atlantis'
    ]) {
      expect(contractEmailLang(country)).toBe('de')
    }
    for (const country of ['UK', 'Niederlande', 'FR', 'USA']) {
      expect(contractEmailLang(country)).toBe('en')
    }
  })
})

describe('sending a contract from the own editor (#120)', () => {
  const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46])
  const mail = { to: [{ name: '', email: 'band@example.test' }], sendKey: 'key-9' } as DraftInput

  function setup(readPdf: () => Promise<Uint8Array> = async () => PDF) {
    const registry = createInvoiceComposeRegistry(() => 'tok')
    const token = registry.register({
      contract: 'management',
      accountId: 'sandbox-1',
      pdfPath: 'C:/data/Managementvertrag.pdf',
      fileName: 'Managementvertrag.pdf'
    })
    const ledger = {
      queueInvoiceEmail: vi.fn(),
      dropQueuedInvoiceEmail: vi.fn(),
      hasQueuedInvoiceEmails: vi.fn(() => false),
      confirmInvoiceEmail: vi.fn(() => null)
    }
    const send = vi.fn(async (sent: DraftInput) => ({
      messageId: `<${sent.sendKey}@example.test>`
    }))
    const run = () =>
      sendInvoiceMail(
        { registry, ledger, readPdf, send },
        { token, accountId: 'sandbox-1', draftUid: null, mail }
      )
    return { registry, token, ledger, send, run }
  }

  it('attaches the contract PDF, reports the send to the window and queues no invoice', async () => {
    const { registry, token, ledger, send, run } = setup()
    await run()
    expect(send.mock.calls[0][0].attachments).toEqual([
      {
        filename: 'Managementvertrag.pdf',
        contentType: 'application/pdf',
        base64: Buffer.from(PDF).toString('base64')
      }
    ])
    expect(ledger.queueInvoiceEmail).not.toHaveBeenCalled()
    expect(registry.release(token)).toEqual({ sent: true, messageId: 'key-9@example.test' })
  })

  it('stops when the contract PDF is gone', async () => {
    const { send, ledger, run } = setup(async () => {
      throw new Error('ENOENT')
    })
    await expect(run()).rejects.toThrow(/Vertrags-PDF fehlt/)
    expect(send).not.toHaveBeenCalled()
    expect(ledger.dropQueuedInvoiceEmail).not.toHaveBeenCalled()
  })
})
