// #225: receipts (Belege) - reading a file, storing it (photos as PDF), naming it, the list with
// its filters, and the DATEV bookkeeping for receipts next to invoices.
import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { container } from 'tsyringe'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PDFDocument } from 'pdf-lib'
import { embedFacturX } from '../src/main/einvoice/facturx'
import { ReceiptService, UNSUPPORTED_RECEIPT_FILE } from '../src/main/services/ReceiptService'
import { CompanyService } from '../src/main/services/CompanyService'
import { DatevService } from '../src/main/services/DatevService'
import { ReceiptMapper } from '../src/main/api/mappers/receipt.mapper'
import {
  receiptFileKind,
  receiptFileName,
  suggestReceiptName
} from '../src/main/receipts/receiptFiles'
import { receiptDatevMail, sendDatevMail, type DatevSendLedger } from '../src/main/mail/datevSend'
import { setStorageBasePath } from '../src/main/utils/fileStorage'
import type { ReceiptFields } from '../src/main/api/schemas/receipt.schema'
import { setupTestDb } from './helpers/setup'
import { CII_INVOICE } from './helpers/receivedEInvoices'

setupTestDb()

let storage: string
beforeAll(() => {
  storage = join(mkdtempSync(join(tmpdir(), 'bookingum-receipts-')), 'storage')
  setStorageBasePath(storage)
})
afterAll(() => {
  setStorageBasePath(null)
  rmSync(join(storage, '..'), { recursive: true, force: true })
})

// A 1×1 PNG
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
)

async function plainPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage()
  return doc.save()
}

const fields = (overrides: Partial<ReceiptFields> = {}): ReceiptFields => ({
  companyId: null,
  category: 'incoming',
  receiptDate: '2026-11-03',
  amountCents: 1190,
  currency: 'EUR',
  supplierCompanyId: null,
  supplierName: 'Hotel Beispiel',
  reference: 'H-17',
  notes: '',
  fileName: 'Hotel',
  ...overrides
})

describe('receipt files', () => {
  it('tells the kind by the first bytes', async () => {
    expect(receiptFileKind(await plainPdf())).toBe('pdf')
    expect(receiptFileKind(PNG)).toBe('png')
    expect(receiptFileKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(receiptFileKind(new TextEncoder().encode('\uFEFF  <x/>'))).toBe('xml')
    expect(receiptFileKind(new TextEncoder().encode('Hallo'))).toBeNull()
  })

  it('makes names safe and keeps the stored extension', () => {
    expect(receiptFileName('Hotel: März/Zimmer?', 'pdf')).toBe('Hotel März Zimmer.pdf')
    expect(receiptFileName('foto.jpg', 'pdf')).toBe('foto.pdf')
    expect(receiptFileName('  ', 'xml')).toBe('Beleg.xml')
    expect(
      suggestReceiptName({
        receiptDate: '2026-11-03',
        supplierName: 'Hotel Beispiel',
        reference: 'H-17',
        categoryLabel: 'Kreditkartenbelege'
      })
    ).toBe('2026-11-03 Hotel Beispiel H-17 Kreditkartenbelege')
  })
})

describe('receipts', () => {
  const receipts = container.resolve(ReceiptService)
  const companies = container.resolve(CompanyService)
  const datev = container.resolve(DatevService)
  let ownId: number

  beforeAll(async () => {
    const own = await companies.createCompany({
      name: 'Agentur Beispiel',
      isDefaultForInvoicing: true
    })
    ownId = own.id
  })

  it('reads an e-invoice PDF: date, amount, number and supplier come from the XML', async () => {
    const pdf = await embedFacturX(await plainPdf(), CII_INVOICE, { title: 'Rechnung' })
    const draft = await receipts.read(pdf, 'Rechnung.pdf')
    expect(draft.isEInvoice).toBe(true)
    expect(draft.fields).toMatchObject({
      category: 'incoming',
      receiptDate: '2026-11-03',
      amountCents: 119000,
      currency: 'EUR',
      supplierName: 'Bühnentechnik Beispiel GmbH & Co. KG',
      reference: 'RE-2026-0042',
      fileName: '2026-11-03 Bühnentechnik Beispiel GmbH & Co. KG RE-2026-0042 Rechnungseingang'
    })
    expect(draft.supplierMatch).toBeNull()
  })

  it('reads a plain PDF or a photo with only the file name filled', async () => {
    const draft = await receipts.read(PNG, 'Tankbeleg.png')
    expect(draft).toMatchObject({ isEInvoice: false, isImage: true })
    expect(draft.fields).toMatchObject({
      fileName: 'Tankbeleg',
      amountCents: null,
      receiptDate: null
    })
    await expect(receipts.read(new TextEncoder().encode('Hallo'), 'x.txt')).rejects.toThrow(
      UNSUPPORTED_RECEIPT_FILE
    )
    await expect(receipts.read(new TextEncoder().encode('<a/>'), 'x.xml')).rejects.toThrow(
      'keine E-Rechnung'
    )
  })

  it('stores a photo as a one-page PDF under the default company', async () => {
    const id = await receipts.create(fields({ fileName: 'Tankbeleg.png' }), PNG, null)
    const row = receipts.getById(id)!
    expect(row.receipt.company_id).toBe(ownId)
    expect(row.receipt.file_name).toBe('Tankbeleg.pdf')
    expect(row.receipt.file_path.replace(/\\/g, '/')).toBe('receipts/2026-11/Tankbeleg.pdf')
    const stored = readFileSync(join(storage, row.receipt.file_path))
    const doc = await PDFDocument.load(stored)
    expect(doc.getPageCount()).toBe(1)
    expect(ReceiptMapper.toDto(row)).toMatchObject({
      companyName: 'Agentur Beispiel',
      supplierName: 'Hotel Beispiel',
      datev: 'none',
      fromMail: false
    })
  })

  it('keeps another own company when one is picked, and renames without touching the file', async () => {
    const other = await companies.createCompany({ name: 'Zweite Firma' })
    const id = await receipts.create(
      fields({ companyId: other.id, fileName: 'Zug', category: 'credit_card' }),
      await plainPdf(),
      { messageId: '<m1@example.test>', mailAccountId: 'acc-1' }
    )
    const before = receipts.getById(id)!.receipt
    expect(before.company_id).toBe(other.id)
    expect(before.source_mail_account_id).toBe('acc-1')

    receipts.update({
      id,
      ...fields({ companyId: null, category: 'credit_card' }),
      fileName: 'Bahn Berlin'
    })
    const after = receipts.getById(id)!.receipt
    expect(after.file_name).toBe('Bahn Berlin.pdf')
    expect(after.file_path).toBe(before.file_path)
    // "Default" in the form keeps the stored company
    expect(after.company_id).toBe(other.id)
    expect(existsSync(join(storage, after.file_path))).toBe(true)
  })

  it('lists with search and filters, newest receipt date first', async () => {
    await receipts.create(
      fields({ receiptDate: '2026-10-01', fileName: 'Alt', supplierName: 'Taxi' }),
      await plainPdf(),
      null
    )
    const all = receipts.list({ page: 1, pageSize: 50 })
    expect(all.items.map((r) => r.receipt.receipt_date)).toEqual(
      [...all.items.map((r) => r.receipt.receipt_date)].sort().reverse()
    )
    expect(
      receipts.list({ page: 1, pageSize: 50, search: 'taxi' }).items.map((r) => r.receipt.file_name)
    ).toEqual(['Alt.pdf'])
    expect(receipts.list({ page: 1, pageSize: 50, category: 'credit_card' }).total).toBe(1)
  })

  it('lists receipts of companies with a DATEV address for their category until handed over', async () => {
    const id = await receipts.create(fields({ fileName: 'Offen' }), await plainPdf(), null)
    const pending = () => receipts.listNotHandedOver().map((row) => row.receipt.id)
    expect(pending()).toEqual([])

    // An address for another category does not count
    await datev.setUploadEmail({
      companyId: ownId,
      category: 'cash',
      datevUploadEmail: 'kasse@duo.example.test'
    })
    expect(pending()).toEqual([])
    await datev.setUploadEmail({
      companyId: ownId,
      category: 'incoming',
      datevUploadEmail: 'eingang@duo.example.test'
    })
    expect(pending()).toContain(id)

    datev.addPending({
      receiptId: id,
      category: 'incoming',
      to: 'eingang@duo.example.test',
      fileName: 'Offen.pdf',
      mailAccountId: 'acc-1',
      sendKey: 'receipt-key-1'
    })
    expect(pending()).not.toContain(id)
    expect(ReceiptMapper.toDto(receipts.getById(id)!).datev).toBe('pending')
    datev.confirm('receipt-key-1', 'acc-1', '<receipt-key-1@example.test>')
    expect(ReceiptMapper.toDto(receipts.getById(id)!).datev).toBe('sent')
    expect(
      receipts.list({ page: 1, pageSize: 50, notSent: true }).items.map((r) => r.receipt.id)
    ).not.toContain(id)
    expect(receipts.listTransfers(id)).toHaveLength(1)
  })
})

describe('the DATEV mail of a receipt', () => {
  const receipt = {
    categoryLabel: 'Kreditkartenbelege',
    receiptDate: '2026-11-03',
    amountCents: 12345,
    currency: 'EUR',
    supplierName: 'Hotel Beispiel',
    reference: 'H-17'
  }

  it('carries the one file and names category, supplier, date and amount', () => {
    const mail = receiptDatevMail({
      receipt,
      to: 'kk@duo.example.test',
      fileName: 'Hotel.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
      sendKey: 'k'
    })
    expect(mail.subject).toBe('Kreditkartenbelege – Hotel Beispiel – H-17')
    expect(mail.bodyText).toContain('Belegdatum: 03.11.2026')
    expect(mail.bodyText).toContain('123,45')
    expect(mail.attachments).toHaveLength(1)
    expect(mail.attachments[0]).toMatchObject({
      filename: 'Hotel.pdf',
      contentType: 'application/pdf'
    })
  })

  it('records the receipt, not an invoice, and refuses a mail naming both or neither', async () => {
    const added: Parameters<DatevSendLedger['addPending']>[0][] = []
    const ledger: DatevSendLedger = {
      addPending: (input) => void added.push(input),
      dropPending: vi.fn(),
      hasPending: () => true,
      confirm: () => null
    }
    const mail = receiptDatevMail({
      receipt,
      to: 'kk@duo.example.test',
      fileName: 'Hotel.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array([37, 80, 68, 70]),
      sendKey: 'k2'
    })
    const send = vi.fn(async () => ({ messageId: '<k2@example.test>' }))
    await sendDatevMail(
      { ledger, send },
      { receiptId: 5, category: 'credit_card', accountId: 'a', mail }
    )
    expect(added[0]).toMatchObject({ receiptId: 5, invoiceId: undefined, category: 'credit_card' })

    await expect(
      sendDatevMail({ ledger, send }, { category: 'credit_card', accountId: 'a', mail })
    ).rejects.toThrow('genau einen Beleg')
    await expect(
      sendDatevMail(
        { ledger, send },
        { invoiceId: 1, receiptId: 5, category: 'credit_card', accountId: 'a', mail }
      )
    ).rejects.toThrow('genau einen Beleg')
  })
})
