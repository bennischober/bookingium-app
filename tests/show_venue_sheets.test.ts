// A venue's or festival's own sheets: its tech rider with the house's letterhead (name, street,
// town), foreign addresses (number first, British postcodes, French streets), contacts written
// "Name / mail", English zip labels. Laid out like real riders; all names and addresses are
// invented.
import { describe, expect, it } from 'vitest'
import { foreignStreetOf, parseAddress } from '../src/main/showfolder/address'
import { extractShowFacts } from '../src/main/showfolder/extract'

const BAND = 'Beispielband'

const venueRider = `Fiche   technique   Muster   Club   -   p 1 /5
•   Jauge   :   350   places   debout
TECH SPECS
MUSTER   CLUB   BY   THE   RIVER
92   boulevard   de   Musterville
75018   MUSTERVILLE
Advancing contact   /   Venue Manager   :
Erika Muster / erika@muster-club.example.test
GENERAL
Capacity : 350 standing`

describe("a venue's own rider", () => {
  it('reads the letterhead block, the foreign address and the venue manager', () => {
    const facts = extractShowFacts(
      { name: 'Muster Club - Rider 2026 (ENG).pdf', text: venueRider, links: [] },
      'venue_spec',
      BAND
    )
    expect(facts.venue).toMatchObject({
      name: 'MUSTER CLUB BY THE RIVER',
      street: 'boulevard de Musterville 92',
      zipCode: '75018',
      city: 'MUSTERVILLE',
      countryCode: 'FR',
      capacity: 350
    })
    expect(facts.contacts).toEqual([
      expect.objectContaining({
        name: 'Erika Muster',
        email: 'erika@muster-club.example.test',
        side: 'venue'
      })
    ])
  })

  it('takes no address from a heading or a supplier letterhead', () => {
    for (const above of ['Presse', 'ADDRESS', 'Muster Licht Service GmbH']) {
      const text = `${above}\nMusterweg 17\n12345 Musterdorf`
      expect(
        extractShowFacts({ name: 'Festival Rider.pdf', text, links: [] }, 'venue_spec', BAND).venue
      ).toMatchObject({ name: '', street: '', zipCode: '' })
    }
  })

  it('reads English zip labels and guesses no German country for a foreign street', () => {
    const text =
      'Venue:   Location :   Muster Hall   Street :   92 B oul evard de Muster\nPostcode :   75018   City :   MUSTERVILLE'
    expect(
      extractShowFacts({ name: 'Infosheet.pdf', text, links: [] }, 'daysheet', BAND).venue
    ).toMatchObject({ zipCode: '75018', city: 'MUSTERVILLE', countryCode: '' })
  })
})

describe('foreign addresses', () => {
  it('reads streets with the number first and tells their country', () => {
    expect(foreignStreetOf('92 boulevard de Musterville')).toEqual({
      street: 'boulevard de Musterville',
      streetNumber: '92',
      countryCode: 'FR'
    })
    expect(foreignStreetOf('178 Muster Road')).toMatchObject({
      streetNumber: '178',
      countryCode: 'GB'
    })
    expect(foreignStreetOf('via Esempio 3')).toMatchObject({ streetNumber: '3', countryCode: 'IT' })
    expect(foreignStreetOf('Musterweg 3')).toBeNull()
    expect(parseAddress('Quai Musterquai, 69009 Musterville').countryCode).toBe('FR')
  })

  it('reads British postcodes before or after the town', () => {
    expect(parseAddress('178 Muster Road, Musterton N19 5QQ')).toMatchObject({
      street: 'Muster Road',
      streetNumber: '178',
      zipCode: 'N19 5QQ',
      city: 'Musterton',
      countryCode: 'GB'
    })
    expect(parseAddress('PL4 6LA Musterton')).toMatchObject({
      zipCode: 'PL4 6LA',
      city: 'Musterton',
      countryCode: 'GB'
    })
  })
})
