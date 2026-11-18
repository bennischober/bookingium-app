// #222: companies and their people from received e-invoices - reading PDF and XML files,
// matching what the app already knows, and writing only into empty fields.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { PDFDocument } from 'pdf-lib'
import { embedFacturX } from '../src/main/einvoice/facturx'
import { EInvoicePartyService, NO_EINVOICE } from '../src/main/services/EInvoicePartyService'
import { CompanyService } from '../src/main/services/CompanyService'
import { PersonService } from '../src/main/services/PersonService'
import { schema } from '../src/main/db/schema'
import { setupTestDb, getTestDb } from './helpers/setup'
import { CII_INVOICE, UBL_INVOICE } from './helpers/receivedEInvoices'

setupTestDb()

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)

async function pdfWith(xml: string | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage()
  const pdf = await doc.save()
  return xml ? embedFacturX(pdf, xml, { title: 'Rechnung' }) : pdf
}

describe('e-invoice party import', () => {
  const service = container.resolve(EInvoicePartyService)
  const companies = container.resolve(CompanyService)
  const persons = container.resolve(PersonService)

  it('reads the seller from a Factur-X PDF and from an XML file', async () => {
    const fromPdf = await service.read(await pdfWith(CII_INVOICE), 'rechnung.pdf')
    expect(fromPdf.fileName).toBe('rechnung.pdf')
    expect(fromPdf.invoiceNumber).toBe('RE-2026-0042')
    expect(fromPdf.party.name).toBe('Bühnentechnik Beispiel GmbH & Co. KG')
    expect(fromPdf.company).toBeNull()
    expect(fromPdf.persons).toHaveLength(3)

    const fromXml = await service.read(encode('\uFEFF' + UBL_INVOICE), 'rechnung.xml')
    expect(fromXml.party.vatId).toBe('ATU12345678')
  })

  it('refuses files without an e-invoice', async () => {
    await expect(service.read(await pdfWith(null), 'scan.pdf')).rejects.toThrow(NO_EINVOICE)
    await expect(service.read(encode('Hallo'), 'notiz.txt')).rejects.toThrow(NO_EINVOICE)
    await expect(service.read(encode('<a/>'), 'andere.xml')).rejects.toThrow(NO_EINVOICE)
  })

  it('creates the company, its bank account and people with their roles', async () => {
    const { party } = await service.read(encode(CII_INVOICE), 'rechnung.xml')
    const result = service.apply(party)
    expect(result).toMatchObject({
      companyCreated: true,
      personsCreated: 3,
      membersAdded: 3
    })

    const company = await companies.getCompanyById(result.companyId)
    expect(company).toMatchObject({
      name: 'Bühnentechnik Beispiel GmbH & Co. KG',
      vat_id: 'DE123456789',
      tax_number: '12/345/67890',
      commercial_register_no: 'HRB 12345',
      register_court: 'Amtsgericht Musterstadt'
    })
    expect(company?.address).toMatchObject({
      street: 'Musterstraße',
      street_number: '12a',
      address_suffix: 'Hinterhaus',
      zip_code: '12345',
      country_code: 'DE'
    })
    expect(company?.contact?.email).toBe('rechnung@buehne.example.com')
    expect(company?.bank).toMatchObject({ iban: 'DE02120300000000202051', bic: 'BYLADEM0001' })

    const { db } = getTestDb()
    const members = db
      .select({ role: schema.company_member.role, first: schema.person.first_name })
      .from(schema.company_member)
      .innerJoin(schema.person, eq(schema.company_member.person_id, schema.person.id))
      .where(eq(schema.company_member.company_id, result.companyId))
      .all()
    expect(members).toEqual(
      expect.arrayContaining([
        { role: 'Kontakt', first: 'Lena' },
        { role: 'Geschäftsführer', first: 'Erika' },
        { role: 'Geschäftsführer', first: 'Max' }
      ])
    )
  })

  it('matches the company and people again and fills only empty fields', async () => {
    const preview = await service.read(encode(CII_INVOICE), 'rechnung.xml')
    expect(preview.company).toMatchObject({ by: 'vatId' })
    expect(preview.persons.map((person) => person.match?.by)).toEqual(['email', 'name', 'name'])
    expect(preview.persons.every((person) => person.isMember)).toBe(true)

    const companyId = preview.company!.id
    await companies.updateCompany({ id: companyId, name: 'Bühne Beispiel (eigener Name)' })

    const result = service.apply({
      ...preview.party,
      name: 'Anderer Name',
      taxNumber: '99/999/99999',
      persons: [
        ...preview.party.persons,
        { firstName: 'Neu', lastName: 'Person', email: '', phone: '', role: 'Geschäftsführer' }
      ]
    })
    expect(result).toMatchObject({
      companyId,
      companyCreated: false,
      personsCreated: 1,
      membersAdded: 1
    })
    const company = await companies.getCompanyById(companyId)
    // Entered by the user, kept
    expect(company?.name).toBe('Bühne Beispiel (eigener Name)')
    expect(company?.tax_number).toBe('12/345/67890')
  })

  it('completes an existing person found by name and keeps a different address as further one', async () => {
    const person = await persons.createPerson({
      firstName: 'Hans',
      lastName: 'Muster',
      birthday: null,
      notes: null,
      contact: { email: 'hans@privat.example.com', phone: '', mobilePhone: '', homepage: '' }
    })
    const { party } = await service.read(encode(UBL_INVOICE), 'rechnung.xml')
    party.persons[0].email = 'hans@licht.example.org'
    const result = service.apply(party)
    expect(result).toMatchObject({ companyCreated: true, personsCreated: 0, personsUpdated: 1 })

    const { db } = getTestDb()
    const further = db
      .select({ email: schema.contact_email.email })
      .from(schema.contact_email)
      .innerJoin(schema.person, eq(schema.person.contact_id, schema.contact_email.contact_id))
      .where(eq(schema.person.id, person.id))
      .all()
    expect(further).toEqual([{ email: 'hans@licht.example.org' }])
  })
})
