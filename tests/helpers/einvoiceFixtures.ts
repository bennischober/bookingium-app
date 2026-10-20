// Fictitious e-invoice data for the unit tests and the KoSIT validation
// samples (never real master data)
import type { InvoicePartySnapshotDto } from '../../src/main/api/schemas/invoice.schema'
import type { EInvoiceInput } from '../../src/main/einvoice/prepare'

// ========================================
// Fixtures (fictitious data)
// ========================================

export function party(overrides: Partial<InvoicePartySnapshotDto> = {}): InvoicePartySnapshotDto {
  return {
    id: 1,
    kind: 'company',
    legalName: 'Beispiel Booking GmbH',
    street: 'Musterstraße',
    streetNumber: '1',
    zipCode: '10115',
    city: 'Berlin',
    country: 'Deutschland',
    countryCode: 'DE',
    vatNumber: 'DE123456789',
    ustNumber: '',
    taxNumber: '27/123/45678',
    commercialRegisterNo: 'HRB 12345',
    registerCourt: 'AG Berlin',
    website: '',
    accountHolder: 'Beispiel Booking GmbH',
    bankName: 'Testbank',
    logoPath: '',
    email: 'rechnung@beispiel.test',
    phone: '+49 30 123456',
    iban: 'DE02 1203 0000 0000 2020 51',
    bic: 'BYLADEM1001',
    contactName: 'Erika Muster',
    contactPhone: '+49 30 123457',
    contactEmail: 'erika@beispiel.test',
    ...overrides
  }
}

export const buyer = (overrides: Partial<InvoicePartySnapshotDto> = {}) =>
  party({
    legalName: 'Konzertveranstaltung Nord GmbH & Co. KG',
    street: 'Hafenweg',
    streetNumber: '7',
    zipCode: '20095',
    city: 'Hamburg',
    vatNumber: 'DE987654321',
    taxNumber: '',
    commercialRegisterNo: '',
    email: 'buchhaltung@nord.test',
    iban: '',
    bic: '',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    ...overrides
  })

export function invoice(overrides: Partial<EInvoiceInput> = {}): EInvoiceInput {
  return {
    invoiceNumber: 1040,
    issueDate: '2026-10-15',
    dueDate: '2026-10-29',
    currency: 'EUR',
    buyerReference: '',
    periodStartDate: null,
    periodEndDate: null,
    eventDate: '2026-10-10',
    paymentTerms: 'Zahlbar innerhalb von 14 Tagen',
    taxNote: '',
    notes: '',
    seller: party(),
    buyer: buyer(),
    lines: [
      {
        description: 'Gage Konzert',
        quantity: 1,
        unit: 'service',
        unitPriceNet: 3000,
        taxRate: 19,
        taxCode: 'standard'
      }
    ],
    ...overrides
  }
}

/** One sample per VAT case, validated with the KoSIT validator (einvoice.kosit.test.ts) */
export const EINVOICE_SAMPLES: Record<string, EInvoiceInput> = {
  'domestic-19-7': invoice({
    buyerReference: '04011000-12345-34',
    periodStartDate: '2026-10-01',
    periodEndDate: '2026-10-31',
    notes: 'Danke für die Zusammenarbeit',
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
      },
      {
        description: 'Technik',
        quantity: 2.5,
        unit: 'hour',
        unitPriceNet: 0.333,
        taxRate: 19,
        taxCode: 'standard'
      }
    ]
  }),
  'reverse-charge-eu': invoice({
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
  }),
  'exempt-and-standard': invoice({
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
  }),
  'not-subject-to-vat': invoice({
    buyer: buyer({ countryCode: 'US', country: 'USA', vatNumber: '', street: 'Main St' }),
    lines: [
      {
        description: 'Show fee',
        quantity: 1,
        unit: 'service',
        unitPriceNet: 4000,
        taxRate: 0,
        taxCode: 'not_taxable'
      }
    ]
  }),
  'intra-community': invoice({
    buyer: buyer({ countryCode: 'FR', country: 'Frankreich', vatNumber: 'FR12345678901' }),
    lines: [
      {
        description: 'Merchandise',
        quantity: 20,
        unit: 'piece',
        unitPriceNet: 12,
        taxRate: 0,
        taxCode: 'intra_community'
      }
    ]
  }),
  export: invoice({
    buyer: buyer({ countryCode: 'CH', country: 'Schweiz', vatNumber: 'CHE123456789' }),
    lines: [
      {
        description: 'Merchandise',
        quantity: 5,
        unit: 'piece',
        unitPriceNet: 15,
        taxRate: 0,
        taxCode: 'export'
      }
    ]
  }),
  'seller-without-contact-and-iban': invoice({
    seller: party({ contactName: '', contactPhone: '', contactEmail: '', iban: '', bic: '' }),
    dueDate: null,
    lines: [
      {
        description: 'Managementbeteiligung 4. Quartal 2025',
        quantity: 1,
        unit: 'service',
        unitPriceNet: 22843.52,
        taxRate: 19,
        taxCode: 'standard'
      }
    ]
  }),
  'credit-note': invoice({
    invoiceNumber: 1042,
    paymentTerms: 'Storno der Rechnung Nr. 1040 vom 15.10.2026',
    dueDate: null,
    cancels: { invoiceNumber: 1040, issueDate: '2026-10-15' }
  }),
  xrechnung: invoice({
    xrechnung: true,
    buyerReference: '991-01234-56',
    buyer: buyer({ legalName: 'Stadt Musterstadt, Kulturamt' })
  }),
  'xrechnung-credit-note': invoice({
    xrechnung: true,
    invoiceNumber: 1043,
    buyerReference: '991-01234-56',
    dueDate: null,
    paymentTerms: 'Storno der Rechnung Nr. 1041 vom 15.10.2026',
    cancels: { invoiceNumber: 1041, issueDate: '2026-10-15' }
  })
}
