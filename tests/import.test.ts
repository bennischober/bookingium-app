// Spreadsheet import: cleaning of messy cells, column detection, the row →
// record plan (follow-up rows, duplicates) and writing it (new records,
// existing ones only completed).
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { ImportService } from '../src/main/services/ImportService'
import { CompanyService } from '../src/main/services/CompanyService'
import { buildImportPlan } from '../src/main/import/buildImportPlan'
import { detectMapping } from '../src/main/import/detectMapping'
import {
  normalizeUrl,
  parseCapacity,
  parseEmails,
  parsePersons,
  parseRegion,
  parseTaxId
} from '../src/main/import/normalize'
import type { ImportRequest, ImportRow } from '../src/main/api/schemas/import.schema'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const toRows = (cells: string[][]): ImportRow[] =>
  cells.map((row, index) => ({ rowNumber: index + 2, cells: row }))

describe('cell cleaning', () => {
  it('splits several contact persons and reads roles', () => {
    expect(parsePersons('Steven Pönicke / Richard Schröder')).toMatchObject([
      { firstName: 'Steven', lastName: 'Pönicke' },
      { firstName: 'Richard', lastName: 'Schröder' }
    ])
    expect(parsePersons('Elke und Johannes').map((person) => person.firstName)).toEqual([
      'Elke',
      'Johannes'
    ])
    expect(parsePersons('GF Andreas Schmidt')).toEqual([
      { firstName: 'Andreas', lastName: 'Schmidt', role: 'Geschäftsführer', notes: '' }
    ])
    expect(parsePersons('Oliver Pech\nVorsitzender')[0]).toMatchObject({
      lastName: 'Pech',
      role: 'Vorsitzender'
    })
    expect(parsePersons('Carsten "Strubbel" Schack')[0]).toMatchObject({
      firstName: 'Carsten',
      lastName: 'Schack',
      notes: 'Spitzname: Strubbel'
    })
    expect(parsePersons('Katrin Wedemeyer,')).toHaveLength(1)
    expect(parsePersons('Guido Krause: 01703184903')).toEqual([])
  })

  it('finds emails, URLs, capacities and tax ids', () => {
    expect(parseEmails('cm@hhk.example.test; no@hhk.example.test')).toEqual(['cm@hhk.example.test', 'no@hhk.example.test'])
    expect(parseEmails('info(@)vaddi-concerts.example.test')).toEqual(['info@vaddi-concerts.example.test'])
    expect(parseEmails('Benjamin.Geisser@vsbbg.example.test>')).toEqual(['Benjamin.Geisser@vsbbg.example.test'])
    expect(parseEmails('www.goldrush-productions.com')).toEqual([])

    expect(normalizeUrl('www.diepumpe.de')).toBe('https://www.diepumpe.de')
    expect(normalizeUrl('/www.westtor.de')).toBe('https://www.westtor.de')
    expect(normalizeUrl('crash-musikkeller.de; www.mbc-tourbooking.de')).toBe(
      'https://crash-musikkeller.de'
    )
    expect(normalizeUrl('jens@fiddlersgreenpub.example.test')).toBe('')

    expect(parseCapacity('1.800')).toBe(1800)
    expect(parseCapacity('500-1000')).toBe(500)
    expect(parseCapacity('???')).toBeNull()

    expect(parseTaxId('DE 20 033 044 16')).toEqual({ vatNumber: 'DE2003304416', taxNumber: '' })
    expect(parseTaxId('StNr 25133/30314')).toEqual({ vatNumber: '', taxNumber: '25133/30314' })
  })

  it('reads German states and countries', () => {
    expect(parseRegion('NRW', true)).toEqual({
      state: 'Nordrhein-Westfalen',
      country: { name: 'Germany', code: 'DE' }
    })
    // "BE" is Berlin in a state column, Belgium in a country column
    expect(parseRegion('BE', true).state).toBe('Berlin')
    expect(parseRegion('BE', false).country?.code).toBe('BE')
    expect(parseRegion('UK', false).country).toEqual({ name: 'United Kingdom', code: 'GB' })
    expect(parseRegion('Atlantis', false).country).toEqual({ name: 'Atlantis', code: '' })
  })
})

describe('column detection', () => {
  it('maps the promoter list, including the unnamed venue column', () => {
    const headers = ['LAND', 'B', 'w', 'DEAL', 'LOCAL PROMOTER', 'AP', 'Email', 'Plz', 'cc', '']
    const rows = toRows([['SH', 'DIE PUMPE', 'Kiel', '', 'Die Pumpe e.V.', '', '', '', '500', 'x']])
    expect(detectMapping(headers, rows)).toEqual([
      'region',
      'venueName',
      'venueCity',
      'notes',
      'companyName',
      'contactPerson',
      'email',
      'zipCode',
      'capacity',
      'notes'
    ])
  })

  it('uses Location as the place unless a City column exists', () => {
    expect(detectMapping(['Festival', 'Location'], [])).toEqual(['venueName', 'venueCity'])
    expect(detectMapping(['Festival', 'Location', 'City'], [])).toEqual([
      'venueName',
      'notes',
      'venueCity'
    ])
  })
})

// Promoter-list layout used by the plan and database tests
const HEADERS = ['LAND', 'Venue', 'City', 'Promoter', 'AP', 'Email', 'Str', 'Plz', 'Stadt', 'cc']
const MAPPING = detectMapping(HEADERS, [])

function request(cells: string[][], excludedRows: number[] = []): ImportRequest {
  return {
    target: 'venues',
    headers: HEADERS,
    rows: toRows(cells),
    mapping: MAPPING,
    options: { kind: 'venue', defaultCountry: 'DE' },
    excludedRows
  }
}

const NONE = { venues: [], bands: [], companies: [], persons: [] }

describe('import plan', () => {
  it('attaches follow-up rows to the row above', () => {
    const plan = buildImportPlan(
      request([
        ['HH', 'GALAXY', 'Hamburg', 'Trinity Music', 'Jonas Nity', 'jonas@trinity.example.test'],
        ['', '', '', '', 'Oli Zimmermann', 'oli@trinity.example.test']
      ]),
      NONE
    )
    expect(plan.venues).toHaveLength(1)
    expect(plan.persons.map((person) => person.lastName)).toEqual(['Nity', 'Zimmermann'])
    expect([...plan.companies[0].members.keys()]).toHaveLength(2)
    expect(plan.preview.rows.map((row) => row.status)).toEqual(['record', 'continuation'])
    expect(plan.venues[0].address).toMatchObject({ city: 'Hamburg', state: 'Hamburg' })
  })

  it('merges repeated venues and companies, but not same names in other cities', () => {
    const plan = buildImportPlan(
      request([
        ['HE', 'BATSCHKAPP', 'Frankfurt', 'Batschkapp GmbH', 'Matze Brunner'],
        ['HE', 'BATSCHKAPP', 'Frankfurt', 'Batschkapp GmbH', 'Verena Schick'],
        ['SN', 'ALTER SCHLACHTHOF', 'Dresden', 'Aust Konzerte'],
        ['NRW', 'ALTER SCHLACHTHOF', 'Soest', 'Schlachthof Soest']
      ]),
      NONE
    )
    expect(plan.venues.map((venue) => venue.address.city)).toEqual([
      'Frankfurt',
      'Dresden',
      'Soest'
    ])
    expect(plan.companies).toHaveLength(3)
    expect(plan.preview.rows[1].primary?.action).toBe('repeat')
  })

  it('skips unticked rows together with their follow-up rows', () => {
    const plan = buildImportPlan(
      request(
        [
          ['HH', 'LOGO', 'Hamburg', 'LOGO', 'Chris August'],
          ['', '', '', '', 'Lea Goltz']
        ],
        [2]
      ),
      NONE
    )
    expect(plan.venues).toHaveLength(0)
    expect(plan.persons).toHaveLength(0)
    expect(plan.preview.rows.map((row) => row.status)).toEqual(['excluded', 'excluded'])
  })

  it('needs a name column', () => {
    const plan = buildImportPlan({ ...request([]), mapping: MAPPING.map(() => 'ignore') }, NONE)
    expect(plan.preview.errors).toHaveLength(1)
  })
})

describe('writing the import', () => {
  it('creates venues, promoters and contacts with their links', async () => {
    const service = container.resolve(ImportService)
    const result = service.commit(
      request([
        [
          'SH',
          'DIE PUMPE',
          'Kiel',
          'Die Pumpe e.V.',
          'Carlos Lehne',
          'carlos@diepumpe.example.test',
          'Haßstr. 22',
          '24103',
          'Kiel',
          '500'
        ],
        ['', '', '', '', 'Anna Bauer', 'anna@diepumpe.example.test']
      ])
    )
    expect(result).toMatchObject({
      venues: { created: 1 },
      companies: { created: 1 },
      persons: { created: 2 }
    })

    const venue = db.select().from(schema.venue).where(eq(schema.venue.name, 'DIE PUMPE')).get()!
    expect(venue).toMatchObject({ kind: 'venue', capacity: 500 })
    const company = db
      .select()
      .from(schema.company)
      .where(eq(schema.company.id, venue.company_id!))
      .get()!
    expect(company.name).toBe('Die Pumpe e.V.')
    const address = db
      .select()
      .from(schema.address)
      .where(eq(schema.address.id, company.address_id!))
      .get()!
    expect(address).toMatchObject({ zip_code: '24103', city: 'Kiel', country_code: 'DE' })
    expect(
      db
        .select()
        .from(schema.company_member)
        .where(eq(schema.company_member.company_id, company.id))
        .all()
    ).toHaveLength(2)
    expect(
      db.select().from(schema.venue_member).where(eq(schema.venue_member.venue_id, venue.id)).all()
    ).toHaveLength(2)
  })

  it('only fills empty fields of existing records', async () => {
    const companies = container.resolve(CompanyService)
    const existing = await companies.createCompany({
      name: 'Markthalle Hamburg GmbH',
      contact: { email: 'office@markthalle.example.test', phone: '', mobilePhone: '', homepage: '' },
      isDefaultForInvoicing: false
    })

    const service = container.resolve(ImportService)
    const preview = service.preview(
      request([
        [
          'HH',
          'MARKTHALLE',
          'Hamburg',
          'Markthalle Hamburg GmbH',
          '',
          'tosh@markthalle.example.test',
          'Klosterwall',
          '20095',
          'Hamburg'
        ]
      ])
    )
    expect(preview.rows[0].company?.action).toBe('existing')

    const result = service.commit(
      request([
        [
          'HH',
          'MARKTHALLE',
          'Hamburg',
          'Markthalle Hamburg GmbH',
          '',
          'tosh@markthalle.example.test',
          'Klosterwall',
          '20095',
          'Hamburg'
        ]
      ])
    )
    expect(result).toMatchObject({
      companies: { created: 0, updated: 1 },
      venues: { created: 1 }
    })
    const company = db
      .select()
      .from(schema.company)
      .where(eq(schema.company.id, existing.id))
      .get()!
    const contact = db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.id, company.contact_id!))
      .get()!
    // Kept, not overwritten
    expect(contact.email).toBe('office@markthalle.example.test')
    const address = db
      .select()
      .from(schema.address)
      .where(eq(schema.address.id, company.address_id!))
      .get()!
    expect(address.street).toBe('Klosterwall')

    // Importing the same sheet again changes nothing
    const again = service.commit(
      request([
        [
          'HH',
          'MARKTHALLE',
          'Hamburg',
          'Markthalle Hamburg GmbH',
          '',
          'tosh@markthalle.example.test',
          'Klosterwall',
          '20095',
          'Hamburg'
        ]
      ])
    )
    const nothing = { created: 0, updated: 0 }
    expect(again).toEqual({ venues: nothing, bands: nothing, companies: nothing, persons: nothing })
  })
})
