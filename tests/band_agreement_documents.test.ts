// The printed publishing and label agreements in German and English: the record's terms in the
// text, the model's alternatives picked by the record, optional parts left out, and nothing that
// names where the templates came from.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ContractParty } from '../src/main/api/schemas/contract.schema'
import {
  parseAgreementTerms,
  type BandAgreementPrintData,
  type LabelTerms,
  type PublishingTerms
} from '../src/main/api/schemas/band_agreement.schema'
import { PublishingAgreementDocument } from '../src/renderer/src/components/contract/PublishingAgreementDocument'
import { LabelAgreementDocument } from '../src/renderer/src/components/contract/LabelAgreementDocument'

const party = (name: string, city: string): ContractParty => ({
  id: 1,
  name,
  street: 'Musterweg',
  streetNumber: '1',
  zipCode: '10115',
  city,
  country: 'Deutschland',
  email: 'band@example.test',
  phone: '',
  vatId: '',
  taxNumber: '',
  kskNumber: '',
  bankName: 'Example Bank',
  accountHolder: name,
  iban: 'DE02 1203 0000 0000 2020 51',
  bic: 'BYLADEM0001',
  signaturePath: '',
  representative: ''
})

const base = {
  id: 1,
  bandId: 1,
  companyId: 2,
  startDate: null,
  specialClauses: '',
  createdAt: '2026-11-01 00:00:00',
  updatedAt: null
}

function data(agreement: BandAgreementPrintData['agreement']): BandAgreementPrintData {
  return {
    agreement,
    band: { id: 1, name: 'Example Band' },
    artist: party('Example Band GbR', 'Berlin'),
    company: party('Example Records GmbH', 'Hamburg'),
    companyLogoPath: null
  }
}

const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')

function publishing(terms: Partial<PublishingTerms>, lang: 'de' | 'en', specialClauses = '') {
  const agreement = {
    ...base,
    specialClauses,
    kind: 'publishing' as const,
    terms: parseAgreementTerms('publishing', terms)
  }
  return text(
    renderToStaticMarkup(
      createElement(PublishingAgreementDocument, { data: data(agreement) as never, lang })
    )
  )
}

function label(terms: Partial<LabelTerms>, lang: 'de' | 'en') {
  const agreement = { ...base, kind: 'label' as const, terms: parseAgreementTerms('label', terms) }
  return text(
    renderToStaticMarkup(
      createElement(LabelAgreementDocument, { data: data(agreement) as never, lang })
    )
  )
}

/** Names, places and companies of the templates the user provided */
const SOURCES = ['VUT', 'Hamburg Hamburg', 'Reaper', 'Abtsgmünd', 'Rough Trade', 'Edel', 'Soulfood']

describe('publishing contract', () => {
  it('prints the German model with the record’s terms', () => {
    const de = publishing(
      { authorGemaNumber: '123456', publisherImprint: 'Example Edition', printSinglePercent: 12 },
      'de'
    )
    expect(de).toContain('VERLAGSVERTRAG (Titelvertrag)')
    expect(de).toContain('GEMA-Mitgliedsnummer 123456')
    expect(de).toContain('Example Edition')
    expect(de).toContain('12 % von den verkauften Notendruckausgaben')
    expect(de).toContain('Dauer der jeweils gültigen gesetzlichen Schutzfristen')
    expect(de).toContain('IBAN: DE02 1203 0000 0000 2020 51')
    expect(de).toContain('drei (3) Jahre nach Vertragsende')
    expect(de).not.toContain('ANLAGE B')
  })

  it('prints the English model in the same structure', () => {
    const en = publishing({ rightsTerm: 'years', rightsYears: 25, unknownUses: 'market' }, 'en')
    expect(en).toContain('PUBLISHING CONTRACT (Title Contract)')
    expect(en).toContain('for the duration of 25 years following the initial publication')
    expect(en).toContain('in the light of the then prevalent market conditions')
    expect(en).toContain('which do not affect the AUTHOR’s moral rights')
    const sections = (sheet: string) => sheet.match(/ \d{1,2}\. [A-ZÄÖÜ]/g)?.length
    expect(sections(en)).toBe(sections(publishing({}, 'de')))
    for (const word of ['Vertrag', 'zwischen', 'AUTOR ']) expect(en, word).not.toContain(word)
  })

  it('adds annex B only for an exclusive contract, each part only with its values', () => {
    const en = publishing(
      {
        exclusive: true,
        exclusiveStart: '2026-11-01',
        exclusiveEnd: '2028-10-31',
        options: 2,
        advance: 5000,
        minWorksTerm: 10
      },
      'en'
    )
    expect(en).toContain('ANNEX B')
    expect(en).toContain('commence to run on 1 November 2026 and expires on 31 October 2028')
    expect(en).toContain('two (2) exclusive options')
    expect(en).toContain('EUR 5,000.00')
    expect(en).toContain('at the least deliver 10 new, unpublished works')
    expect(en).not.toContain('Rolling Advance')
    expect(en).not.toContain('Refund')
  })

  it('lists the works and the special agreements', () => {
    const de = publishing(
      { works: [{ title: 'Song A', composer: 'A', lyricist: 'B', publisherShare: '100 %' }] },
      'de',
      'Extra'
    )
    expect(de).toContain('Song A')
    expect(de).toContain('Sondervereinbarungen')
    expect(de).toContain('Extra')
  })

  it('names nobody from the model', () => {
    const sheet = publishing({ exclusive: true, minWorksTerm: 5, advance: 1 }, 'de')
    for (const word of SOURCES) expect(sheet, word).not.toContain(word)
  })
})

describe('label head of agreement', () => {
  const terms: Partial<LabelTerms> = {
    titleExclusivity: '10 years',
    physicalRoyalties: [
      { from: 2001, percent: 23 },
      { from: 0, percent: 22 }
    ],
    digitalRoyalties: [{ from: 0, percent: 40 }],
    optionAdvances: [
      { fromCopies: 0, amount: 5000 },
      { fromCopies: 5000, amount: 10000 }
    ]
  }

  it('prints the English template with the record’s terms', () => {
    const en = label({ ...terms, offerPublishing: true }, 'en')
    expect(en).toContain('HEAD OF AGREEMENT')
    expect(en).toContain('Licensee: Example Records GmbH')
    expect(en).toContain('22% of the applicable net ARP')
    expect(en).toContain('23% after 2,001 sold albums of the applicable net ARP')
    expect(en).toContain('1–4,999 sold copies on high or mid price of previous album: €5,000')
    expect(en).toContain('5,000+ sold copies')
    expect(en).toContain('We can offer a publishing deal via Example Records GmbH.')
    expect(en).not.toContain('Online Store')
    expect(en).toContain('members in the band Example Band possess the full unlimited right')
  })

  it('prints the German translation, defaults included', () => {
    const de = label(terms, 'de')
    expect(de).toContain('ECKPUNKTEVEREINBARUNG')
    expect(de).toContain('Exklusive physische und digitale Auswertung')
    expect(de).toContain('Gebiet: Welt')
    expect(de).toContain('23 % ab 2.001 verkauften Alben')
    expect(de).not.toContain('Exclusive physical')
  })

  it('names nobody from the template', () => {
    const sheet = label(terms, 'en')
    for (const word of SOURCES) expect(sheet, word).not.toContain(word)
  })
})
