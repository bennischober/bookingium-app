// Mailing lists (Verteiler): recipients of venues and festivals, the five
// filters (kind/recipient type, country/region, genre, capacity, bookings),
// one row per address, "Keine Werbung", saved lists and the CSV.
import 'reflect-metadata'
import { describe, it, expect, beforeAll } from 'vitest'
import { container } from 'tsyringe'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { ContactListService, contactListCsv } from '../src/main/services/ContactListService'
import { VenueService } from '../src/main/services/VenueService'
import { PersonService } from '../src/main/services/PersonService'
import { ContactListFilters } from '../src/main/api/schemas/contactList.schema'
import { CreateVenueInput } from '../src/main/api/schemas/venue.schema'
import { bccMailtoUrl, MAX_MAILTO_LENGTH } from '../src/main/mail/mailProgram'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const filters = (input: Partial<ContactListFilters> = {}): ContactListFilters =>
  ContactListFilters.parse(input)

const emails = (input: Partial<ContactListFilters> = {}): string[] =>
  container
    .resolve(ContactListService)
    .build(filters(input))
    .recipients.map((row) => row.email)
    .sort()

let metalBandId: number
let popBandId: number

async function venue(
  input: Partial<CreateVenueInput> & { email?: string; zip?: string; state?: string; code?: string }
): Promise<number> {
  const { email = '', zip = '', state = '', code = 'DE', ...rest } = input
  const created = await container.resolve(VenueService).createVenue(
    CreateVenueInput.parse({
      name: 'Venue',
      ...rest,
      address: {
        street: '',
        streetNumber: '',
        addressSuffix: '',
        zipCode: zip,
        city: 'Stadt',
        state,
        country: code === 'DE' ? 'Deutschland' : code,
        countryCode: code
      },
      contact: { email }
    })
  )
  return created.id
}

async function member(venueId: number, firstName: string, lastName: string, email: string) {
  const person = await container
    .resolve(PersonService)
    .createPerson({ firstName, lastName, contact: { email } } as Parameters<
      PersonService['createPerson']
    >[0])
  db.insert(schema.venue_member)
    .values({ venue_id: venueId, person_id: person.id, role: 'Booking' })
    .run()
}

function booking(venueId: number, bandId: number, status = 'confirmed') {
  db.insert(schema.deal_memo)
    .values({ name: 'Show', date: '2026-05-01', band_id: bandId, venue_id: venueId, status })
    .run()
}

beforeAll(async () => {
  const label = db.insert(schema.company).values({ name: 'Band GbR' }).returning().get()
  metalBandId = db
    .insert(schema.band)
    .values({ name: 'Iron Fist', genre: 'Metal', company_id: label.id })
    .returning()
    .get().id
  popBandId = db
    .insert(schema.band)
    .values({ name: 'Sunny', genre: 'Pop; Indie', company_id: label.id })
    .returning()
    .get().id

  const promoter = db
    .insert(schema.contact)
    .values({ email: 'office@kulturbetrieb.de' })
    .returning()
    .get()
  const promoterCompany = db
    .insert(schema.company)
    .values({ name: 'Kulturbetrieb GmbH', contact_id: promoter.id })
    .returning()
    .get()

  // Stuttgart club, 400, Rock, booked by the metal band
  const club = await venue({
    name: 'Club Zentral',
    capacity: 400,
    genres: 'Rock, punk',
    email: 'info@club-zentral.de',
    zip: '70173',
    state: 'Baden-Württemberg',
    companyId: promoterCompany.id
  })
  await member(club, 'Lea', 'Berg', 'lea@club-zentral.de')
  booking(club, metalBandId)

  // Munich hall, 2000, no tags, a cancelled pop show only
  const hall = await venue({
    name: 'Halle Süd',
    capacity: 2000,
    email: 'booking@halle-sued.de',
    zip: '80331',
    state: 'Bayern',
    companyId: promoterCompany.id
  })
  booking(hall, popBandId, 'cancelled')

  // Austrian festival, unknown capacity, pop booked; its booker also
  // works for the club (same address, different case)
  const festival = await venue({
    name: 'Wiesen Open Air',
    kind: 'festival',
    email: 'hallo@wiesen.at',
    zip: '7203',
    state: 'Burgenland',
    code: 'AT'
  })
  await member(festival, 'Lea', 'Berg', 'LEA@club-zentral.de')
  booking(festival, popBandId)

  // A venue without any address
  await venue({ name: 'Ohne Mail', capacity: 100 })
})

describe('mailing lists', () => {
  it('list each address once with all its venues', () => {
    const result = container.resolve(ContactListService).build(filters())
    expect(result.recipients.map((row) => row.email).sort()).toEqual([
      'booking@halle-sued.de',
      'hallo@wiesen.at',
      'info@club-zentral.de',
      'lea@club-zentral.de',
      'office@kulturbetrieb.de'
    ])
    const lea = result.recipients.find((row) => row.email === 'lea@club-zentral.de')
    expect(lea).toMatchObject({ name: 'Lea Berg', firstName: 'Lea', types: ['member'] })
    expect(lea?.venues.map((entry) => entry.name)).toEqual(['Club Zentral', 'Wiesen Open Air'])
    expect(lea?.venues[0].role).toBe('Booking')
    const promoter = result.recipients.find((row) => row.email === 'office@kulturbetrieb.de')
    expect(promoter).toMatchObject({
      company: 'Kulturbetrieb GmbH',
      types: ['promoter'],
      capacity: 2000
    })
  })

  it('filter by kind and recipient type', () => {
    expect(emails({ kinds: ['festival'] })).toEqual(['LEA@club-zentral.de', 'hallo@wiesen.at'])
    expect(emails({ recipientTypes: ['promoter'] })).toEqual(['office@kulturbetrieb.de'])
    expect(emails({ kinds: ['venue'], recipientTypes: ['venue'] })).toEqual([
      'booking@halle-sued.de',
      'info@club-zentral.de'
    ])
  })

  it('filter by country, state and PLZ', () => {
    expect(emails({ countryCodes: ['at'] })).toEqual(['LEA@club-zentral.de', 'hallo@wiesen.at'])
    expect(emails({ states: ['bayern'] })).toEqual([
      'booking@halle-sued.de',
      'office@kulturbetrieb.de'
    ])
    expect(emails({ zipPrefixes: '7', recipientTypes: ['venue'] })).toEqual([
      'hallo@wiesen.at',
      'info@club-zentral.de'
    ])
    expect(emails({ zipPrefixes: '80; 72', countryCodes: ['DE'] })).toEqual([
      'booking@halle-sued.de',
      'office@kulturbetrieb.de'
    ])
  })

  it('filter by capacity; a bound drops venues without one', () => {
    expect(emails({ capacityMin: 1000 })).toEqual([
      'booking@halle-sued.de',
      'office@kulturbetrieb.de'
    ])
    expect(emails({ capacityMax: 500 })).toEqual([
      'info@club-zentral.de',
      'lea@club-zentral.de',
      'office@kulturbetrieb.de'
    ])
    expect(emails({ capacityMin: 100, recipientTypes: ['venue'] })).not.toContain('hallo@wiesen.at')
  })

  it('filter by genre: venue tags and genres of bands booked there', () => {
    // "punk" tag, any case
    expect(emails({ genres: ['Punk'], recipientTypes: ['venue'] })).toEqual([
      'info@club-zentral.de'
    ])
    // Metal band played the club
    expect(emails({ genres: ['metal'], recipientTypes: ['venue'] })).toEqual([
      'info@club-zentral.de'
    ])
    // Pop: the festival; the hall's pop show was cancelled
    expect(emails({ genres: ['Indie'], recipientTypes: ['venue'] })).toEqual(['hallo@wiesen.at'])
  })

  it('filter by past bookings, optionally of one band', () => {
    expect(emails({ booked: 'booked', recipientTypes: ['venue'] })).toEqual([
      'hallo@wiesen.at',
      'info@club-zentral.de'
    ])
    expect(emails({ booked: 'never', recipientTypes: ['venue'] })).toEqual([
      'booking@halle-sued.de'
    ])
    expect(emails({ booked: 'booked', bandId: popBandId, recipientTypes: ['venue'] })).toEqual([
      'hallo@wiesen.at'
    ])
    expect(emails({ booked: 'never', bandId: metalBandId, recipientTypes: ['venue'] })).toEqual([
      'booking@halle-sued.de',
      'hallo@wiesen.at'
    ])
  })

  it('offer the values present as filter options', () => {
    const options = container.resolve(ContactListService).filterOptions()
    expect(options.countryCodes).toEqual(['AT', 'DE'])
    expect(options.states).toEqual(['Baden-Württemberg', 'Bayern', 'Burgenland'])
    expect(options.genres).toEqual(['Indie', 'Metal', 'Pop', 'punk', 'Rock'])
    expect(options.bands.map((band) => band.name)).toEqual(['Iron Fist', 'Sunny'])
  })

  it('leave out "Keine Werbung" addresses and take them back in', () => {
    const service = container.resolve(ContactListService)
    expect(service.setNoAdvertising('Lea@Club-Zentral.de', true)).toBe(2)
    let result = service.build(filters())
    expect(result.recipients.map((row) => row.email)).not.toContain('lea@club-zentral.de')
    expect(result.excluded.map((row) => row.email)).toEqual(['lea@club-zentral.de'])

    service.setNoAdvertising('lea@club-zentral.de', false)
    result = service.build(filters())
    expect(result.excluded).toEqual([])
  })

  it('keep the flag when a form without the switch saves the contact', async () => {
    const venues = container.resolve(VenueService)
    const service = container.resolve(ContactListService)
    service.setNoAdvertising('hallo@wiesen.at', true)
    const festival = (await venues.getAllVenues()).find(
      (entry) => entry.name === 'Wiesen Open Air'
    )!
    await venues.updateVenue({
      id: festival.id,
      name: festival.name,
      kind: 'festival',
      notes: '',
      contact: { email: 'hallo@wiesen.at', phone: '', mobilePhone: '', homepage: '' }
    })
    expect(service.build(filters()).excluded.map((row) => row.email)).toEqual(['hallo@wiesen.at'])
    // Genres untouched by an update that doesn't send them
    expect((await venues.getVenueById(festival.id))?.genres).toBe('')
    service.setNoAdvertising('hallo@wiesen.at', false)
  })

  it('save, rename and delete lists', () => {
    const service = container.resolve(ContactListService)
    const saved = service.save({ name: 'Clubs Süd', filters: filters({ states: ['Bayern'] }) })
    expect(service.listSaved()).toEqual([saved])
    service.save({ id: saved.id, name: 'Clubs Bayern', filters: saved.filters })
    expect(service.listSaved()[0]).toMatchObject({
      name: 'Clubs Bayern',
      filters: { states: ['Bayern'] }
    })

    // Unreadable filters fall back to "everything"
    db.update(schema.contact_list).set({ filters: 'kaputt' }).run()
    expect(service.listSaved()[0].filters).toEqual(filters())

    service.deleteSaved(saved.id)
    expect(service.listSaved()).toEqual([])
  })
})

describe('mailing list output', () => {
  it('writes a CSV for newsletter services', () => {
    const { recipients } = container
      .resolve(ContactListService)
      .build(filters({ recipientTypes: ['member', 'promoter'] }))
    expect(contactListCsv(recipients).split('\r\n')).toEqual([
      'E-Mail,Vorname,Nachname,Firma,Spielstätte,Ort,Land,Art',
      'office@kulturbetrieb.de,,,Kulturbetrieb GmbH,"Club Zentral; Halle Süd",Stadt,Deutschland,Veranstalter',
      'lea@club-zentral.de,Lea,Berg,,"Club Zentral; Wiesen Open Air",Stadt,Deutschland,Ansprechpartner',
      ''
    ])
  })

  it('puts the addresses in BCC, separated for the mail program', () => {
    expect(bccMailtoUrl(['a@x.de', 'b+1@y.de'], 'outlook')).toBe('mailto:?bcc=a@x.de;b%2B1@y.de')
    expect(bccMailtoUrl(['a@x.de', 'b@y.de'], 'mailto')).toBe('mailto:?bcc=a@x.de,b@y.de')
    const many = Array.from({ length: 200 }, (_, i) => `kontakt${i}@spielstaette.de`)
    expect(bccMailtoUrl(many, 'mailto')).toBeNull()
    expect(bccMailtoUrl(many.slice(0, 10), 'mailto')!.length).toBeLessThan(MAX_MAILTO_LENGTH)
  })
})
