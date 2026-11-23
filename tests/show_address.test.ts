// Addresses as show files write them: one line or several, with and without a country. All
// addresses are invented.
import { describe, expect, it } from 'vitest'
import {
  countryLabelOf,
  countryNameOf,
  parseAddress,
  zipCityOf
} from '../src/main/showfolder/address'
import { extractSheetPromoter } from '../src/main/showfolder/contractParty'
import { extractShowFacts } from '../src/main/showfolder/extract'

describe('address', () => {
  it('splits a German address on one line and knows its country by the zip', () => {
    for (const line of [
      'Musterweg 11, 12345 Musterstadt',
      'Musterweg 11 // 12345 Musterstadt',
      'Musterweg 11 12345 Musterstadt',
      'Musterweg 11\n12345 Musterstadt'
    ])
      expect(parseAddress(line)).toEqual({
        street: 'Musterweg',
        streetNumber: '11',
        zipCode: '12345',
        city: 'Musterstadt',
        countryCode: 'DE'
      })
  })

  it('reads a country prefix, a country name and keeps house number suffixes', () => {
    expect(parseAddress('Beispielgasse 3a, A-1010 Musterstadt')).toEqual({
      street: 'Beispielgasse',
      streetNumber: '3a',
      zipCode: '1010',
      city: 'Musterstadt',
      countryCode: 'AT'
    })
    expect(parseAddress('Am Beispielsee 7, 8001 Musterort, Schweiz')).toMatchObject({
      street: 'Am Beispielsee',
      streetNumber: '7',
      zipCode: '8001',
      countryCode: 'CH'
    })
    expect(parseAddress('Musterstr. 11-13, 12345 Musterstadt, Germany')).toMatchObject({
      street: 'Musterstr.',
      streetNumber: '11-13',
      countryCode: 'DE'
    })
  })

  it('guesses no country for a four-digit zip alone', () => {
    expect(zipCityOf('1010 Musterstadt')).toEqual({
      zipCode: '1010',
      city: 'Musterstadt',
      countryCode: ''
    })
    expect(zipCityOf('D-12345 Musterstadt')?.countryCode).toBe('DE')
  })

  it('keeps a street without a number', () => {
    expect(parseAddress('Am Beispielhügel, 12345 Musterdorf')).toMatchObject({
      street: 'Am Beispielhügel',
      streetNumber: '',
      zipCode: '12345'
    })
  })

  it('names countries for storing and for showing', () => {
    expect(countryNameOf('DE')).toBe('Germany')
    expect(countryLabelOf('DE')).toBe('Deutschland')
  })
})

describe('addresses in show files', () => {
  it('splits a venue address written into one field and adds the country', () => {
    const facts = extractShowFacts(
      { name: 'Itinerary.pdf', text: 'Adresse: Beispielplatz 4, 54321 Nebenort', links: [] },
      'daysheet',
      'Beispielband'
    )
    expect(facts.venue).toMatchObject({
      street: 'Beispielplatz 4',
      zipCode: '54321',
      city: 'Nebenort',
      countryCode: 'DE'
    })
  })

  it('reads a country line', () => {
    const text =
      'Venue: Halle Beispiel\nStraße: Beispielgasse 3\nPLZ Ort: 1010 Musterstadt\nLand: Österreich'
    const facts = extractShowFacts({ name: 'Day Sheet.pdf', text, links: [] }, 'daysheet', 'X')
    expect(facts.venue).toMatchObject({ zipCode: '1010', countryCode: 'AT' })
  })

  it('reads a venue address label with the town below a remark', () => {
    const text = 'Venueadresse   :   Beispielwall\n(Zufahrt über den Musterring)\n12345 Musterstadt'
    const facts = extractShowFacts({ name: 'Venue Specs.pdf', text, links: [] }, 'venue_spec', 'X')
    expect(facts.venue).toMatchObject({
      street: 'Beispielwall',
      zipCode: '12345',
      city: 'Musterstadt',
      countryCode: 'DE'
    })
  })

  it('reads a full address on a line of its own below the way to the site', () => {
    const text = [
      'Anreise   zum Festivalgelände :',
      'Für Google - Maps bitte folgende Anschrift eingeben:',
      'Am Beispielweg 21, 12345 Musterdorf'
    ].join('\n')
    const facts = extractShowFacts({ name: 'Infos.pdf', text, links: [] }, 'other', 'X')
    expect(facts.venue).toMatchObject({
      street: 'Am Beispielweg 21',
      zipCode: '12345',
      city: 'Musterdorf',
      countryCode: 'DE'
    })
    const behind =
      'Veranstaltungsgelände Adresse:\nGelände hinter Musterweg 33, 12345 Musterdorf. Zufahrt ist ausgeschildert.'
    expect(
      extractShowFacts({ name: 'Infos.docx', text: behind, links: [] }, 'other', 'X').venue
    ).toMatchObject({ street: 'Musterweg 33', zipCode: '12345', city: 'Musterdorf' })
  })

  it("takes no address from a contract's running text", () => {
    const text = [
      'Veranstaltungsort: Musterstadt',
      'Zahlungen an Beispielband GbR, Musterweg 11, 12345 Musterstadt'
    ].join('\n')
    const facts = extractShowFacts({ name: 'Vertrag.pdf', text, links: [] }, 'contract', 'X')
    expect(facts.venue.street).toBe('')
  })

  it("gives the promoter's address its parts and country", () => {
    expect(
      extractSheetPromoter(
        'Veranstalter: Muster Events GmbH\nAdresse: Musterweg 11, 12345 Musterstadt'
      )
    ).toMatchObject({
      street: 'Musterweg 11',
      zipCode: '12345',
      city: 'Musterstadt',
      countryCode: 'DE'
    })
    expect(
      extractSheetPromoter('Veranstalter: Muster Events GmbH\nMusterweg 11\n12345 Musterstadt')
    ).toMatchObject({ countryCode: 'DE' })
  })
})
