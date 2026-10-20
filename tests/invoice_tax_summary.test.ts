// What printed invoices say about VAT (§ 14 Abs. 4 UStG): VAT per rate and
// per 0 % reason, the tax note, the buyer's VAT ID and the service date.
import { describe, it, expect } from 'vitest'
import {
  needsBuyerVatId,
  serviceDateOf,
  taxNoteOf,
  vatGroupLabel,
  vatGroups
} from '../src/main/invoice/taxSummary'
import type {
  InvoiceDto,
  InvoiceLineItemDto,
  InvoicePrintDto
} from '../src/main/api/schemas/invoice.schema'
import { party } from './helpers/einvoiceFixtures'

const line = (overrides: Partial<InvoiceLineItemDto>): InvoiceLineItemDto =>
  ({
    lineNetAmount: 100,
    taxRate: 19,
    taxCode: 'standard',
    ...overrides
  }) as InvoiceLineItemDto

function printData(
  lineItems: InvoiceLineItemDto[],
  invoice: Partial<InvoiceDto> = {},
  eventDate: string | null = null
): InvoicePrintDto {
  return {
    invoice: {
      reverseChargeNote: '',
      periodLabel: '',
      periodStartDate: null,
      periodEndDate: null,
      lineItems,
      ...invoice
    } as InvoiceDto,
    issuer: party(),
    recipient: party({ legalName: 'Veranstalter GmbH' }),
    venueName: null,
    eventDate,
    managementShare: null,
    bandName: null
  }
}

const euro = (cents: number) => `${(cents / 100).toFixed(2)} €`

describe('VAT groups', () => {
  it('one group per rate, VAT rounded once per group', () => {
    const groups = vatGroups(
      printData([
        line({ lineNetAmount: 10.01 }),
        line({ lineNetAmount: 10.01 }),
        line({ lineNetAmount: 50, taxRate: 7, taxCode: 'reduced' })
      ])
    )
    expect(groups).toEqual([
      { rate: 19, taxCode: 'standard', netCents: 2002, taxCents: 380 },
      { rate: 7, taxCode: 'standard', netCents: 5000, taxCents: 350 }
    ])
  })

  it('splits 0 % lines by reason', () => {
    const groups = vatGroups(
      printData([
        line({ taxRate: 0, taxCode: 'exempt' }),
        line({ taxRate: 0, taxCode: 'reverse_charge' }),
        line({ taxRate: 0, taxCode: 'exempt' })
      ])
    )
    expect(groups.map((group) => [group.taxCode, group.netCents])).toEqual([
      ['exempt', 20000],
      ['reverse_charge', 10000]
    ])
  })

  it('labels a single group without and several groups with their net amount', () => {
    const [standard] = vatGroups(printData([line({ lineNetAmount: 1500 })]))
    expect(vatGroupLabel(standard, true, 'de', euro)).toBe('zzgl. 19 % USt.')
    expect(vatGroupLabel(standard, false, 'de', euro)).toBe('19 % USt. auf 1500.00 €')
    expect(vatGroupLabel(standard, false, 'en', euro)).toBe('19% VAT on 1500.00 €')
    expect(vatGroupLabel(standard, true, 'en', euro)).toBe('plus 19% VAT')

    const [exempt] = vatGroups(printData([line({ taxRate: 0, taxCode: 'exempt' })]))
    expect(vatGroupLabel(exempt, false, 'de', euro)).toBe('0 % USt. (steuerfrei) auf 100.00 €')
    expect(vatGroupLabel(exempt, true, 'en', euro)).toBe('0% VAT (exempt)')
  })
})

describe('tax note', () => {
  it('prints the invoice’s Steuerhinweis, presets translated on English invoices', () => {
    const data = printData([line({ taxRate: 0, taxCode: 'exempt' })], {
      reverseChargeNote: 'Steuerfrei nach § 4 Nr. 20 a UStG'
    })
    expect(taxNoteOf(data, 'de')).toBe('Steuerfrei nach § 4 Nr. 20 a UStG')
    expect(taxNoteOf(data, 'en')).toBe(
      'Steuerfrei nach § 4 Nr. 20 a UStG / VAT-exempt under Section 4 No. 20(a) of the German VAT Act'
    )
    const own = printData([line({ taxRate: 0, taxCode: 'exempt' })], {
      reverseChargeNote: 'Eigener Text'
    })
    expect(taxNoteOf(own, 'en')).toBe('Eigener Text')
  })

  it('falls back to the standard wording of reverse charge and co.', () => {
    const data = printData([line({ taxRate: 0, taxCode: 'reverse_charge' })])
    expect(taxNoteOf(data, 'de')).toBe('Steuerschuldnerschaft des Leistungsempfängers')
    expect(taxNoteOf(data, 'en')).toBe('Reverse charge: VAT to be accounted for by the recipient')
  })

  it('has none for taxed invoices and exempt lines without a reason', () => {
    expect(taxNoteOf(printData([line({})]), 'de')).toBeNull()
    expect(taxNoteOf(printData([line({ taxRate: 0, taxCode: 'exempt' })]), 'de')).toBeNull()
  })

  it('needs the buyer’s VAT ID for reverse charge and intra-Community supplies', () => {
    expect(needsBuyerVatId(printData([line({})]))).toBe(false)
    expect(needsBuyerVatId(printData([line({ taxRate: 0, taxCode: 'reverse_charge' })]))).toBe(true)
    expect(needsBuyerVatId(printData([line({ taxRate: 0, taxCode: 'intra_community' })]))).toBe(
      true
    )
  })
})

describe('service date', () => {
  it('prefers the period, then the event date, else says it is the invoice date', () => {
    const period = printData([], { periodStartDate: '2026-10-01', periodEndDate: '2026-12-31' })
    expect(serviceDateOf(period, 'de')).toEqual({
      label: 'Leistungszeitraum',
      value: '01.10.2026 – 31.12.2026'
    })
    const label = printData([], { periodLabel: '4. Quartal 2025' })
    expect(serviceDateOf(label, 'de').value).toBe('4. Quartal 2025')
    const event = printData([], {}, '2026-10-21')
    expect(serviceDateOf(event, 'en')).toEqual({ label: 'Date of service', value: '21.10.2026' })
    expect(serviceDateOf(printData([]), 'de')).toEqual({
      label: 'Leistungsdatum',
      value: 'entspricht Rechnungsdatum'
    })
  })
})
