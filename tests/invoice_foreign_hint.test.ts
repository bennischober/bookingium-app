// Invoices abroad: the print page suggests English and the tax code that usually fits a
// foreign recipient, and warns when reverse charge lacks the buyer's VAT ID. Only hints:
// nothing here changes the invoice.
import { describe, expect, it } from 'vitest'
import type {
  InvoiceDto,
  InvoiceLineItemDto,
  InvoicePartySnapshotDto,
  InvoicePrintDto
} from '../src/main/api/schemas/invoice.schema'
import {
  foreignRecipientHint,
  recipientCountryCode,
  suggestDocumentLang
} from '../src/main/invoice/taxSummary'
import { party } from './helpers/einvoiceFixtures'

const line = (overrides: Partial<InvoiceLineItemDto> = {}): InvoiceLineItemDto =>
  ({ lineNetAmount: 100, taxRate: 19, taxCode: 'standard', ...overrides }) as InvoiceLineItemDto

function printData(
  recipient: Partial<InvoicePartySnapshotDto>,
  items: InvoiceLineItemDto[] = [line()]
): InvoicePrintDto {
  return {
    invoice: { lineItems: items, reverseChargeNote: '' } as unknown as InvoiceDto,
    issuer: party(),
    recipient: party({ vatId: '', ...recipient }),
    venueName: null,
    eventDate: null,
    managementShare: null,
    bandName: null
  }
}

const reverseCharge = line({ taxRate: 0, taxCode: 'reverse_charge' })

describe('document language suggestion', () => {
  it('suggests German for Germany, German-speaking and unknown countries', () => {
    expect(suggestDocumentLang(printData({ countryCode: 'DE' }))).toBe('de')
    expect(suggestDocumentLang(printData({ countryCode: 'AT', country: 'Österreich' }))).toBe('de')
    expect(suggestDocumentLang(printData({ countryCode: 'CH', country: 'Schweiz' }))).toBe('de')
    expect(suggestDocumentLang(printData({ countryCode: '', country: '' }))).toBe('de')
  })

  it('suggests English for every other country', () => {
    expect(suggestDocumentLang(printData({ countryCode: 'NL', country: 'Niederlande' }))).toBe('en')
    expect(suggestDocumentLang(printData({ countryCode: 'GB', country: 'United Kingdom' }))).toBe(
      'en'
    )
  })

  it('reads the country name when the snapshot has no code', () => {
    expect(recipientCountryCode(printData({ countryCode: '', country: 'Frankreich' }))).toBe('FR')
    expect(suggestDocumentLang(printData({ countryCode: '', country: 'France' }))).toBe('en')
  })
})

describe('foreign recipient hint', () => {
  it('has nothing to say for a German recipient with German VAT', () => {
    expect(foreignRecipientHint(printData({ countryCode: 'DE', vatId: 'DE123456789' }))).toBeNull()
  })

  it('suggests reverse charge for an EU business with a VAT ID charged German VAT', () => {
    expect(foreignRecipientHint(printData({ countryCode: 'NL', vatId: 'NL123456789B01' }))).toEqual(
      {
        countryCode: 'NL',
        situation: 'eu_vat_id',
        suggestedTaxCode: 'reverse_charge',
        chargesGermanVat: true,
        missingVatId: false
      }
    )
  })

  it('is content once the EU business is invoiced with reverse charge', () => {
    const hint = foreignRecipientHint(
      printData({ countryCode: 'NL', vatId: 'NL123456789B01' }, [reverseCharge])
    )
    expect(hint?.chargesGermanVat).toBe(false)
    expect(hint?.missingVatId).toBe(false)
  })

  it('suggests "not taxable" outside the EU', () => {
    const hint = foreignRecipientHint(printData({ countryCode: 'GB' }))
    expect(hint?.situation).toBe('non_eu')
    expect(hint?.suggestedTaxCode).toBe('not_taxable')
    expect(hint?.chargesGermanVat).toBe(true)
    const notTaxable = foreignRecipientHint(
      printData({ countryCode: 'US' }, [line({ taxRate: 0, taxCode: 'not_taxable' })])
    )
    expect(notTaxable?.chargesGermanVat).toBe(false)
  })

  it('suggests no tax code for an EU recipient without a VAT ID', () => {
    const hint = foreignRecipientHint(printData({ countryCode: 'FR' }))
    expect(hint?.situation).toBe('eu_no_vat_id')
    expect(hint?.suggestedTaxCode).toBeNull()
    expect(hint?.chargesGermanVat).toBe(false)
  })

  it('warns when reverse charge is chosen but the recipient has no VAT ID', () => {
    expect(
      foreignRecipientHint(printData({ countryCode: 'FR' }, [reverseCharge]))?.missingVatId
    ).toBe(true)
    // Also for a German recipient: reverse charge always prints the buyer's VAT ID
    const domestic = foreignRecipientHint(printData({ countryCode: 'DE' }, [reverseCharge]))
    expect(domestic).toMatchObject({ situation: null, missingVatId: true })
    // A blank VAT ID counts as missing
    expect(
      foreignRecipientHint(printData({ countryCode: 'AT', vatId: '  ' }, [reverseCharge]))
        ?.missingVatId
    ).toBe(true)
  })
})
