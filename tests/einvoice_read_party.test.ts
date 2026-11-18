import { describe, expect, it } from 'vitest'
import { parseXml, textAt } from '../src/main/einvoice/xmlTree'
import { managingDirectorsOf, readSellerParty, splitStreet } from '../src/main/einvoice/readParty'
import { CII_INVOICE, UBL_INVOICE } from './helpers/receivedEInvoices'

describe('xmlTree', () => {
  it('reads elements, attributes, entities and CDATA without prefixes', () => {
    const root = parseXml(
      '<?xml version="1.0"?><a:root x:y="1"><b:item>A &amp; B &#252;</b:item><c><![CDATA[<raw>]]></c><e/></a:root>'
    )
    expect(root?.name).toBe('root')
    expect(root?.attributes.y).toBe('1')
    expect(textAt(root, 'item')).toBe('A & B ü')
    expect(textAt(root, 'c')).toBe('<raw>')
    expect(root?.children.map((c) => c.name)).toEqual(['item', 'c', 'e'])
  })

  it('refuses broken XML and DOCTYPEs', () => {
    expect(parseXml('<a><b></a>')).toBeNull()
    expect(parseXml('<a>')).toBeNull()
    expect(parseXml('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>')).toBeNull()
    expect(parseXml('<a/><b/>')).toBeNull()
    expect(parseXml('kein XML')).toBeNull()
  })
})

describe('readSellerParty', () => {
  it('reads the seller of a CII invoice (ZUGFeRD / Factur-X)', () => {
    const party = readSellerParty(CII_INVOICE)
    expect(party).toMatchObject({
      syntax: 'cii',
      invoiceNumber: 'RE-2026-0042',
      issueDate: '2026-11-03',
      totalCents: 119000,
      currency: 'EUR',
      name: 'Bühnentechnik Beispiel GmbH & Co. KG',
      vatId: 'DE123456789',
      taxNumber: '12/345/67890',
      commercialRegisterNo: 'HRB 12345',
      registerCourt: 'Amtsgericht Musterstadt',
      email: 'rechnung@buehne.example.com',
      phone: '',
      address: {
        street: 'Musterstraße',
        streetNumber: '12a',
        addressSuffix: 'Hinterhaus',
        zipCode: '12345',
        city: 'Musterstadt',
        countryCode: 'DE'
      },
      bank: { iban: 'DE02120300000000202051', bic: 'BYLADEM0001' }
    })
    expect(party?.persons).toEqual([
      {
        firstName: 'Lena',
        lastName: 'Kontaktfrau',
        email: 'lena@buehne.example.com',
        phone: '+49 30 1234567',
        role: 'Kontakt'
      },
      { firstName: 'Erika', lastName: 'Beispiel', email: '', phone: '', role: 'Geschäftsführer' },
      { firstName: 'Max', lastName: 'Probe', email: '', phone: '', role: 'Geschäftsführer' }
    ])
  })

  it('reads the seller of a UBL invoice (XRechnung)', () => {
    const party = readSellerParty(UBL_INVOICE)
    expect(party).toMatchObject({
      syntax: 'ubl',
      invoiceNumber: '4711',
      issueDate: '2026-10-01',
      totalCents: 24000,
      currency: 'EUR',
      name: 'Licht & Ton GmbH',
      vatId: 'ATU12345678',
      taxNumber: '',
      email: 'info@licht.example.org',
      // A contact without a name: its phone belongs to the company
      phone: '+43 1 234',
      address: {
        street: 'Beispielweg',
        streetNumber: '3-5',
        zipCode: '54321',
        city: 'Beispielburg',
        countryCode: 'AT'
      },
      bank: { iban: 'AT611904300234573201', bic: 'BKAUATW0', accountHolder: 'Licht und Ton GmbH' }
    })
    // Named twice (legal form and note), listed once
    expect(party?.persons).toEqual([
      { firstName: 'Hans', lastName: 'Muster', email: '', phone: '', role: 'Geschäftsführer' }
    ])
  })

  it('returns null for other XML and for text', () => {
    expect(readSellerParty('<foo><bar/></foo>')).toBeNull()
    expect(readSellerParty('%PDF-1.7')).toBeNull()
    // A CII document without a seller name
    expect(readSellerParty('<rsm:CrossIndustryInvoice xmlns:rsm="x"/>')).toBeNull()
  })
})

describe('helpers', () => {
  it('splits street and number', () => {
    expect(splitStreet('Musterstraße 12a')).toEqual({ street: 'Musterstraße', streetNumber: '12a' })
    expect(splitStreet('Straße des 17. Juni 100')).toEqual({
      street: 'Straße des 17. Juni',
      streetNumber: '100'
    })
    expect(splitStreet('Postfach')).toEqual({ street: 'Postfach', streetNumber: '' })
  })

  it('finds managing directors in legal notes', () => {
    expect(
      managingDirectorsOf(['Geschäftsführerin: Anna Beispiel - USt-IdNr. DE123456789'])
    ).toEqual([{ firstName: 'Anna', lastName: 'Beispiel' }])
    expect(
      managingDirectorsOf(['Geschäftsführer Dr. Jan Probe und Eva Muster, Sitz Köln'])
    ).toEqual([
      { firstName: 'Dr. Jan', lastName: 'Probe' },
      { firstName: 'Eva', lastName: 'Muster' }
    ])
    expect(managingDirectorsOf(['Zahlbar innerhalb 14 Tagen'])).toEqual([])
  })
})
