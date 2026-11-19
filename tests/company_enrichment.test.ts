// #236: a known company with empty fields completed from an invoice it sent. A plain PDF's text
// is read for IBAN, VAT id, address and the like; the recipient's values (our own companies) are
// never taken; an e-invoice gives its data and people. Only empty fields are filled.
import 'reflect-metadata'
import { beforeAll, describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { readInvoiceText, validIban } from '../src/main/einvoice/invoiceText'
import { pdfText } from '../src/main/einvoice/pdfText'
import { CompanyEnrichmentService } from '../src/main/services/CompanyEnrichmentService'
import { CII_INVOICE } from './helpers/receivedEInvoices'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const INVOICE_LINES = [
  'BEISPIEL RECORDS GmbH - Beispielweg 12 - 50667 Koeln',
  'Tel.: +49 221 123456 - info@beispiel-records.example.com',
  'USt-IdNr. DE135792468 - St.-Nr. 214/5701/1234',
  'IBAN DE89 3704 0044 0532 0130 00 - BIC COBADEFFXXX',
  'Rechnung an: Eigene Agentur GmbH, Hauptweg 5, 10115 Berlin',
  'USt-IdNr. DE987654321 - IBAN DE02 1203 0000 0000 2020 51'
]

async function invoicePdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  lines.forEach((line, index) => page.drawText(line, { x: 30, y: 780 - index * 16, size: 9, font }))
  return doc.save()
}

describe('invoice text', () => {
  it('checks IBANs and reads the sender facts', () => {
    expect(validIban('DE89370400440532013000')).toBe(true)
    expect(validIban('DE89370400440532013001')).toBe(false)
    const facts = readInvoiceText(INVOICE_LINES.join('\n').replace(/ - /g, ' · '))
    expect(facts.ibans).toEqual(['DE89370400440532013000', 'DE02120300000000202051'])
    expect(facts.vatIds).toEqual(['DE135792468', 'DE987654321'])
    expect(facts.taxNumbers).toEqual(['214/5701/1234'])
    expect(facts.bics).toEqual(['COBADEFFXXX'])
    expect(facts.emails).toEqual(['info@beispiel-records.example.com'])
    expect(facts.phones).toEqual(['+49 221 123456'])
    expect(
      facts.addresses.map((a) => `${a.street} ${a.streetNumber}, ${a.zipCode} ${a.city}`)
    ).toEqual(['Beispielweg 12, 50667 Koeln', 'Hauptweg 5, 10115 Berlin'])
  })

  it('reads the text of a PDF', async () => {
    const text = await pdfText(await invoicePdf(INVOICE_LINES))
    expect(text).toContain('BEISPIEL RECORDS GmbH')
    expect(text).toContain('DE89 3704 0044 0532 0130 00')
  })
})

describe('completing a company from an invoice', () => {
  // Our side: the invoicing company with its own VAT id, IBAN and address
  beforeAll(() => {
    const ownBank = db
      .insert(schema.bank)
      .values({ bank_name: 'Eigene Bank', iban: 'DE02120300000000202051', bic: '' })
      .returning()
      .get()
    const ownAddress = db
      .insert(schema.address)
      .values({ street: 'Hauptweg', zip_code: '10115', city: 'Berlin' })
      .returning()
      .get()
    db.insert(schema.company)
      .values({
        name: 'Eigene Agentur GmbH',
        vat_id: 'DE987654321',
        bank_id: ownBank.id,
        address_id: ownAddress.id,
        is_default_for_invoicing: true
      })
      .run()
  })

  it('finds the sender by its name in a plain PDF and fills only what is empty', async () => {
    const service = container.resolve(CompanyEnrichmentService)
    const phone = db
      .insert(schema.contact)
      .values({ email: '', phone: '0221 999' })
      .returning()
      .get()
    const cargo = db
      .insert(schema.company)
      .values({ name: 'Beispiel Records GmbH', contact_id: phone.id })
      .returning()
      .get()

    const found = await service.checkBytes(await invoicePdf(INVOICE_LINES))
    expect(found).toMatchObject({ companyId: cargo.id, origin: 'pdf', matchedBy: 'name' })
    expect(found!.fills.map((fill) => [fill.label, fill.value])).toEqual([
      ['Adresse', 'Beispielweg 12, 50667 Koeln'],
      ['E-Mail', 'info@beispiel-records.example.com'],
      // the stored phone stays
      ['USt-IdNr.', 'DE135792468'],
      ['Steuernummer', '214/5701/1234'],
      ['IBAN', 'DE89 3704 0044 0532 0130 00'],
      ['BIC', 'COBADEFFXXX']
    ])

    service.apply(found!.companyId, found!.party)
    const row = db.select().from(schema.company).where(eq(schema.company.id, cargo.id)).get()!
    expect(row.vat_id).toBe('DE135792468')
    expect(row.tax_number).toBe('214/5701/1234')
    const contact = db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.id, row.contact_id!))
      .get()!
    expect(contact).toMatchObject({ email: 'info@beispiel-records.example.com', phone: '0221 999' })
    const bank = db.select().from(schema.bank).where(eq(schema.bank.id, row.bank_id!)).get()!
    expect(bank.iban.replace(/\s/g, '')).toBe('DE89370400440532013000')
    const address = db
      .select()
      .from(schema.address)
      .where(eq(schema.address.id, row.address_id!))
      .get()!
    expect(address).toMatchObject({ street: 'Beispielweg', zip_code: '50667', city: 'Koeln' })

    // now complete: the same invoice has nothing left to add
    expect(await service.checkBytes(await invoicePdf(INVOICE_LINES))).toBeNull()
  })

  it('says nothing for an invoice of no known company', async () => {
    const service = container.resolve(CompanyEnrichmentService)
    expect(
      await service.checkBytes(
        await invoicePdf(['Unbekannte Firma KG', 'IBAN DE75 5121 0800 1245 1261 99'])
      )
    ).toBeNull()
  })

  it('takes an e-invoice with its people, matched by name', async () => {
    const service = container.resolve(CompanyEnrichmentService)
    const company = db
      .insert(schema.company)
      .values({ name: 'Bühnentechnik Beispiel GmbH & Co. KG' })
      .returning()
      .get()
    const found = await service.checkBytes(new TextEncoder().encode(CII_INVOICE))
    expect(found).toMatchObject({ companyId: company.id, origin: 'einvoice' })
    expect(found!.fills.map((fill) => fill.label)).toContain('USt-IdNr.')
    service.apply(found!.companyId, found!.party)
    const row = db.select().from(schema.company).where(eq(schema.company.id, company.id)).get()!
    expect(row.vat_id.replace(/\s/g, '')).toBe('DE123456789')
  })
})
