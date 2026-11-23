// English agency contracts and foreign promoters: a contract known by its folder or its text, not
// its file name, the issue date apart from the show's date, the fee with the currency in front,
// the slot, Spanish and French promoter addresses, a country in brackets. Laid out like real
// contracts; all names, numbers and addresses are invented.
import { describe, expect, it } from 'vitest'
import { parseAddress } from '../src/main/showfolder/address'
import {
  englishDate,
  extractContractEvent,
  extractContractParty,
  splitPartyName
} from '../src/main/showfolder/contractParty'
import { classifyShowFile, extractShowFacts } from '../src/main/showfolder/extract'

const BAND = 'Beispielband'

const contract = `BEISPIELBAND
CONT R ACT
Contract Iss u e Date:   21/07/26
by and between   BEISPIELBAND
Muster /Beispiel GbR
Musterweg 22
12345 Musterstadt
(hereinafter referred to as Artist)
and   Muster to the Hills, S. L .
Erika Muster
Cmno. Ejemplo, 49, Musterpueblo
30818, Musterprovincia, Spain
( hereinafter referred to as Promoter)
VAT   No.   of   the Promoter:   ESB00000000
It is understood and mutually agreed that the Promoter engages the Artist to perform the following engagement
ARTIST :   BEISPIELBAND
EVENT :   Muster del Rock Festival XVI
DATE:   12 th   August 2026
CITY:   Musterpueblo (Provincia) Spain
VENUE:   Open Air @ Polideportivo Municipal
CAPACITY:   20000 ppl
SHOWTIME/SLOT:   "Muster" Stage   /   23:05 / 00:05   -   BEISPIELBAND showtime (60')
TERMS:   The artist gets a flat guarantee of   EUR   2.100,00 ,   subject to withholding taxes`

describe('English agency contracts', () => {
  it('knows a contract by its folder or text when the file name does not say so', () => {
    const file = { name: 'Muster del Rock signed countersigned.pdf', text: contract, links: [] }
    expect(classifyShowFile({ ...file, dirs: ['Vertrag'] }, [])).toBe('contract')
    expect(classifyShowFile(file, [])).toBe('contract')
    // a letter in a contract folder that names no parties stays what it is
    expect(
      classifyShowFile(
        { name: 'Notiz.pdf', text: 'Bitte Hotel buchen.', links: [], dirs: ['Vertrag'] },
        []
      )
    ).toBe('other')
  })

  it("reads the show's date, not the issue date, the fee, the slot and the town", () => {
    expect(extractContractEvent(contract)?.date).toBe('2026-08-12')
    const facts = extractShowFacts({ name: 'x.pdf', text: contract, links: [] }, 'contract', BAND)
    expect(facts.deal.guaranteeCents).toBe(210000)
    expect(facts.itinerary).toMatchObject({ showTimeMainAct: '23:05', showLength: '60' })
    expect(facts.venue).toMatchObject({
      city: 'Musterpueblo',
      countryCode: 'ES',
      capacity: 20000
    })
  })

  it('reads the promoter with its Spanish address and VAT id', () => {
    expect(extractContractParty(contract)).toMatchObject({
      name: 'Muster to the Hills, S.L.',
      street: 'Cmno. Ejemplo 49',
      zipCode: '30818',
      countryCode: 'ES',
      vatId: 'ESB00000000'
    })
  })

  it('reads English dates in their forms', () => {
    expect(englishDate('12 th   August 2026')).toBe('2026-08-12')
    expect(englishDate('August 12, 2026')).toBe('2026-08-12')
    expect(englishDate('24th February 2026')).toBe('2026-02-24')
    expect(englishDate('soon')).toBe('')
  })
})

describe('foreign promoters', () => {
  it('puts a house number to the street word behind it and keeps a country in brackets', () => {
    expect(
      parseAddress('Erika Muster\n12, square Doyen Muster\n35200 Musterville (France)')
    ).toMatchObject({
      street: 'square Doyen Muster',
      streetNumber: '12',
      zipCode: '35200',
      city: 'Musterville',
      countryCode: 'FR'
    })
  })

  it('closes up spaced foreign legal forms', () => {
    expect(splitPartyName('Muster to the Hills, S. L .').name).toBe('Muster to the Hills, S.L.')
  })

  it('reads "CITY: FR - Musterville" as the town and its country', () => {
    const facts = extractShowFacts(
      { name: 'x.pdf', text: 'CITY:   FR - Musterville', links: [] },
      'contract',
      BAND
    )
    expect(facts.venue).toMatchObject({ city: 'Musterville', countryCode: 'FR' })
  })
})
