// Mailing lists (Verteiler): recipients of venues, festivals and media, the
// five filters (kind/recipient type, country/region, genre, capacity,
// bookings), LoPros of events, one row per address, "Keine Werbung", saved
// lists and the CSV.
import 'reflect-metadata'
import { describe, it, expect, beforeAll } from 'vitest'
import { container } from 'tsyringe'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { ContactListService, contactListCsv } from '../src/main/services/ContactListService'
import { VenueService } from '../src/main/services/VenueService'
import { PersonService } from '../src/main/services/PersonService'
import { CompanyService } from '../src/main/services/CompanyService'
import { ContactListFilters } from '../src/main/api/schemas/contactList.schema'
import { CreateVenueInput } from '../src/main/api/schemas/venue.schema'
import { CreateCompanyInput, UpdateCompanyInput } from '../src/main/api/schemas/company.schema'
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
let clubId: number
let hallId: number

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

async function person(firstName: string, lastName: string, email: string): Promise<number> {
  const created = await container
    .resolve(PersonService)
    .createPerson({ firstName, lastName, contact: { email } } as Parameters<
      PersonService['createPerson']
    >[0])
  return created.id
}

async function member(venueId: number, firstName: string, lastName: string, email: string) {
  db.insert(schema.venue_member)
    .values({
      venue_id: venueId,
      person_id: await person(firstName, lastName, email),
      role: 'Booking'
    })
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
    .values({ email: 'office@kulturbetrieb.example.test' })
    .returning()
    .get()
  const promoterCompany = db
    .insert(schema.company)
    .values({ name: 'Kulturbetrieb GmbH', contact_id: promoter.id })
    .returning()
    .get()

  // Stuttgart club, 400, Rock, booked by the metal band
  const club = (clubId = await venue({
    name: 'Club Zentral',
    capacity: 400,
    genres: 'Rock, punk',
    email: 'info@club-zentral.example.test',
    zip: '70173',
    state: 'Baden-Württemberg',
    companyId: promoterCompany.id
  }))
  await member(club, 'Lea', 'Berg', 'lea@club-zentral.example.test')
  booking(club, metalBandId)

  // Munich hall, 2000, no tags, a cancelled pop show only
  const hall = (hallId = await venue({
    name: 'Halle Süd',
    capacity: 2000,
    email: 'booking@halle-sued.example.test',
    zip: '80331',
    state: 'Bayern',
    companyId: promoterCompany.id
  }))
  booking(hall, popBandId, 'cancelled')

  // Austrian festival, unknown capacity, pop booked; its booker also
  // works for the club (same address, different case)
  const festival = await venue({
    name: 'Wiesen Open Air',
    kind: 'festival',
    email: 'hallo@wiesen.example.test',
    zip: '7203',
    state: 'Burgenland',
    code: 'AT'
  })
  await member(festival, 'Lea', 'Berg', 'LEA@club-zentral.example.test')
  booking(festival, popBandId)

  // A venue without any address
  await venue({ name: 'Ohne Mail', capacity: 100 })
})

describe('mailing lists', () => {
  it('list each address once with all its venues', () => {
    const result = container.resolve(ContactListService).build(filters())
    expect(result.recipients.map((row) => row.email).sort()).toEqual([
      'booking@halle-sued.example.test',
      'hallo@wiesen.example.test',
      'info@club-zentral.example.test',
      'lea@club-zentral.example.test',
      'office@kulturbetrieb.example.test'
    ])
    const lea = result.recipients.find((row) => row.email === 'lea@club-zentral.example.test')
    expect(lea).toMatchObject({ name: 'Lea Berg', firstName: 'Lea', types: ['member'] })
    expect(lea?.sources.map((entry) => entry.name)).toEqual(['Club Zentral', 'Wiesen Open Air'])
    expect(lea?.sources[0]).toMatchObject({ kind: 'venue', role: 'Booking' })
    expect(lea?.sources[1].kind).toBe('festival')
    const promoter = result.recipients.find(
      (row) => row.email === 'office@kulturbetrieb.example.test'
    )
    expect(promoter).toMatchObject({
      company: 'Kulturbetrieb GmbH',
      types: ['promoter'],
      capacity: 2000
    })
  })

  it('filter by kind and recipient type', () => {
    expect(emails({ kinds: ['festival'] })).toEqual([
      'LEA@club-zentral.example.test',
      'hallo@wiesen.example.test'
    ])
    expect(emails({ recipientTypes: ['promoter'] })).toEqual(['office@kulturbetrieb.example.test'])
    expect(emails({ kinds: ['venue'], recipientTypes: ['venue'] })).toEqual([
      'booking@halle-sued.example.test',
      'info@club-zentral.example.test'
    ])
  })

  it('filter by country, state and PLZ', () => {
    expect(emails({ countryCodes: ['at'] })).toEqual([
      'LEA@club-zentral.example.test',
      'hallo@wiesen.example.test'
    ])
    expect(emails({ states: ['bayern'] })).toEqual([
      'booking@halle-sued.example.test',
      'office@kulturbetrieb.example.test'
    ])
    expect(emails({ zipPrefixes: '7', recipientTypes: ['venue'] })).toEqual([
      'hallo@wiesen.example.test',
      'info@club-zentral.example.test'
    ])
    expect(emails({ zipPrefixes: '80; 72', countryCodes: ['DE'] })).toEqual([
      'booking@halle-sued.example.test',
      'office@kulturbetrieb.example.test'
    ])
  })

  it('filter by capacity; a bound drops venues without one', () => {
    expect(emails({ capacityMin: 1000 })).toEqual([
      'booking@halle-sued.example.test',
      'office@kulturbetrieb.example.test'
    ])
    expect(emails({ capacityMax: 500 })).toEqual([
      'info@club-zentral.example.test',
      'lea@club-zentral.example.test',
      'office@kulturbetrieb.example.test'
    ])
    expect(emails({ capacityMin: 100, recipientTypes: ['venue'] })).not.toContain(
      'hallo@wiesen.example.test'
    )
  })

  it('filter by genre: venue tags and genres of bands booked there', () => {
    // "punk" tag, any case
    expect(emails({ genres: ['Punk'], recipientTypes: ['venue'] })).toEqual([
      'info@club-zentral.example.test'
    ])
    // Metal band played the club
    expect(emails({ genres: ['metal'], recipientTypes: ['venue'] })).toEqual([
      'info@club-zentral.example.test'
    ])
    // Pop: the festival; the hall's pop show was cancelled
    expect(emails({ genres: ['Indie'], recipientTypes: ['venue'] })).toEqual([
      'hallo@wiesen.example.test'
    ])
  })

  it('filter by past bookings, optionally of one band', () => {
    expect(emails({ booked: 'booked', recipientTypes: ['venue'] })).toEqual([
      'hallo@wiesen.example.test',
      'info@club-zentral.example.test'
    ])
    expect(emails({ booked: 'never', recipientTypes: ['venue'] })).toEqual([
      'booking@halle-sued.example.test'
    ])
    expect(emails({ booked: 'booked', bandId: popBandId, recipientTypes: ['venue'] })).toEqual([
      'hallo@wiesen.example.test'
    ])
    expect(emails({ booked: 'never', bandId: metalBandId, recipientTypes: ['venue'] })).toEqual([
      'booking@halle-sued.example.test',
      'hallo@wiesen.example.test'
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
    expect(service.setNoAdvertising('Lea@club-zentral.example.test', true)).toBe(2)
    let result = service.build(filters())
    expect(result.recipients.map((row) => row.email)).not.toContain('lea@club-zentral.example.test')
    expect(result.excluded.map((row) => row.email)).toEqual(['lea@club-zentral.example.test'])

    service.setNoAdvertising('lea@club-zentral.example.test', false)
    result = service.build(filters())
    expect(result.excluded).toEqual([])
  })

  it('keep the flag when a form without the switch saves the contact', async () => {
    const venues = container.resolve(VenueService)
    const service = container.resolve(ContactListService)
    service.setNoAdvertising('hallo@wiesen.example.test', true)
    const festival = (await venues.getAllVenues()).find(
      (entry) => entry.name === 'Wiesen Open Air'
    )!
    await venues.updateVenue({
      id: festival.id,
      name: festival.name,
      kind: 'festival',
      notes: '',
      contact: { email: 'hallo@wiesen.example.test', phone: '', mobilePhone: '', homepage: '' }
    })
    expect(service.build(filters()).excluded.map((row) => row.email)).toEqual([
      'hallo@wiesen.example.test'
    ])
    // Genres untouched by an update that doesn't send them
    expect((await venues.getVenueById(festival.id))?.genres).toBe('')
    service.setNoAdvertising('hallo@wiesen.example.test', false)
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
      'E-Mail,Vorname,Nachname,Firma,Club/Festival/Medium,Ort,Land,Art',
      'office@kulturbetrieb.example.test,,,Kulturbetrieb GmbH,"Club Zentral; Halle Süd",Stadt,Deutschland,Veranstalter',
      'lea@club-zentral.example.test,Lea,Berg,,"Club Zentral; Wiesen Open Air",Stadt,Deutschland,Ansprechpartner',
      ''
    ])
  })

  it('puts the addresses in BCC, separated for the mail program', () => {
    expect(bccMailtoUrl(['a@x.example.test', 'b+1@y.example.test'], 'outlook')).toBe(
      'mailto:?bcc=a@x.example.test;b%2B1@y.example.test'
    )
    expect(bccMailtoUrl(['a@x.example.test', 'b@y.example.test'], 'mailto')).toBe(
      'mailto:?bcc=a@x.example.test,b@y.example.test'
    )
    const many = Array.from({ length: 200 }, (_, i) => `kontakt${i}@spielstaette.de`)
    expect(bccMailtoUrl(many, 'mailto')).toBeNull()
    expect(bccMailtoUrl(many.slice(0, 10), 'mailto')!.length).toBeLessThan(MAX_MAILTO_LENGTH)
  })
})

// Added after the suites above ran, so their address lists stay as they are
describe('media and LoPros', () => {
  let stationId: number

  beforeAll(async () => {
    const companies = container.resolve(CompanyService)
    // A radio station: own address, genres, one editor (parsed as the router does)
    stationId = (
      await companies.createCompany(
        CreateCompanyInput.parse({
          name: 'Radio Welle',
          kind: 'media',
          genres: 'Alternative, rock, ROCK',
          isDefaultForInvoicing: false,
          address: {
            street: '',
            streetNumber: '',
            addressSuffix: '',
            zipCode: '60311',
            city: 'Frankfurt',
            state: 'Hessen',
            country: 'Deutschland',
            countryCode: 'DE'
          },
          contact: { email: 'redaktion@radio-welle.example.test' }
        })
      )
    ).id
    db.insert(schema.company_member)
      .values({
        company_id: stationId,
        person_id: await person('Mia', 'Mond', 'mia@radio-welle.example.test'),
        role: 'Musikredaktion'
      })
      .run()

    // LoPro company and person of a (cancelled) pop show at the club
    const loProContact = db
      .insert(schema.contact)
      .values({ email: 'kontakt@lopro.example.test' })
      .returning()
      .get()
    const loProCompany = db
      .insert(schema.company)
      .values({ name: 'Lokal Promotion GmbH', contact_id: loProContact.id })
      .returning()
      .get()
    db.insert(schema.deal_memo)
      .values({
        name: 'LoPro-Show',
        date: '2026-06-01',
        band_id: popBandId,
        venue_id: clubId,
        status: 'cancelled',
        lopro_company_id: loProCompany.id,
        lopro_person_id: await person('Paul', 'Lokal', 'paul@lopro.example.test')
      })
      .run()
    // An archived show's LoPro is left out
    db.insert(schema.deal_memo)
      .values({
        name: 'Archiv-Show',
        date: '2025-06-01',
        band_id: popBandId,
        venue_id: hallId,
        lopro_person_id: await person('Alt', 'Archiv', 'alt@lopro.example.test'),
        archived_at: '2026-01-01 00:00:00'
      })
      .run()
  })

  it('lists a station with its own address and its people', () => {
    expect(emails({ kinds: ['media'] })).toEqual([
      'mia@radio-welle.example.test',
      'redaktion@radio-welle.example.test'
    ])
    const { recipients } = container.resolve(ContactListService).build(filters())
    const station = recipients.find((row) => row.email === 'redaktion@radio-welle.example.test')
    expect(station).toMatchObject({
      name: 'Radio Welle',
      company: 'Radio Welle',
      types: ['venue'],
      sources: [{ id: stationId, kind: 'media', name: 'Radio Welle', role: '' }],
      city: 'Frankfurt',
      capacity: null
    })
    const mia = recipients.find((row) => row.email === 'mia@radio-welle.example.test')
    expect(mia).toMatchObject({ firstName: 'Mia', company: 'Radio Welle', types: ['member'] })
    expect(mia?.sources[0].role).toBe('Musikredaktion')
  })

  it('filters media by region and genre, but not by capacity or bookings', () => {
    expect(emails({ states: ['hessen'], recipientTypes: ['venue'] })).toEqual([
      'redaktion@radio-welle.example.test'
    ])
    expect(emails({ genres: ['Rock'], recipientTypes: ['venue'] })).toEqual([
      'info@club-zentral.example.test',
      'redaktion@radio-welle.example.test'
    ])
    expect(emails({ genres: ['alternative'] })).toEqual([
      'mia@radio-welle.example.test',
      'redaktion@radio-welle.example.test'
    ])
    // A capacity bound or a bookings filter is about venues: stations drop out
    expect(emails({ capacityMin: 0, recipientTypes: ['venue'] })).not.toContain(
      'redaktion@radio-welle.example.test'
    )
    expect(emails({ booked: 'never', recipientTypes: ['venue'] })).toEqual([
      'booking@halle-sued.example.test'
    ])
    expect(emails({ kinds: ['venue', 'festival'] })).not.toContain(
      'redaktion@radio-welle.example.test'
    )
  })

  it('lists LoPro companies and persons of events at the venue, archived ones left out', () => {
    expect(emails({ recipientTypes: ['lopro'] })).toEqual([
      'kontakt@lopro.example.test',
      'paul@lopro.example.test'
    ])
    const { recipients } = container
      .resolve(ContactListService)
      .build(filters({ recipientTypes: ['lopro'] }))
    expect(recipients.find((row) => row.email === 'paul@lopro.example.test')).toMatchObject({
      name: 'Paul Lokal',
      firstName: 'Paul',
      company: 'Lokal Promotion GmbH',
      types: ['lopro'],
      sources: [{ id: clubId, kind: 'venue', name: 'Club Zentral', role: 'LoPro' }]
    })
    // The venue filters apply: no LoPro worked with the festival
    expect(emails({ kinds: ['festival'], recipientTypes: ['lopro'] })).toEqual([])
    // The cancelled show is no booking of the pop band at the club
    expect(emails({ booked: 'booked', bandId: popBandId, recipientTypes: ['venue'] })).toEqual([
      'hallo@wiesen.example.test'
    ])
  })

  it('offers the stations’ states and genres as filter options', () => {
    const options = container.resolve(ContactListService).filterOptions()
    expect(options.states).toContain('Hessen')
    expect(options.genres).toEqual(['Alternative', 'Indie', 'Metal', 'Pop', 'punk', 'Rock'])
  })

  it('keeps the kind and genres of a company that an update leaves out', async () => {
    const companies = container.resolve(CompanyService)
    const station = await companies.getCompanyById(stationId)
    expect(station).toMatchObject({ kind: 'media', genres: 'Alternative, rock' })
    await companies.updateCompany(UpdateCompanyInput.parse({ id: stationId, notes: 'Sendet' }))
    expect(await companies.getCompanyById(stationId)).toMatchObject({
      kind: 'media',
      genres: 'Alternative, rock'
    })
    await companies.updateCompany(
      UpdateCompanyInput.parse({ id: stationId, genres: ' Indie ,indie' })
    )
    expect((await companies.getCompanyById(stationId))?.genres).toBe('Indie')
  })
})
