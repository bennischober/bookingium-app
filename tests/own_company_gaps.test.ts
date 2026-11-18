// What the own company still lacks for an invoice (Einstellungen › Allgemein › Eigene Firma).
import { describe, it, expect } from 'vitest'
import { ownCompanyGaps } from '../src/renderer/src/components/settings/ownCompanyGaps'
import type { CompanyDto } from '../src/main/api/schemas/company.schema'

const complete = {
  id: 1,
  name: 'Beispiel Agentur GmbH',
  vatId: 'DE000000000',
  taxNumber: '',
  address: {
    street: 'Musterweg',
    streetNumber: '1',
    addressSuffix: '',
    zipCode: '12345',
    city: 'Musterstadt',
    state: '',
    country: 'Deutschland',
    countryCode: 'DE'
  },
  contact: { email: 'info@example.org' },
  bank: { id: 1, bankName: 'Beispielbank', accountHolder: '', iban: 'DE00 0000', bic: '' }
} as unknown as CompanyDto

describe('ownCompanyGaps', () => {
  it('finds nothing missing on a complete company', () => {
    expect(ownCompanyGaps(complete)).toEqual([])
  })

  it('lists what a bare company lacks, in form order', () => {
    const bare = { ...complete, vatId: '', address: null, contact: null, bank: null }
    expect(ownCompanyGaps(bare)).toEqual([
      'Adresse (Straße, PLZ, Ort)',
      'E-Mail',
      'USt-IdNr. oder Steuernummer',
      'Bankverbindung mit IBAN'
    ])
  })

  it('takes a Steuernummer instead of the USt-IdNr. and needs street, PLZ and Ort', () => {
    expect(ownCompanyGaps({ ...complete, vatId: '', taxNumber: '12/345/67890' })).toEqual([])
    const noCity = { ...complete, address: { ...complete.address!, city: ' ' } }
    expect(ownCompanyGaps(noCity)).toEqual(['Adresse (Straße, PLZ, Ort)'])
  })
})
