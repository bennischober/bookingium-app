// E-invoice (ZUGFeRD/Factur-X, EN 16931): cent rounding, VAT categories,
// the completeness check, the CII XML (totals as the BR-CO rules recompute
// them), embedding into a PDF, and the service on real invoices
// (issued, draft, cancelled, switched off).
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib'
import {
  computeInvoiceAmounts,
  formatCents,
  roundMoney,
  toCents
} from '../src/main/einvoice/amounts'
import { countryCodeOf, unitCodeOf, vatCategoryOf, vatIdOf } from '../src/main/einvoice/codes'
import { prepareEInvoice, type EInvoiceInput } from '../src/main/einvoice/prepare'
import { EINVOICE_SAMPLES, buyer, invoice, party } from './helpers/einvoiceFixtures'
import { buildCiiXml } from '../src/main/einvoice/cii'
import { embedFacturX, readFacturX } from '../src/main/einvoice/facturx'
import { EInvoiceService } from '../src/main/services/EInvoiceService'
import { InvoiceService } from '../src/main/services/InvoiceService'
import { CompanyService } from '../src/main/services/CompanyService'
import { PersonService } from '../src/main/services/PersonService'
import { SettingsService } from '../src/main/services/SettingsService'

import { setupTestDb } from './helpers/setup'

setupTestDb()

/** Text of every <tag>…</tag> in document order */
function all(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?: [^>]*)?>([^<]*)</${tag}>`, 'g'))].map(
    (match) => match[1]
  )
}

function one(xml: string, tag: string): string {
  const values = all(xml, tag)
  expect(values, tag).toHaveLength(1)
  return values[0]
}

/** The BR-CO sums a validator recomputes from the XML, all in cents */
function expectConsistentTotals(xml: string) {
  const cents = (value: string) => toCents(Number(value))
  const header = xml.slice(xml.indexOf('<ram:ApplicableHeaderTradeSettlement>'))
  const lines = xml.slice(0, xml.indexOf('<ram:ApplicableHeaderTradeAgreement>'))
  const lineTotal = all(lines, 'ram:LineTotalAmount').reduce((sum, v) => sum + cents(v), 0)
  const summation = header.slice(
    header.indexOf('<ram:SpecifiedTradeSettlementHeaderMonetarySummation>')
  )
  // BR-CO-10: sum of line net amounts
  expect(cents(one(summation, 'ram:LineTotalAmount'))).toBe(lineTotal)
  // BR-CO-13/14/15/16
  const basis = cents(one(summation, 'ram:TaxBasisTotalAmount'))
  const tax = cents(one(summation, 'ram:TaxTotalAmount'))
  expect(basis).toBe(lineTotal)
  const breakdown = header.slice(
    0,
    header.indexOf('<ram:SpecifiedTradeSettlementHeaderMonetarySummation>')
  )
  expect(all(breakdown, 'ram:CalculatedAmount').reduce((sum, v) => sum + cents(v), 0)).toBe(tax)
  expect(all(breakdown, 'ram:BasisAmount').reduce((sum, v) => sum + cents(v), 0)).toBe(basis)
  expect(cents(one(summation, 'ram:GrandTotalAmount'))).toBe(basis + tax)
  expect(cents(one(summation, 'ram:DuePayableAmount'))).toBe(basis + tax)
  // BR-CO-17: VAT per category = basis × rate, rounded
  for (const group of breakdown.split('<ram:ApplicableTradeTax>').slice(1)) {
    const rate = all(group, 'ram:RateApplicablePercent')[0]
    if (rate === undefined) continue
    const expected = Math.round((cents(one(group, 'ram:BasisAmount')) * Number(rate)) / 100)
    expect(cents(one(group, 'ram:CalculatedAmount'))).toBe(expected)
  }
}

function xmlOf(input: EInvoiceInput): string {
  const result = prepareEInvoice(input)
  expect(result.missing).toEqual([])
  if (!result.complete) throw new Error('incomplete')
  return buildCiiXml(result.prepared)
}

// ========================================
// Amounts
// ========================================

describe('amounts', () => {
  it('round half away from zero, without float noise', () => {
    expect(toCents(1.005)).toBe(101)
    expect(toCents(-1.005)).toBe(-101)
    expect(roundMoney(0.285)).toBe(0.29)
    expect(toCents(3 * 529.41)).toBe(158823)
    expect(formatCents(123450)).toBe('1234.50')
    expect(formatCents(5)).toBe('0.05')
  })

  it('round VAT once per rate, like EN 16931 does', () => {
    // Per line: 3 × 0.01 = 0.03; per rate: 0.15 × 19 % = 0.0285 -> 0.03
    // Per line: 3 × round(0.333 × 0.19 = 0.0633) = 0.18; per rate: 0.999 -> 1.00 × 19 % = 0.19
    const amounts = computeInvoiceAmounts([
      { quantity: 1, unitPriceNet: 0.333, taxRate: 19 },
      { quantity: 1, unitPriceNet: 0.333, taxRate: 19 },
      { quantity: 1, unitPriceNet: 0.333, taxRate: 19 }
    ])
    expect(amounts.lines.map((line) => line.netCents)).toEqual([33, 33, 33])
    expect(amounts.lines.reduce((sum, line) => sum + line.taxCents, 0)).toBe(18)
    expect(amounts.taxCents).toBe(19) // 0.99 × 19 % = 0.1881
    expect(amounts.grossCents).toBe(118)
  })

  it('keep 7 % and 19 % apart', () => {
    const amounts = computeInvoiceAmounts([
      { quantity: 2, unitPriceNet: 99.99, taxRate: 19 },
      { quantity: 1, unitPriceNet: 50, taxRate: 7 },
      { quantity: 1, unitPriceNet: 10, taxRate: 0 }
    ])
    expect(amounts.rates).toEqual([
      { rate: 19, netCents: 19998, taxCents: 3800 },
      { rate: 7, netCents: 5000, taxCents: 350 },
      { rate: 0, netCents: 1000, taxCents: 0 }
    ])
    expect(amounts.grossCents).toBe(19998 + 5000 + 1000 + 3800 + 350)
  })
})

// ========================================
// Code lists
// ========================================

describe('codes', () => {
  it('map tax codes to VAT categories', () => {
    expect(vatCategoryOf('standard', 19)).toEqual({ category: 'S' })
    expect(vatCategoryOf('reduced', 7)).toEqual({ category: 'S' })
    expect(vatCategoryOf('zero_rated', 0)).toEqual({ category: 'Z' })
    expect(vatCategoryOf('exempt', 0)).toEqual({ category: 'E' })
    expect(vatCategoryOf('reverse_charge', 0)).toEqual({ category: 'AE' })
    expect(vatCategoryOf('intra_community', 0)).toEqual({ category: 'K' })
    expect(vatCategoryOf('export', 0)).toEqual({ category: 'G' })
    expect(vatCategoryOf('not_taxable', 0)).toEqual({ category: 'O' })
    expect(vatCategoryOf('other', 19)).toEqual({ category: 'S' })
    expect(vatCategoryOf('other', 0)).toEqual({ problem: 'unspecified' })
    expect(vatCategoryOf('standard', 0)).toEqual({ problem: 'rate_must_be_positive' })
    expect(vatCategoryOf('reverse_charge', 19)).toEqual({ problem: 'rate_must_be_zero' })
  })

  it('map units, countries and VAT ids', () => {
    expect(unitCodeOf('service')).toBe('LS')
    expect(unitCodeOf('Pauschal')).toBe('LS')
    expect(unitCodeOf('Stk.')).toBe('C62')
    expect(unitCodeOf('hour')).toBe('HUR')
    expect(unitCodeOf('Std')).toBe('HUR')
    expect(unitCodeOf('Show')).toBeNull()
    expect(countryCodeOf('de', '')).toBe('DE')
    expect(countryCodeOf('', 'Deutschland')).toBe('DE')
    expect(countryCodeOf('', 'Austria')).toBe('AT')
    expect(countryCodeOf('', 'Atlantis')).toBeNull()
    expect(vatIdOf('DE 123 456 789')).toBe('DE123456789')
    expect(vatIdOf('27/123/45678')).toBeNull()
  })
})

// ========================================
// Completeness check
// ========================================

describe('completeness check', () => {
  it('passes a complete invoice', () => {
    expect(prepareEInvoice(invoice())).toMatchObject({ complete: true, missing: [] })
  })

  it('lists what is missing', () => {
    const result = prepareEInvoice(
      invoice({
        invoiceNumber: null,
        dueDate: null,
        paymentTerms: '',
        seller: party({ email: '', vatNumber: '', taxNumber: '', commercialRegisterNo: '' }),
        buyer: buyer({ street: '', streetNumber: '', countryCode: '', country: '' }),
        lines: [
          {
            description: 'Show',
            quantity: 1,
            unit: 'Show',
            unitPriceNet: 100,
            taxRate: 19,
            taxCode: 'standard'
          },
          {
            description: 'Fahrt',
            quantity: 1,
            unit: 'km',
            unitPriceNet: 10,
            taxRate: 0,
            taxCode: 'other'
          },
          {
            description: 'Catering',
            quantity: 1,
            unit: 'piece',
            unitPriceNet: 10,
            taxRate: 0,
            taxCode: 'standard'
          },
          {
            description: 'Gage',
            quantity: 1,
            unit: 'service',
            unitPriceNet: 10,
            taxRate: 19,
            taxCode: 'reverse_charge'
          }
        ]
      })
    )
    expect(result.complete).toBe(false)
    expect(result.missing).toEqual([
      'Rechnungsnummer (Rechnung ist noch ein Entwurf)',
      'Rechnungsempfänger: Straße, Land',
      'Rechnungssteller: E-Mail',
      'Position 1: Einheit, die die E-Rechnung kennt (statt „Show“)',
      'Position 2: Steuerschlüssel statt „sonstig“ mit 0 % (z. B. steuerfrei, Reverse Charge)',
      'Position 3: MwSt.-Satz über 0 % bei „Regelsatz“',
      'Position 4: 0 % MwSt. bei „Reverse Charge“',
      'Rechnungssteller: USt-IdNr. oder Handelsregisternummer',
      'Fälligkeitsdatum oder Zahlungsbedingungen'
    ])
  })

  it('leaves the number out for drafts', () => {
    expect(prepareEInvoice(invoice({ invoiceNumber: null }), { ignoreNumber: true }).complete).toBe(
      true
    )
  })

  it('needs the buyer VAT id for reverse charge and a reason for exempt lines', () => {
    const lines = [
      {
        description: 'Gage',
        quantity: 1,
        unit: 'service',
        unitPriceNet: 1000,
        taxRate: 0,
        taxCode: 'reverse_charge' as const
      },
      {
        description: 'Workshop',
        quantity: 1,
        unit: 'service',
        unitPriceNet: 500,
        taxRate: 0,
        taxCode: 'exempt' as const
      }
    ]
    expect(prepareEInvoice(invoice({ lines, buyer: buyer({ vatNumber: '' }) })).missing).toEqual([
      'Steuerhinweis mit dem Grund der Steuerbefreiung (z. B. § 4 Nr. 20 a UStG)',
      'Rechnungsempfänger: USt-IdNr. (für Reverse Charge)'
    ])
  })

  it('keeps "not subject to VAT" on its own and without VAT ids', () => {
    const lines = [
      {
        description: 'Gage',
        quantity: 1,
        unit: 'service',
        unitPriceNet: 1000,
        taxRate: 0,
        taxCode: 'not_taxable' as const
      },
      {
        description: 'Merch',
        quantity: 1,
        unit: 'piece',
        unitPriceNet: 100,
        taxRate: 19,
        taxCode: 'standard' as const
      }
    ]
    expect(prepareEInvoice(invoice({ lines })).missing).toEqual([
      '„nicht steuerbar“ nur ohne andere Steuerschlüssel in derselben Rechnung'
    ])
    const xml = xmlOf(invoice({ lines: [lines[0]] }))
    expect(xml).not.toContain('schemeID="VA"')
    expect(xml).not.toContain('RateApplicablePercent')
    expect(one(xml, 'ram:ExemptionReasonCode')).toBe('VATEX-EU-O')
  })

  it('asks for "nicht steuerbar" instead of reverse charge outside the EU', () => {
    const lines = [
      {
        description: 'Gage',
        quantity: 1,
        unit: 'service',
        unitPriceNet: 1000,
        taxRate: 0,
        taxCode: 'reverse_charge' as const
      }
    ]
    const swiss = buyer({ countryCode: 'CH', vatNumber: 'CHE123456789' })
    expect(prepareEInvoice(invoice({ lines, buyer: swiss })).missing).toEqual([
      '„nicht steuerbar“ statt „Reverse Charge“ (Empfänger außerhalb der EU)'
    ])
    const austrian = buyer({ countryCode: 'AT', vatNumber: 'ATU12345678' })
    expect(prepareEInvoice(invoice({ lines, buyer: austrian })).complete).toBe(true)
  })

  it('needs Leitweg-ID, contact, IBAN and buyer e-mail for XRechnung', () => {
    const result = prepareEInvoice(
      invoice({
        xrechnung: true,
        seller: party({ contactPhone: '', iban: '' }),
        buyer: buyer({ email: '' })
      })
    )
    expect(result.missing).toEqual([
      'Leitweg-ID (für die XRechnung)',
      'Rechnungssteller: Ansprechpartner für Rechnungen mit Telefon und E-Mail (XRechnung)',
      'Rechnungssteller: IBAN (XRechnung)',
      'Rechnungsempfänger: E-Mail (XRechnung)'
    ])
  })

  it('refuses totals that differ from the lines (old rounding)', () => {
    const result = prepareEInvoice(
      invoice({ storedTotals: { net: 3000, tax: 570.01, gross: 3570.01 } })
    )
    expect(result.missing).toEqual([
      'Beträge der Rechnung passend zu den Positionen (Rundung weicht ab)'
    ])
  })
})

// ========================================
// XML
// ========================================

describe('CII XML', () => {
  it('writes a domestic invoice with 19 % and 7 %', () => {
    const xml = xmlOf(
      invoice({
        buyerReference: '04011000-12345-34',
        periodStartDate: '2026-10-01',
        periodEndDate: '2026-10-31',
        notes: 'Danke & bis bald <3',
        lines: [
          {
            description: 'Gage',
            quantity: 1,
            unit: 'service',
            unitPriceNet: 3000,
            taxRate: 19,
            taxCode: 'standard'
          },
          {
            description: 'Fahrtkosten',
            quantity: 3,
            unit: 'piece',
            unitPriceNet: 529.41,
            taxRate: 19,
            taxCode: 'standard'
          },
          {
            description: 'Programmheft',
            quantity: 10,
            unit: 'piece',
            unitPriceNet: 2.35,
            taxRate: 7,
            taxCode: 'reduced'
          }
        ]
      })
    )
    expect(xml).toContain('<ram:ID>urn:cen.eu:en16931:2017</ram:ID>')
    expect(xml).toContain('<ram:ID>1040</ram:ID>')
    expect(xml).toContain('<ram:TypeCode>380</ram:TypeCode>')
    expect(xml).toContain('<udt:DateTimeString format="102">20261015</udt:DateTimeString>')
    expect(one(xml, 'ram:BuyerReference')).toBe('04011000-12345-34')
    expect(one(xml, 'ram:Content')).toBe('Danke &amp; bis bald &lt;3')
    expect(all(xml, 'ram:BilledQuantity')).toEqual(['1', '3', '10'])
    expect(xml).toContain('<ram:BilledQuantity unitCode="LS">1</ram:BilledQuantity>')
    expect(xml).toContain('<ram:BilledQuantity unitCode="C62">3</ram:BilledQuantity>')
    // Seller with contact, e-mail, VAT id and tax number; buyer with VAT id
    expect(one(xml, 'ram:PersonName')).toBe('Erika Muster')
    expect(all(xml, 'ram:URIID')).toEqual([
      'erika@beispiel.test',
      'rechnung@beispiel.test',
      'buchhaltung@nord.test'
    ])
    expect(xml).toContain('<ram:ID schemeID="VA">DE123456789</ram:ID>')
    expect(xml).toContain('<ram:ID schemeID="FC">27/123/45678</ram:ID>')
    expect(xml).toContain('<ram:ID schemeID="VA">DE987654321</ram:ID>')
    expect(one(xml, 'ram:IBANID')).toBe('DE02120300000000202051')
    // Two VAT groups: 19 % on 4588.23, 7 % on 23.50
    expect(all(xml, 'ram:BasisAmount')).toEqual(['4588.23', '23.50'])
    expect(all(xml, 'ram:CalculatedAmount')).toEqual(['871.76', '1.65'])
    expect(one(xml, 'ram:GrandTotalAmount')).toBe('5485.14')
    expect(xml).toContain('<ram:TaxTotalAmount currencyID="EUR">873.41</ram:TaxTotalAmount>')
    expect(xml).toContain('<ram:StartDateTime><udt:DateTimeString format="102">20261001')
    expect(xml).toContain('<ram:OccurrenceDateTime><udt:DateTimeString format="102">20261010')
    expectConsistentTotals(xml)
  })

  it('writes reverse charge (AE) with exemption reason and buyer VAT id', () => {
    const xml = xmlOf(
      invoice({
        buyer: buyer({ countryCode: 'AT', country: 'Österreich', vatNumber: 'ATU12345678' }),
        lines: [
          {
            description: 'Gage',
            quantity: 1,
            unit: 'service',
            unitPriceNet: 2500,
            taxRate: 0,
            taxCode: 'reverse_charge'
          }
        ]
      })
    )
    expect(all(xml, 'ram:CategoryCode')).toEqual(['AE', 'AE'])
    expect(one(xml, 'ram:ExemptionReason')).toBe('Steuerschuldnerschaft des Leistungsempfängers')
    expect(one(xml, 'ram:ExemptionReasonCode')).toBe('VATEX-EU-AE')
    expect(one(xml, 'ram:CalculatedAmount')).toBe('0.00')
    expect(all(xml, 'ram:RateApplicablePercent')).toEqual(['0', '0'])
    expect(xml).toContain('<ram:ID schemeID="VA">ATU12345678</ram:ID>')
    expect(all(xml, 'ram:CountryID')).toEqual(['DE', 'AT'])
    expectConsistentTotals(xml)
  })

  it('writes exempt lines (E) with the tax note as reason, next to 19 %', () => {
    const xml = xmlOf(
      invoice({
        taxNote: 'Steuerfrei nach § 4 Nr. 20 a UStG',
        lines: [
          {
            description: 'Konzert',
            quantity: 1,
            unit: 'service',
            unitPriceNet: 1800,
            taxRate: 0,
            taxCode: 'exempt'
          },
          {
            description: 'Technik',
            quantity: 4,
            unit: 'hour',
            unitPriceNet: 45.5,
            taxRate: 19,
            taxCode: 'standard'
          }
        ]
      })
    )
    expect(all(xml, 'ram:CategoryCode')).toEqual(['E', 'S', 'E', 'S'])
    expect(one(xml, 'ram:ExemptionReason')).toBe('Steuerfrei nach § 4 Nr. 20 a UStG')
    expect(all(xml, 'ram:CalculatedAmount')).toEqual(['0.00', '34.58'])
    expect(one(xml, 'ram:GrandTotalAmount')).toBe('2016.58')
    expectConsistentTotals(xml)
  })

  it('writes a Stornorechnung as credit note (381) referring to the invoice', () => {
    const xml = xmlOf(EINVOICE_SAMPLES['credit-note'])
    expect(xml).toContain('<ram:ID>1042</ram:ID><ram:TypeCode>381</ram:TypeCode>')
    expect(xml).toContain(
      '<ram:InvoiceReferencedDocument><ram:IssuerAssignedID>1040</ram:IssuerAssignedID>' +
        '<ram:FormattedIssueDateTime><qdt:DateTimeString format="102">20261015'
    )
    expect(one(xml, 'ram:GrandTotalAmount')).toBe('3570.00')
    expectConsistentTotals(xml)
  })

  it('writes XRechnung with its guideline and business process', () => {
    const xml = xmlOf(EINVOICE_SAMPLES.xrechnung)
    expect(xml).toContain(
      '<ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>'
    )
    expect(xml).toContain(
      '<ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID>'
    )
    expect(one(xml, 'ram:BuyerReference')).toBe('991-01234-56')
  })

  it('writes intra-community supplies (K) with ship-to country', () => {
    const xml = xmlOf(
      invoice({
        buyer: buyer({ countryCode: 'FR', country: 'Frankreich', vatNumber: 'FR12345678901' }),
        lines: [
          {
            description: 'Merch',
            quantity: 20,
            unit: 'piece',
            unitPriceNet: 12,
            taxRate: 0,
            taxCode: 'intra_community'
          }
        ]
      })
    )
    expect(one(xml, 'ram:ExemptionReasonCode')).toBe('VATEX-EU-IC')
    expect(all(xml, 'ram:CountryID')).toEqual(['DE', 'FR', 'FR'])
    expectConsistentTotals(xml)
  })
})

// ========================================
// PDF
// ========================================

describe('Factur-X PDF', () => {
  it('embeds the XML as associated file with Factur-X metadata', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    const pdf = await doc.save()
    const xml = xmlOf(invoice())

    const facturX = await embedFacturX(pdf, xml, { title: 'Rechnung_1040' })
    expect(await readFacturX(facturX)).toBe(xml)
    expect(await readFacturX(pdf)).toBeNull()

    const loaded = await PDFDocument.load(facturX)
    expect(loaded.getPageCount()).toBe(1)
    expect(loaded.catalog.get(PDFName.of('AF'))).toBeDefined()
    const metadata = loaded.catalog.lookup(PDFName.of('Metadata'))
    const xmp = new TextDecoder().decode((metadata as unknown as { contents: Uint8Array }).contents)
    expect(xmp).toContain('<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>')
    expect(xmp).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>')
    expect(xmp).toContain('<pdfaid:part>3</pdfaid:part>')
    const spec = loaded.catalog.lookup(PDFName.of('AF'), PDFArray).lookup(0, PDFDict)
    expect(String(spec.get(PDFName.of('AFRelationship')))).toBe('/Alternative')
    const file = spec.lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'), PDFRawStream)
    expect(String(file.dict.get(PDFName.of('Subtype')))).toBe('/text#2Fxml')
    // PDF/A: sRGB output intent with a valid ICC header, file identifier
    const intent = loaded.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).lookup(0, PDFDict)
    expect(String(intent.get(PDFName.of('S')))).toBe('/GTS_PDFA1')
    const icc = decodePDFRawStream(
      intent.lookup(PDFName.of('DestOutputProfile'), PDFRawStream)
    ).decode()
    const iccHeader = Buffer.from(icc)
    expect(iccHeader.readUInt32BE(0)).toBe(icc.length)
    expect(iccHeader.toString('latin1', 12, 24)).toBe('mntrRGB XYZ ')
    expect(iccHeader.toString('latin1', 36, 40)).toBe('acsp')
    expect(loaded.context.trailerInfo.ID).toBeDefined()
  })
})

// ========================================
// Service on stored invoices
// ========================================

describe('EInvoiceService', () => {
  async function setup() {
    const persons = container.resolve(PersonService)
    const companies = container.resolve(CompanyService)
    const contact = await persons.createPerson({
      firstName: 'Erika',
      lastName: 'Muster',
      contact: {
        email: 'erika@beispiel.test',
        phone: '+49 30 123457',
        mobilePhone: '',
        homepage: ''
      }
    })
    const issuer = await companies.createCompany({
      name: `Beispiel Booking GmbH ${Math.random()}`,
      vatNumber: 'DE123456789',
      commercialRegisterNo: 'HRB 12345',
      invoiceContactPersonId: contact.id,
      address: {
        street: 'Musterstraße',
        streetNumber: '1',
        addressSuffix: '',
        zipCode: '10115',
        city: 'Berlin',
        state: '',
        country: 'Deutschland',
        countryCode: 'DE'
      },
      contact: { email: 'rechnung@beispiel.test', phone: '', mobilePhone: '', homepage: '' }
    })
    const recipient = await companies.createCompany({
      name: 'Konzertveranstaltung Nord GmbH',
      vatNumber: 'DE987654321',
      address: {
        street: 'Hafenweg',
        streetNumber: '7',
        addressSuffix: '',
        zipCode: '20095',
        city: 'Hamburg',
        state: '',
        country: '',
        countryCode: 'DE'
      }
    })
    return { issuer, recipient, contact }
  }

  const lineItems = [
    {
      description: 'Gage',
      quantity: 1,
      unit: 'service',
      unitPriceNet: 1000,
      taxRate: 19,
      taxCode: 'standard' as const
    }
  ]

  it('builds the XML of an issued invoice from its snapshots', async () => {
    const { issuer, recipient } = await setup()
    const invoices = container.resolve(InvoiceService)
    const created = await invoices.createInvoice({
      companyId: issuer.id,
      recipientKind: 'company',
      recipientCompanyId: recipient.id,
      status: 'issued',
      dueDate: '2026-11-01',
      buyerReference: 'PO-4711',
      lineItems
    })
    expect(created.buyer_reference).toBe('PO-4711')

    const check = await container.resolve(EInvoiceService).check(created.id)
    expect(check.state).toBe('ready')
    expect(check.xml).toContain('<ram:PersonName>Erika Muster</ram:PersonName>')
    expect(check.xml).toContain('<ram:CompleteNumber>+49 30 123457</ram:CompleteNumber>')
    expect(check.xml).toContain('<ram:BuyerReference>PO-4711</ram:BuyerReference>')
    expect(check.xml).toContain(`<ram:ID>${created.invoice_number}</ram:ID>`)
    expectConsistentTotals(check.xml!)

    // Cancelled invoices get none
    await invoices.setInvoiceStatus(created.id, 'cancelled')
    expect((await container.resolve(EInvoiceService).check(created.id)).state).toBe('cancelled')
  })

  it('checks drafts with current master data and freezes it on issue', async () => {
    const { issuer, recipient } = await setup()
    const invoices = container.resolve(InvoiceService)
    const companies = container.resolve(CompanyService)
    const service = container.resolve(EInvoiceService)
    await companies.updateCompany({
      id: recipient.id,
      address: {
        street: '',
        streetNumber: '',
        addressSuffix: '',
        zipCode: '20095',
        city: 'Hamburg',
        state: '',
        country: '',
        countryCode: 'DE'
      }
    })
    const draft = await invoices.createInvoice({
      companyId: issuer.id,
      recipientKind: 'company',
      recipientCompanyId: recipient.id,
      dueDate: '2026-11-01',
      lineItems
    })
    expect(await service.check(draft.id)).toMatchObject({
      state: 'incomplete',
      missing: ['Rechnungsempfänger: Straße']
    })

    // Fixed in the master data: the draft sees it, issuing freezes it
    await companies.updateCompany({
      id: recipient.id,
      address: {
        street: 'Hafenweg',
        streetNumber: '7',
        addressSuffix: '',
        zipCode: '20095',
        city: 'Hamburg',
        state: '',
        country: '',
        countryCode: 'DE'
      }
    })
    expect(await service.check(draft.id)).toMatchObject({ state: 'draft', missing: [] })
    await invoices.setInvoiceStatus(draft.id, 'issued')
    const issued = await service.check(draft.id)
    expect(issued.state).toBe('ready')
    expect(issued.xml).toContain('<ram:LineOne>Hafenweg 7</ram:LineOne>')
  })

  it('cancels with a Stornorechnung: own number, negative copy, credit note', async () => {
    const { issuer, recipient } = await setup()
    const invoices = container.resolve(InvoiceService)
    const service = container.resolve(EInvoiceService)
    const original = await invoices.createInvoice({
      companyId: issuer.id,
      recipientKind: 'company',
      recipientCompanyId: recipient.id,
      status: 'issued',
      dueDate: '2026-11-01',
      xrechnung: false,
      lineItems: [
        ...lineItems,
        {
          description: 'Fahrt',
          quantity: 3,
          unit: 'km',
          unitPriceNet: 0.3,
          taxRate: 19,
          taxCode: 'standard' as const
        }
      ]
    })
    await invoices.setInvoiceStatus(original.id, 'cancelled')

    const cancelled = await invoices.getInvoiceById(original.id)
    expect(cancelled?.status).toBe('cancelled')
    expect(cancelled?.cancelledBy?.invoice_number).toBe((original.invoice_number ?? 0) + 1)
    const storno = await invoices.getInvoiceById(cancelled!.cancelledBy!.id)
    expect(storno).toMatchObject({
      kind: 'cancellation',
      status: 'issued',
      invoice_number: (original.invoice_number ?? 0) + 1,
      cancels_invoice_id: original.id,
      total_gross_amount: -original.total_gross_amount,
      subtotal_tax_amount: -original.subtotal_tax_amount,
      issuer_snapshot_id: original.issuer_snapshot_id
    })
    expect(storno?.payment_terms).toMatch(/^Storno der Rechnung Nr\. \d+ vom \d{2}\.\d{2}\.\d{4}$/)
    expect(storno?.lineItems.map((line) => line.quantity)).toEqual([-1, -3])
    expect(
      original.total_gross_amount + storno!.total_gross_amount,
      'invoice and Storno add up to zero'
    ).toBe(0)

    const check = await service.check(storno!.id)
    expect(check.state).toBe('ready')
    expect(check.xml).toContain('<ram:TypeCode>381</ram:TypeCode>')
    expect(check.xml).toContain(
      `<ram:IssuerAssignedID>${original.invoice_number}</ram:IssuerAssignedID>`
    )
    expect(check.xml).toContain('<ram:BilledQuantity unitCode="KMT">3</ram:BilledQuantity>')
    expectConsistentTotals(check.xml!)

    // A Stornorechnung never changes, and is not cancelled again
    await expect(invoices.setInvoiceStatus(storno!.id, 'paid')).rejects.toThrow('Stornorechnung')
    await expect(invoices.setInvoiceStatus(storno!.id, 'cancelled')).rejects.toThrow(
      'Stornorechnung'
    )
  })

  it('previews the parties of the form and follows the setting', async () => {
    const { issuer, recipient } = await setup()
    const service = container.resolve(EInvoiceService)
    const parties = service.previewParties({
      companyId: issuer.id,
      recipientKind: 'company',
      recipientCompanyId: recipient.id
    })
    expect(parties.issuer).toMatchObject({ contactName: 'Erika Muster', countryCode: 'DE' })
    expect(parties.recipient).toMatchObject({ legalName: 'Konzertveranstaltung Nord GmbH' })

    const draft = await container.resolve(InvoiceService).createInvoice({
      companyId: issuer.id,
      recipientKind: 'company',
      recipientCompanyId: recipient.id,
      lineItems
    })
    const settings = container.resolve(SettingsService)
    settings.update({ eInvoiceEmbed: false })
    expect((await service.check(draft.id)).state).toBe('disabled')
    settings.update({ eInvoiceEmbed: true })
  })
})
