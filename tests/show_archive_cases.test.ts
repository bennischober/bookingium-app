// Cases from reading whole booking archives: contract forms with placeholders and towns in the
// place lines, promoter lines with the address glued on, scanned contracts, agency info sheets,
// the band's own address in settlements, torn and foreign addresses, folder names. Laid out like
// real files; all names, numbers and addresses are invented.
import { describe, expect, it } from 'vitest'
import { parseShowFolderName } from '../src/main/archive/showFolders'
import { mendAddressWords, parseAddress, zipCityOf } from '../src/main/showfolder/address'
import {
  extractContractEvent,
  extractContractParty,
  extractSheetPromoter,
  splitPartyName
} from '../src/main/showfolder/contractParty'
import { cleanPlaceName, extractShowFacts, placeNameOf } from '../src/main/showfolder/extract'

const BAND = 'Beispielband'

describe('contract forms', () => {
  const form = `KONZERTVERTRAG
und dem   örtlichen   Veranstalter :   Beispiel 1920 Musterdorf e.V. ,   Musterweg 4c
12345 Musterdorf
vertreten durch :   Erika Muster, Max Beispiel
Veranstaltungsdatum:   03.02.26
Event/Veranstaltung:   Rocknacht Musterdorf
Veranstaltungsort:   12345 Musterdorf Ortsteil
Location:   tba
Adresse der Location :   bi tte   nachtrag en!
Kapazität :   800`

  it('reads the town from the place line, never a placeholder, and a two-digit year', () => {
    const facts = extractShowFacts({ name: 'Vertrag.pdf', text: form, links: [] }, 'contract', BAND)
    expect(facts.venue).toMatchObject({
      name: '',
      street: '',
      zipCode: '12345',
      city: 'Musterdorf Ortsteil',
      countryCode: 'DE',
      capacity: 800
    })
    expect(facts.venue.notes).toEqual([])
    expect(extractContractEvent(form)).toMatchObject({
      date: '2026-02-03',
      eventName: 'Rocknacht Musterdorf'
    })
    expect(extractContractParty(form)).toMatchObject({
      name: 'Beispiel 1920 Musterdorf e.V.',
      street: 'Musterweg 4c',
      zipCode: '12345',
      city: 'Musterdorf',
      contactName: 'Erika Muster'
    })
  })

  it('splits a promoter line from the address glued to it', () => {
    expect(
      splitPartyName('Muster - Rock GmbH   Musterweg 21 .   12345 Musterdorf - Ortsteil')
    ).toEqual({
      name: 'Muster-Rock GmbH',
      rest: ['Musterweg 21', '12345 Musterdorf-Ortsteil']
    })
    expect(
      splitPartyName('Beispiel Heavy Metal Club e.V. Musterweg 5 in 12345 Musterdorf')
    ).toEqual({
      name: 'Beispiel Heavy Metal Club e.V.',
      rest: ['Musterweg 5', '12345 Musterdorf']
    })
    expect(splitPartyName('The Muster House GbR Musterweg 5 12345 Musterdorf .')).toEqual({
      name: 'The Muster House GbR',
      rest: ['Musterweg 5', '12345 Musterdorf']
    })
    expect(splitPartyName('und dem örtlichen Veranstalter; Beispiel e.V.').name).toBe(
      'Beispiel e.V.'
    )
    expect(splitPartyName('Beispiel Hilfe e. V.').name).toBe('Beispiel Hilfe e. V.')
    // a street or a house number with a word is no promoter
    expect(splitPartyName('Muster-Weg 1').name).toBe('')
    expect(splitPartyName('4 Musterhaven').name).toBe('')
  })

  it('reads a scanned contract: the label twice, ";" for ":", "vertreten durch" after the town', () => {
    const scan = `und   dem   örtlichen   Veranstalter:   und   dem   örtlichen   Veranstalter;   Beispiel   im   Land   e.V.,   Erika   Muster,   Musterweg   5,
12345   Musterdorf   vertreten   durch;   Erika   Muster
Steuernummer/VAT-Nummer   des   örtlichen   Veranstalters;   27/000/01234`
    expect(extractContractParty(scan)).toMatchObject({
      name: 'Beispiel im Land e.V.',
      street: 'Musterweg 5',
      zipCode: '12345',
      city: 'Musterdorf',
      contactName: 'Erika Muster',
      taxNumber: '27/000/01234'
    })
  })

  it('takes the name from "Promoter:" behind an empty "Promoter /Veranstalter :"', () => {
    const text =
      'Promoter /Veranstalter :   Promoter:   Muster Promotions\nAnsprechp.   Erika Muster'
    expect(extractContractParty(text)?.name).toBe('Muster Promotions')
  })
})

describe('agency info sheets', () => {
  it('names no promoter for an empty "Promoter:" or "siehe Venue Specs"', () => {
    const empty =
      'Promoter /Veranstalter :   Promoter:\nAnsprechp.   Erika Muster\nMobil:   0151 0000001'
    expect(extractSheetPromoter(empty)).toBeNull()
    const torn = 'Promoter /Veranstalter :   Promoter:\nAns prechp.   Erika'
    expect(extractSheetPromoter(torn)).toBeNull()
    expect(
      extractSheetPromoter('Promoter /Veranstalter :   Promoter:   siehe Venue   Specs')
    ).toBeNull()
  })

  it('keeps the company apart from a first name behind it, and a role is no person', () => {
    expect(
      extractSheetPromoter(
        'Promoter:   Muster Veranstaltungen GmbH / Max\nAnsprechp.   Erika Muster'
      )
    ).toMatchObject({ name: 'Muster Veranstaltungen GmbH', contactName: 'Erika Muster' })
    expect(
      extractSheetPromoter('Promoter:   Muster Concerts\nContact:   Technical Production')
    ).toMatchObject({ name: 'Muster Concerts', contactName: '' })
  })

  it('swaps a person named as promoter with the company below', () => {
    expect(extractSheetPromoter('Promoter:   Erika Muster\nMuster Events')).toMatchObject({
      name: 'Muster Events',
      contactName: 'Erika Muster'
    })
  })

  it('reads a promoter block headed "Veranstalter Daten" with the person above the company', () => {
    const text = `Veranstalter Daten / Kontakt 11.05.26
Erika Muster
Vorsitzende
Beispielhilfe Musterstadt e. V.
Musterweg 1 F, 12345 Musterstadt
Telefon: 0173 0000001
Rechnungsadresse: Beispielhilfe Musterstadt e. V.`
    expect(extractSheetPromoter(text)).toMatchObject({
      name: 'Beispielhilfe Musterstadt e. V.',
      street: 'Musterweg 1F',
      zipCode: '12345',
      city: 'Musterstadt',
      contactName: 'Erika Muster'
    })
  })

  it('ends the block at the act ("ARTIST:") before the agency address', () => {
    const memo = `PROMOTER:   Muster Promotions Ltd
BILLING:   Headline
ARTIST:   Beispielband
Beispiel Konzertbüro
Musterweg 21
12345 Musterstadt`
    expect(extractSheetPromoter(memo)).toMatchObject({
      name: 'Muster Promotions Ltd',
      street: '',
      contactName: ''
    })
  })
})

describe('places', () => {
  it('cleans place names and refuses what is none', () => {
    expect(cleanPlaceName('FES TIVAL: 3 3 . Muster   Open Air 202 6')).toBe('Muster Open Air')
    expect(cleanPlaceName('„Musterwerk Beispieldorf“ (Musterweg)')).toBe('Musterwerk Beispieldorf')
    expect(cleanPlaceName('Open Air am Berg, Musterweg, 12345 Musterstadt')).toBe(
      'Open Air am Berg'
    )
    expect(cleanPlaceName('25. Muster Rocknacht')).toBe('Muster Rocknacht')
    expect(cleanPlaceName('Festival der kommunalen Jugendarbeit')).toBe(
      'Festival der kommunalen Jugendarbeit'
    )
    expect(cleanPlaceName('Z7')).toBe('Z7')
    for (const none of [
      'head of festival',
      'www.muster-rock.example.test',
      'tba',
      '32',
      'FESTIVAL'
    ])
      expect(cleanPlaceName(none)).toBe('')
  })

  it("takes the contract's event as the folder spells it, and no dash", () => {
    expect(placeNameOf('Acker Musterdorf', 'Musterdorf Rock im Beispiel', 'Rock im Beispiel')).toBe(
      'Rock im Beispiel'
    )
    expect(placeNameOf('', 'Musterdorf - Muster Rock', 'Muster Rock')).toBe('Muster Rock')
  })

  it("takes no venue address from a settlement or from the band's own block", () => {
    const own = 'Beispielband GbR\nMusterweg 22\n12345 Musterstadt\nAbrechnung'
    for (const kind of ['settlement', 'other'] as const)
      expect(
        extractShowFacts({ name: 'Abrechnung.pdf', text: own, links: [] }, kind, BAND).venue
      ).toMatchObject({ street: '', zipCode: '' })
  })

  it('reads the date range of a folder written with an underscore', () => {
    expect(parseShowFolderName('2026-06-28_29 MUSTERDORF - Rock am Beispielsee')).toEqual({
      date: '2026-06-28',
      endDate: '2026-06-29',
      title: 'MUSTERDORF - Rock am Beispielsee'
    })
  })
})

describe('addresses', () => {
  it('mends torn words and reads Dutch zips', () => {
    expect(mendAddressWords('M usterstr. 10')).toBe('Musterstr. 10')
    expect(mendAddressWords('Ka iserslautern')).toBe('Kaiserslautern')
    expect(mendAddressWords('Musterbr ü cken')).toBe('Musterbrücken')
    expect(mendAddressWords('Summer - Breeze - Weg 1')).toBe('Summer-Breeze-Weg 1')
    expect(mendAddressWords('Am Beispielsee 3')).toBe('Am Beispielsee 3')
    expect(zipCityOf('7511 PG Musterdam')).toEqual({
      zipCode: '7511 PG',
      city: 'Musterdam',
      countryCode: 'NL'
    })
    expect(parseAddress('Musterweg 5 in 12345 Musterdorf')).toMatchObject({
      street: 'Musterweg',
      streetNumber: '5',
      zipCode: '12345'
    })
  })
})
