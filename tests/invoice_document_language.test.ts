// Every invoice layout prints in German and English: layout and language are separate
// choices of the print page. Rendered to static markup, so the words on the sheet are checked.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  InvoiceDto,
  InvoiceLineItemDto,
  InvoicePrintDto
} from '../src/main/api/schemas/invoice.schema'
import type { Lang } from '../src/main/invoice/taxSummary'
import { AgencyTemplate } from '../src/renderer/src/components/invoice/AgencyInvoiceTemplate'
import { LetterTemplate } from '../src/renderer/src/components/invoice/LetterInvoiceTemplate'
import { StandardTemplate } from '../src/renderer/src/components/invoice/StandardInvoiceTemplate'
import { unitLabel, watermarkOf } from '../src/renderer/src/components/invoice/invoiceFormat'
import {
  letterAmount,
  letterRate,
  letterServiceLabel,
  letterTotals
} from '../src/renderer/src/components/invoice/letterFormat'
import { party } from './helpers/einvoiceFixtures'

const line = (overrides: Partial<InvoiceLineItemDto> = {}): InvoiceLineItemDto =>
  ({
    id: 1,
    position: 1,
    description: 'Show fee',
    quantity: 1,
    unit: 'service',
    unitPriceNet: 1000,
    taxRate: 19,
    taxCode: 'standard',
    lineNetAmount: 1000,
    lineTaxAmount: 190,
    lineGrossAmount: 1190,
    ...overrides
  }) as InvoiceLineItemDto

function printData(invoice: Partial<InvoiceDto> = {}, items = [line()]): InvoicePrintDto {
  return {
    invoice: {
      id: 1,
      kind: 'invoice',
      status: 'issued',
      invoiceNumber: 1040,
      issueDate: '2026-11-02',
      dueDate: '2026-11-16',
      currency: 'EUR',
      subtotalNetAmount: 1000,
      subtotalTaxAmount: 190,
      totalGrossAmount: 1190,
      paymentTerms: '',
      notes: '',
      reverseChargeNote: '',
      periodLabel: '',
      periodStartDate: null,
      periodEndDate: null,
      dealMemoName: '',
      cancelsInvoiceNumber: null,
      cancelsInvoiceIssueDate: null,
      recipientName: 'Example Promotions Ltd',
      lineItems: items,
      ...invoice
    } as InvoiceDto,
    issuer: party(),
    recipient: party({
      legalName: 'Example Promotions Ltd',
      street: 'High Street',
      streetNumber: '5',
      zipCode: 'SW1A 1AA',
      city: 'London',
      country: 'United Kingdom',
      countryCode: 'GB',
      vatId: ''
    }),
    venueName: 'Example Hall',
    eventDate: '2026-10-30',
    managementShare: null,
    bandName: 'Example Band'
  }
}

const LAYOUTS = {
  letter: LetterTemplate,
  standard: StandardTemplate,
  agency: AgencyTemplate
} as const

/** The text a layout prints in a language */
function sheet(layout: keyof typeof LAYOUTS, lang: Lang, data: InvoicePrintDto): string {
  const markup = renderToStaticMarkup(
    createElement(LAYOUTS[layout], { data, lang, paymentQr: false })
  )
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    // &amp; last, so an escaped "&amp;quot;" does not turn into a quote
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
}

// Words of the German sheets that must not appear on an English one
const GERMAN_WORDS = [
  'Rechnung',
  'RECHNUNG',
  'Fällig',
  'Summe',
  'Endbetrag',
  'USt',
  'MwSt',
  'Steuernummer',
  'Amtsgericht',
  'Entwurf',
  'Bezeichnung',
  'Menge',
  'Einheit',
  'Pauschale',
  'Leistungs',
  'Gesamt',
  'Band:',
  'verrechnet'
]

const layouts = Object.keys(LAYOUTS) as Array<keyof typeof LAYOUTS>

describe('invoice layout × language', () => {
  it.each(layouts)('%s prints a German invoice in German', (layout) => {
    const text = sheet(layout, 'de', printData())
    expect(text).toMatch(/Rechnung|RECHNUNG/)
    expect(text).toContain('USt')
    expect(text).toMatch(/Leistungsdatum/)
    expect(text).toContain('30.10.2026')
  })

  it.each(layouts)('%s prints an English invoice without German words', (layout) => {
    const text = sheet(layout, 'en', printData())
    expect(text).toMatch(/Invoice|INVOICE/)
    expect(text).toMatch(/VAT/)
    expect(text).toMatch(/Date of (supply\/)?service/)
    for (const word of GERMAN_WORDS) expect(text, word).not.toContain(word)
  })

  it.each(layouts)('%s prints the English number and money format', (layout) => {
    const text = sheet(layout, 'en', printData())
    expect(text).toMatch(/1,000\.00|1,190\.00/)
    expect(text).not.toMatch(/1\.000,00/)
  })

  it.each(layouts)('%s names a draft in the document language', (layout) => {
    const draft = printData({ status: 'draft', invoiceNumber: null })
    expect(sheet(layout, 'en', draft)).toContain('Draft')
    expect(sheet(layout, 'de', draft)).toContain('Entwurf')
  })

  it.each(layouts)('%s prints a Stornorechnung in the document language', (layout) => {
    const cancellation = printData(
      {
        kind: 'cancellation',
        invoiceNumber: 1042,
        cancelsInvoiceNumber: 1040,
        cancelsInvoiceIssueDate: '2026-11-02',
        subtotalNetAmount: -1000,
        subtotalTaxAmount: -190,
        totalGrossAmount: -1190
      },
      [line({ quantity: -1, lineNetAmount: -1000, lineTaxAmount: -190, lineGrossAmount: -1190 })]
    )
    const en = sheet(layout, 'en', cancellation)
    expect(en).toMatch(/Cancellation invoice|CANCELLATION INVOICE|CREDIT NOTE/)
    expect(en).toContain('invoice no. 1040')
    expect(en).toContain('This amount is offset against invoice no. 1040.')
    for (const word of GERMAN_WORDS) expect(en, word).not.toContain(word)

    const de = sheet(layout, 'de', cancellation)
    expect(de).toMatch(/Stornorechnung|STORNORECHNUNG|Storno zu Rechnung/)
    expect(de).toContain('Der Betrag wird mit der Rechnung Nr. 1040 verrechnet.')
  })

  it.each(layouts)('%s prints the reverse charge note and buyer VAT ID in English', (layout) => {
    const data = printData({ subtotalTaxAmount: 0, totalGrossAmount: 1000 }, [
      line({ taxRate: 0, taxCode: 'reverse_charge', lineTaxAmount: 0, lineGrossAmount: 1000 })
    ])
    data.recipient = {
      ...data.recipient!,
      country: 'Netherlands',
      countryCode: 'NL',
      vatId: 'NL123456789B01'
    }
    const en = sheet(layout, 'en', data)
    expect(en).toContain('Reverse charge: VAT to be accounted for by the recipient')
    expect(en).toContain('VAT ID: NL123456789B01')
    const de = sheet(layout, 'de', data)
    expect(de).toContain('USt-IdNr.: NL123456789B01')
  })
})

describe('invoice format helpers per language', () => {
  it('writes the watermark in the document language', () => {
    expect(watermarkOf('draft', 'de')).toBe('ENTWURF')
    expect(watermarkOf('draft', 'en')).toBe('DRAFT')
    expect(watermarkOf('cancelled', 'de')).toBe('STORNIERT')
    expect(watermarkOf('cancelled', 'en')).toBe('CANCELLED')
    expect(watermarkOf('issued', 'en')).toBeNull()
  })

  it('labels the stored units per language, free text as typed', () => {
    expect(unitLabel('service', 'de')).toBe('Pauschale')
    expect(unitLabel('service', 'en')).toBe('Lump sum')
    expect(unitLabel('hour', 'en')).toBe('Hour')
    expect(unitLabel('Set', 'en')).toBe('Set')
  })

  it('writes the Geschäftsbrief amounts and totals in English', () => {
    expect(letterAmount(1234.5, 'en')).toBe('1,234.50')
    expect(letterRate(19, 'en')).toBe('19.00%')
    expect(letterServiceLabel('Date of service')).toBe('Date of supply/service')
    expect(letterTotals(printData(), 'en').map((total) => [total.label, total.value])).toEqual([
      ['Subtotal:', '1,000.00'],
      ['19.00% VAT on EUR 1,000.00:', '190.00'],
      ['Total amount:', '1,190.00']
    ])
  })
})
