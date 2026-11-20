// Show-Ordner: the kind of each file and the facts found in it, from sheets laid out like the
// agencies' (two-column info sheet, venue specs with spaced digits, a mail with a price table).
// All names, numbers and addresses are invented.
import { describe, expect, it } from 'vitest'
import {
  classifyShowFile,
  emailOf,
  extractShowFacts,
  joinDigits,
  mergeShowFacts,
  moneyOf,
  timeOf
} from '../src/main/showfolder/extract'

const BAND = 'Beispielband'

const daysheet = `___________________________________
Date: 14.11.2026
Town: 12345 Musterstadt
Venue: Halle Nord ( new adress!! )
Google Link Venue:   https://maps.example/abc
Town: 12345 Musterstadt
Street: Musterweg 11
Get In Beispielband:   13:00
Get in Vorband Eins:   15:30
Soundcheck Beispielband:   15:30 - 17:00
Soundcheck Vorband Eins   17:00 - 18:00
Dinner:   18:00
Doors:   19:00
Show   Vorband Eins   20:00 - 20:45
Change Over   20:45 - 21:15
Show Beispielband   21:15 - 22:45
Load Out   22:45 - 23:30
Backstage Curfew   00:30
CONTACTS:
Venue:   Erika Muster   +49 151 000 0001   erika.muster@ Y halle-nord.example
Tourmanager BB:   Max Beispiel   +49 170 000 0002   max@band.example.test
ADDITIONAL INFORMATION:
the vans can be parked at the venue.
`

const infosheet = `Datum: 14.11.26
Venue: Halle Nord ( neue Location!! )
Ansprechpartner vor Ort: Erika Muster -   erika.muster@halle-nord.example.test   - +49 151 000 0001
Abfahrt Hotel:   09:00   |   reine Fahrzeit 3,5 h
Get In Beispielband:   13:00   |
Load In:   13:30   |   TM: Max
Soundcheck Beispielband:   15:30 - 17:00   |   MERCH: Max
Doors:   19:00   |
Beispielband Get Together   19:45 - 20:45   |   Toiletten im Backstage:
Beispielband   21:15 - 22:45   |   Merchverkauf:   Merchfee 75€
Backstage Curfew   00:30   |
Hotel: Hotel am Deich
Straße: Beispielstraße 77
Stadt: 54321 Nebenort
Gebuchte Zimmer:   7 EZ. 2 DZ (ohne Frühstück)
Check In:   15:00   - Check Out:   11:00
Sonstiges:
Schlüssel vorab abholen.
`

const venueSpec = `Halle Nord GmbH      Musterallee 1      12345 Musterstadt
VENUE SPECIFICATIONS 202   6
VENUE INFORMATION & TECHNICAL SPECS
NAME   Halle Nord
ADDRESS   Musterweg 11   (new location!)
ZIP CODE / CITY   12345   Musterstadt
CAPACITY   standing capacity   9 00   (guestlist   excl   .)   /   seating capacity   4 24
Executive Director:
Hans Leiter
Booking   /Production   :
Paula Planer
mail:   booking@halle-nord.example.test   /   production@halle-nord.example.test
phone:   +49 40 0000000   / +49 160 0000000
PARKING
NIGHTLINER   & TRUCKS   parking in front of the building - parking permit required in advance!
SOUNDLIMITS   99 dB DIN 15905   - 5
MERCHANDISE FEE   75,00 € incl. VAT
STAGE
WIDTH   1 1, 6   m
DEPTH   8,2   m
RIGGING   no
SOUN   D
MAIN PA   12 x LINE SOURCE
`

const mail = `Von: Paul Promo <paul.promo@promoter.example.test>
An: Agentur <info@agentur.example.test>
Betreff: AW: Beispielband 2026 Musterstadt

Hi,

Zeiten passen so. Kapazität beträgt 900.

Liebe Grüße,
Paul

---------------------------------
Paul Promo | Local Promoter
Promoter GmbH | Beispielstr. 1 | 12345 Musterstadt
ph: +49.40.0000.852 | fx: +49.40.0000.999

Wir gehen von folgenden Zeiten aus:
·  Einlass: 19 Uhr
·  Beginn: 20 Uhr

STEHPLATZ
Grundpreis
30,00 €
VVK (10%)
10%
3,00 €
WKZ
2,00 €
Ausgleichsgebühr
3,00 €
Endpreis
38,70 €
`

const file = (name: string, text: string, links: string[] = []) => ({ name, text, links })

describe('show folder: helpers', () => {
  it('reads times, ranges and the label in front', () => {
    expect(timeOf('Show Beispielband   21:15 - 22:45')).toEqual({
      label: 'show beispielband',
      start: '21:15',
      end: '22:45',
      minutes: 90
    })
    expect(timeOf('Backstage Curfew 00:30')?.start).toBe('00:30')
    expect(timeOf('Gage 1.500,00 €')).toBeNull()
  })

  it('joins digits a PDF font spaced apart and reads money', () => {
    expect(joinDigits('capacity 9 00 /')).toBe('capacity 900 /')
    expect(joinDigits('1 1, 6 m')).toBe('11,6 m')
    expect(moneyOf('Merchfee 75€')).toBe(7500)
    expect(moneyOf('38,70 €')).toBe(3870)
    expect(moneyOf('1.500 EUR')).toBe(150000)
    expect(moneyOf('ohne Betrag')).toBeNull()
  })

  it('repairs an e-mail broken by a ligature from the link of the same name', () => {
    expect(
      emailOf('erika.muster@ Y halle-nord.example', ['mailto:erika.muster@fk-halle.example.test'])
    ).toBe('erika.muster@fk-halle.example.test')
    expect(emailOf('max@band.example.test', [])).toBe('max@band.example.test')
  })
})

describe('show folder: kinds', () => {
  const names = ['Daysheet Show.pdf', 'Daysheet Show.pages', 'Venue Specifications 2026.pdf']
  it('tells the files apart by name and content', () => {
    expect(classifyShowFile(file('Daysheet Show.pdf', daysheet), names)).toBe('daysheet')
    expect(classifyShowFile(file('Daysheet Show.pages', ''), names)).toBe('duplicate')
    expect(classifyShowFile(file('Venue Specifications 2026.pdf', venueSpec), names)).toBe(
      'venue_spec'
    )
    expect(classifyShowFile(file('Stage-Lichtplot 2026.pdf', 'DMX'), names)).toBe('stage_plot')
    expect(classifyShowFile(file('AW Beispielband.eml', mail), names)).toBe('mail')
    expect(
      classifyShowFile(file('scan0001.pdf', 'Straßenverkehrsbehördliche Anordnung'), names)
    ).toBe('permit')
    expect(classifyShowFile(file('scan0002.pdf', ''), names)).toBe('other')
    // no telling name: three time labels make a day sheet
    expect(classifyShowFile(file('Musterstadt.pdf', daysheet), names)).toBe('daysheet')
  })
})

describe('show folder: facts', () => {
  it('reads the day of a day sheet: main act by the band name, support by the other', () => {
    const facts = extractShowFacts(file('Daysheet.pdf', daysheet), 'daysheet', BAND)
    expect(facts.itinerary).toEqual({
      getIn: '13:00',
      soundCheckMainAct: '15:30',
      soundCheckSupport: '17:00',
      dinner: '18:00',
      doors: '19:00',
      showTimeSupport: '20:00',
      showTimeMainAct: '21:15',
      showLength: '90',
      // "Backstage" is not the stage
      curfewVenue: '00:30'
    })
    expect(facts.venue).toMatchObject({
      name: 'Halle Nord',
      street: 'Musterweg 11',
      zipCode: '12345',
      city: 'Musterstadt'
    })
    expect(facts.contacts).toEqual([
      expect.objectContaining({ name: 'Erika Muster', side: 'venue', onSite: true }),
      expect.objectContaining({ name: 'Max Beispiel', side: 'band' })
    ])
  })

  it('reads a two-column info sheet: hotel section, merch fee, load in', () => {
    const facts = extractShowFacts(file('Infosheet.pdf', infosheet), 'daysheet', BAND)
    expect(facts.itinerary).toMatchObject({ loadIn: '13:30', showTimeMainAct: '21:15' })
    // the get-together line is no show time
    expect(facts.itinerary.showLength).toBe('90')
    expect(facts.venue.merchFeeCents).toBe(7500)
    expect(facts.hotel).toEqual({
      name: 'Hotel am Deich',
      street: 'Beispielstraße 77',
      zipCode: '54321',
      city: 'Nebenort',
      notes: ['Gebuchte Zimmer: 7 EZ. 2 DZ (ohne Frühstück)', 'Check In: 15:00 - Check Out: 11:00']
    })
    // the venue address is not overwritten by the hotel's
    expect(facts.venue.street).toBe('')
  })

  it('reads venue specs: spaced digits, stage, the production contact with its own mail', () => {
    const facts = extractShowFacts(file('Venue Specs.pdf', venueSpec), 'venue_spec', BAND)
    expect(facts.venue).toMatchObject({
      name: 'Halle Nord',
      street: 'Musterweg 11',
      zipCode: '12345',
      capacity: 900,
      merchFeeCents: 7500
    })
    expect(facts.venue.notes).toEqual(
      expect.arrayContaining([
        'Bühne, Breite: 11,6 m',
        'Bühne, Tiefe: 8,2 m',
        expect.stringMatching(/^Parken: .*permit required/)
      ])
    )
    expect(facts.contacts).toEqual([
      expect.objectContaining({
        name: 'Paula Planer',
        email: 'booking@halle-nord.example.test',
        side: 'venue'
      })
    ])
  })

  it('reads a promoter mail: prices, times in Uhr, the sender as promoter with phone', () => {
    const facts = extractShowFacts(file('AW.eml', mail), 'mail', BAND)
    expect(facts.tickets).toEqual({
      presaleCents: 3870,
      baseCents: 3000,
      extraCents: 300,
      wkzCents: 200
    })
    expect(facts.itinerary.doors).toBe('19:00')
    expect(facts.start).toBe('20:00')
    expect(facts.venue.capacity).toBe(900)
    expect(facts.contacts[0]).toMatchObject({
      name: 'Paul Promo',
      email: 'paul.promo@promoter.example.test',
      role: 'Local Promoter',
      side: 'promoter',
      phone: '+49 40 0000 852'
    })
  })

  it('reads the deal of a contract', () => {
    const contract =
      'Der Künstler erhält eine Festgage von 2.500,00 € netto vs. 70 % der Nettoeinnahmen.'
    const facts = extractShowFacts(file('Gastspielvertrag.pdf', contract), 'contract', BAND)
    expect(facts.deal.guaranteeCents).toBe(250000)
    expect(facts.deal.text).toBe('Garantie 2.500 € vs. 70 % Nettoeinnahmen')
  })

  it('merges the files: the address of the venue sheet wins, each contact once', () => {
    const merged = mergeShowFacts([
      { kind: 'mail', facts: extractShowFacts(file('AW.eml', mail), 'mail', BAND) },
      { kind: 'daysheet', facts: extractShowFacts(file('Day.pdf', daysheet), 'daysheet', BAND) },
      { kind: 'daysheet', facts: extractShowFacts(file('Info.pdf', infosheet), 'daysheet', BAND) },
      {
        kind: 'venue_spec',
        facts: extractShowFacts(file('Spec.pdf', venueSpec), 'venue_spec', BAND)
      }
    ])
    expect(merged.itinerary.loadIn).toBe('13:30')
    expect(merged.venue.capacity).toBe(900)
    expect(merged.hotel.name).toBe('Hotel am Deich')
    expect(merged.tickets.presaleCents).toBe(3870)
    expect(merged.contacts.filter((c) => c.name === 'Erika Muster')).toHaveLength(1)
  })
})
