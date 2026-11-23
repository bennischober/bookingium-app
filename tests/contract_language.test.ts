// Contracts print in German or English, picked on the print page. Each contract has an
// English version worded from the English templates, with the same data as the German one;
// rendered to static markup, both languages are checked for their words and the contract's
// values.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ContractData, ContractParty } from '../src/main/api/schemas/contract.schema'
import type { ManagementContractPrintData } from '../src/main/api/schemas/management_contract.schema'
import { contractEmailLang } from '../src/main/mail/contractEmail'
import { ContractDocument } from '../src/renderer/src/components/contract/ContractDocument'
import { ManagementContractDocument } from '../src/renderer/src/components/contract/ManagementContractDocument'
import { CONTRACT_FILE_NAMES } from '../src/renderer/src/components/contract/contractLanguage'
import { englishNumberWord, englishQuantity } from '../src/renderer/src/lib/englishNumbers'

const party = (overrides: Partial<ContractParty> = {}): ContractParty => ({
  id: 1,
  name: 'Example Artist GbR',
  street: 'Example Street',
  streetNumber: '1',
  zipCode: '10115',
  city: 'Berlin',
  country: 'Deutschland',
  email: 'artist@example.test',
  phone: '',
  vatId: '',
  taxNumber: '',
  kskNumber: '',
  bankName: 'Example Bank',
  accountHolder: 'Example Artist GbR',
  iban: 'DE02 1203 0000 0000 2020 51',
  bic: 'BYLADEM0001',
  signaturePath: '',
  representative: '',
  ...overrides
})

function concertData(overrides: Partial<ContractData['dealMemo']> = {}): ContractData {
  return {
    dealMemo: {
      id: 1,
      name: 'Example Show',
      date: '2026-10-21',
      amountOfPeople: 6,
      roomInformation: '3 twin rooms',
      performanceDuration: '90 min',
      performanceTime: '21:00',
      performanceInformation: '',
      guaranteeAmount: 2000,
      guaranteeVatRate: 19,
      deposits: [{ amount: 500, dueDate: '2026-09-01' }],
      contractNotes: '',
      notes: '',
      deal: '',
      posters: '20',
      ...overrides
    },
    band: { id: 1, name: 'Example Band' },
    artist: party(),
    letterheadLogoPath: null,
    representative: party({ name: 'Example Agency GmbH', city: 'Hamburg' }),
    promoter: party({ name: 'Example Promotions Ltd', city: 'London', country: 'United Kingdom' }),
    technician: null,
    venue: { id: 1, name: 'Example Hall', city: 'London', capacity: 500 },
    hotel: null
  }
}

function managementData(): ManagementContractPrintData {
  return {
    contract: {
      id: 1,
      bandId: 1,
      managementCompanyId: 1,
      startDate: '2026-11-01',
      territory: 'örtlich unbeschränkt',
      termYears: 3,
      renewalYears: 1,
      noticeMonths: 6,
      commissionPercent: 20,
      agencyPercent: 0,
      excludedIncome: '',
      statementEmail: 'statements@example.test',
      settlementDays: 30,
      paymentDays: 14,
      postTermYear1Percent: 75,
      postTermYear2Percent: 50,
      postTermYear3Percent: 30,
      representativePersonId: null,
      specialClauses: '',
      memberPersonIds: [],
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z'
    },
    band: { id: 1, name: 'Example Band' },
    management: party({ name: 'Example Management GmbH', city: 'Hamburg' }),
    managementLogoPath: null,
    artist: party(),
    members: [],
    representative: null
  } as unknown as ManagementContractPrintData
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')

// German words of the contracts that must not appear on an English one
// ("Künstlersozialkasse" stays: the name of the German authority)
const GERMAN_WORDS = [
  'Vertrag',
  'zwischen',
  'vertreten',
  'Honorar',
  'Abrechnung',
  'Bühne',
  ' den ',
  'Uhr',
  'zzgl.'
]

describe('contract language', () => {
  it('starts from the other party’s country', () => {
    expect(contractEmailLang('Deutschland')).toBe('de')
    expect(contractEmailLang('Österreich')).toBe('de')
    expect(contractEmailLang('Netherlands')).toBe('en')
    expect(contractEmailLang('')).toBe('de')
  })

  it('names the PDF in the contract’s language', () => {
    expect(CONTRACT_FILE_NAMES.concert).toEqual({
      de: 'Auftrittsvertrag',
      en: 'Concert performance agreement'
    })
    expect(CONTRACT_FILE_NAMES.management).toEqual({
      de: 'Managementvertrag',
      en: 'Management agreement'
    })
  })

  it('writes contract numbers as English words', () => {
    expect(englishNumberWord(3)).toBe('three')
    expect(englishNumberWord(14)).toBe('fourteen')
    expect(englishNumberWord(30)).toBe('thirty')
    expect(englishNumberWord(21)).toBe('twenty-one')
    expect(englishNumberWord(120)).toBe('120')
    expect(englishQuantity(1, 'year', 'years')).toBe('one (1) year')
    expect(englishQuantity(6, 'month’s', 'months’')).toBe('six (6) months’')
  })
})

describe('concert contract', () => {
  it('prints the German contract in German', () => {
    const sheet = text(
      renderToStaticMarkup(createElement(ContractDocument, { data: concertData() }))
    )
    expect(sheet).toContain('KONZERTVERTRAG')
    expect(sheet).toContain('zzgl. 19 % MwSt.')
  })

  it('prints the English contract from the templates with the event’s values', () => {
    const en = text(
      renderToStaticMarkup(createElement(ContractDocument, { data: concertData(), lang: 'en' }))
    )
    expect(en).toContain('CONCERT PERFORMANCE AGREEMENT')
    expect(en).toContain('(hereinafter referred to as “Artist”)')
    expect(en).toContain('(hereinafter referred to as “Agent”)')
    expect(en).toContain('Date of Performance: 21 October 2026')
    expect(en).toContain('Venue: Example Hall')
    expect(en).toContain(
      'The Promoter agrees to pay for this performance a guarantee of €2,000.00 plus 19% VAT (total: €2,380.00)'
    )
    expect(en).toContain('Advance Payment: €500.00 plus 19% VAT, due by 1 September 2026')
    expect(en).toContain('for 6 persons: 3 twin rooms')
    expect(en).toContain('IBAN: DE02 1203 0000 0000 2020 51')
    expect(en).toContain('p.p. Example Agency GmbH')
    for (const word of GERMAN_WORDS) expect(en, word).not.toContain(word)
    expect(en).not.toMatch(/Künstler/)
    // General terms numbered without gaps, the special agreements left out when empty
    const terms = en.match(/\b\d{1,2}(?=\) [A-Z])/g) ?? []
    expect(terms).toEqual(terms.map((_, index) => String(index + 1)))
    expect(terms).toHaveLength(19)
    expect(en).not.toContain('SPECIAL AGREEMENTS')
  })

  it('names nobody from the templates', () => {
    const en = text(
      renderToStaticMarkup(createElement(ContractDocument, { data: concertData(), lang: 'en' }))
    )
    // The templates' places of jurisdiction, offices and fixed amounts
    for (const word of ['Ulm', 'Dortmund', 'Mengen', 'Frankfurt', '200,-', '30 persons']) {
      expect(en, word).not.toContain(word)
    }
  })

  it('leaves the advance payment out and adds the special agreements', () => {
    const en = text(
      renderToStaticMarkup(
        createElement(ContractDocument, {
          data: concertData({ deposits: [], contractNotes: 'Extra drum riser' }),
          lang: 'en'
        })
      )
    )
    expect(en).not.toContain('Advance Payment')
    expect(en).toContain('20) SPECIAL AGREEMENTS')
    expect(en).toContain('Extra drum riser')
  })
})

describe('management contract', () => {
  it('prints the English agreement with the contract record’s terms', () => {
    const en = text(
      renderToStaticMarkup(
        createElement(ManagementContractDocument, { data: managementData(), lang: 'en' })
      )
    )
    expect(en).toContain('MANAGEMENT AGREEMENT')
    expect(en).toContain('without restrictions as to territory')
    expect(en).toContain('a duration of three (3) years')
    expect(en).toContain('successive one (1) year periods')
    expect(en).toContain('six (6) months’ notice')
    expect(en).toContain('20%')
    expect(en).toContain('within thirty (30) days following the end of the quarter')
    expect(en).toContain('within fourteen (14) days')
    expect(en).toContain('statements@example.test')
    expect(en).toContain('to 75% of the initial claim')
    expect(en).toContain('Hamburg, on')
    for (const word of ['Vertrag', 'zwischen', 'KÜNSTLER', 'örtlich', ' den ']) {
      expect(en, word).not.toContain(word)
    }
  })

  it('has the same sections in German and English', () => {
    // The section headings, not the references in the text
    const section = (markup: string) => (markup.match(/<h3[^>]*>§ \d+/g) ?? []).join(',')
    const de = renderToStaticMarkup(
      createElement(ManagementContractDocument, { data: managementData() })
    )
    const en = renderToStaticMarkup(
      createElement(ManagementContractDocument, { data: managementData(), lang: 'en' })
    )
    expect(de).toContain('MANAGEMENTVERTRAG')
    expect(section(en)).toBe(section(de))
    expect(section(en).split(',')).toHaveLength(16)
  })

  it('prints a territory typed as free text as it is', () => {
    const data = managementData()
    data.contract.territory = 'Europe'
    const en = text(
      renderToStaticMarkup(createElement(ManagementContractDocument, { data, lang: 'en' }))
    )
    expect(en).toContain('within the following territory: Europe')
  })
})
