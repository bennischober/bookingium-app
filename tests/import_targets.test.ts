// Import types besides venues: band lists (company must exist, members with
// roles, technical lead), company lists, person lists, and mappings that are
// remembered for lists with the same columns.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { ImportService } from '../src/main/services/ImportService'
import { CompanyService } from '../src/main/services/CompanyService'
import { detectMapping, detectMappings, suggestTarget } from '../src/main/import/detectMapping'
import { parseBirthday, parsePersons } from '../src/main/import/normalize'
import type {
  ImportRequest,
  ImportTarget,
  ImportWorkbook
} from '../src/main/api/schemas/import.schema'

import { setupTestDb } from './helpers/setup'

setupTestDb()

function request(target: ImportTarget, headers: string[], cells: string[][]): ImportRequest {
  const rows = cells.map((row, index) => ({ rowNumber: index + 2, cells: row }))
  return {
    target,
    headers,
    rows,
    mapping: detectMapping(headers, rows, target),
    options: { kind: 'venue', defaultCountry: 'DE' },
    excludedRows: []
  }
}

const service = () => container.resolve(ImportService)

describe('names with roles', () => {
  it('reads roles from parentheses and prefixes', () => {
    expect(parsePersons('John Rockstar (Gesang, Gitarre), Sarah Keys')).toMatchObject([
      { firstName: 'John', lastName: 'Rockstar', role: 'Gesang, Gitarre' },
      { firstName: 'Sarah', lastName: 'Keys', role: '' }
    ])
    expect(parsePersons('Schlagzeug: Lisa Drums')).toMatchObject([
      { firstName: 'Lisa', lastName: 'Drums', role: 'Schlagzeug' }
    ])
  })

  it('reads birthdays', () => {
    expect(parseBirthday('12.03.1985')).toBe('1985-03-12')
    expect(parseBirthday('1985-3-2')).toBe('1985-03-02')
    expect(parseBirthday('31.02.1985')).toBe('')
    expect(parseBirthday('März 85')).toBe('')
  })
})

describe('what a list holds', () => {
  it('is guessed from the headers', () => {
    expect(suggestTarget('Tabelle1', ['Band', 'Genre', 'Firma', 'Mitglieder'])).toBe('bands')
    expect(suggestTarget('Tabelle1', ['Vorname', 'Name', 'E-Mail'])).toBe('persons')
    expect(suggestTarget('Tabelle1', ['Firma', 'Ansprechpartner', 'Straße'])).toBe('companies')
    expect(suggestTarget('national', ['LAND', 'B', 'w', 'LOCAL PROMOTER', 'cc'])).toBe('venues')
  })

  it('maps the same header per target', () => {
    const headers = ['Name', 'Genre', 'Vorname']
    const mappings = detectMappings(headers, [])
    expect(mappings.venues).toEqual(['venueName', 'notes', 'notes'])
    expect(mappings.bands).toEqual(['bandName', 'genre', 'notes'])
    // With a Vorname column, "Name" is the surname; Genre means nothing here
    expect(mappings.persons).toEqual(['lastName', 'ignore', 'firstName'])
  })
})

describe('band lists', () => {
  const HEADERS = ['Band', 'Genre', 'Firma', 'Management', 'Mitglieder', 'TL', 'E-Mail']

  it('import bands of existing companies with members and technical lead', async () => {
    const companies = container.resolve(CompanyService)
    const bandCompany = await companies.createCompany({
      name: 'Pretty Wild GbR',
      isDefaultForInvoicing: false
    })
    const management = await companies.createCompany({
      name: 'Brainstorm Music Marketing AG',
      isDefaultForInvoicing: false
    })

    const req = request('bands', HEADERS, [
      [
        'Pretty Wild',
        'Hard Rock',
        'Pretty Wild GbR',
        'Brainstorm Music Marketing AG',
        'Benjamin Sänger (Gesang), Lisa Drums (Schlagzeug)',
        'Tom Technik',
        'tom@prettywild.de'
      ],
      ['', '', '', '', 'Max Bass (Bass)', '', ''],
      ['Ghost Band', '', 'Gibt es nicht GmbH', '', 'Nobody Here', '', ''],
      ['', '', '', '', 'Also Nobody', '', ''],
      ['Lonely Band', '', 'Pretty Wild GbR', 'Unbekannt AG', '', '', '']
    ])

    const preview = service().preview(req)
    expect(preview.rows.map((row) => row.status)).toEqual([
      'record',
      'continuation',
      'skipped',
      'skipped',
      'record'
    ])
    expect(preview.rows[2].warnings[0]).toContain('„Gibt es nicht GmbH“ nicht gefunden')
    expect(preview.rows[4].warnings[0]).toContain('Management „Unbekannt AG“ nicht gefunden')
    expect(preview.rows[0].company).toEqual({ label: 'Pretty Wild GbR', action: 'existing' })

    const result = service().commit(req)
    expect(result.bands).toEqual({ created: 2, updated: 0 })
    expect(result.persons.created).toBe(4)

    const band = db.select().from(schema.band).where(eq(schema.band.name, 'Pretty Wild')).get()!
    expect(band).toMatchObject({
      genre: 'Hard Rock',
      company_id: bandCompany.id,
      management_company_id: management.id
    })
    const members = db
      .select({ role: schema.band_member.role, name: schema.person.first_name })
      .from(schema.band_member)
      .innerJoin(schema.person, eq(schema.band_member.person_id, schema.person.id))
      .where(eq(schema.band_member.band_id, band.id))
      .all()
    expect(members).toEqual(
      expect.arrayContaining([
        { role: 'Gesang', name: 'Benjamin' },
        { role: 'Schlagzeug', name: 'Lisa' },
        { role: 'Bass', name: 'Max' }
      ])
    )
    const lead = db
      .select()
      .from(schema.person)
      .where(eq(schema.person.id, band.responsible_person_id!))
      .get()!
    expect(lead.first_name).toBe('Tom')
    const leadContact = db
      .select()
      .from(schema.contact)
      .where(eq(schema.contact.id, lead.contact_id!))
      .get()!
    expect(leadContact.email).toBe('tom@prettywild.de')
  })

  it('need the band and company columns', () => {
    const preview = service().preview(request('bands', ['Band', 'Genre'], [['X', 'Rock']]))
    expect(preview.errors).toEqual([
      'Ordnen Sie die Spalte „Firma der Band“ zu – jede Band gehört zu einer Firma.'
    ])
  })
})

describe('company lists', () => {
  it('import companies with contacts and address', () => {
    const result = service().commit(
      request(
        'companies',
        ['Firma', 'Ansprechpartner', 'E-Mail', 'Straße', 'PLZ', 'Ort', 'Land'],
        [
          [
            'Batschkapp GmbH',
            'Matze Brunner',
            'matze@batschkapp.de',
            'Gwinnerstr. 5',
            '60388',
            'Frankfurt',
            'HE'
          ],
          ['', 'Verena Schick', 'verena@batschkapp.de', '', '', '', '']
        ]
      )
    )
    expect(result.companies.created).toBe(1)
    expect(result.persons.created).toBe(2)
    const company = db
      .select()
      .from(schema.company)
      .where(eq(schema.company.name, 'Batschkapp GmbH'))
      .get()!
    const address = db
      .select()
      .from(schema.address)
      .where(eq(schema.address.id, company.address_id!))
      .get()!
    expect(address).toMatchObject({ city: 'Frankfurt', state: 'Hessen', country_code: 'DE' })
    expect(
      db
        .select()
        .from(schema.company_member)
        .where(eq(schema.company_member.company_id, company.id))
        .all()
    ).toHaveLength(2)
  })
})

describe('person lists', () => {
  it('import persons with address, birthday and company role', () => {
    const result = service().commit(
      request(
        'persons',
        ['Vorname', 'Name', 'Geburtstag', 'Firma', 'Rolle', 'E-Mail', 'Straße', 'PLZ', 'Ort'],
        [
          [
            'Anna',
            'Agentur',
            '12.03.1985',
            'Neue Agentur GmbH',
            'Booking',
            'anna@agentur.de',
            'Hauptstr. 1',
            '1099',
            'Dresden'
          ],
          ['', '', '', '', '', 'nur@mail.de', '', '', '']
        ]
      )
    )
    expect(result.persons.created).toBe(1)
    expect(result.companies.created).toBe(1)
    const person = db
      .select()
      .from(schema.person)
      .where(eq(schema.person.last_name, 'Agentur'))
      .get()!
    expect(person.birthday).toBe('1985-03-12')
    const address = db
      .select()
      .from(schema.address)
      .where(eq(schema.address.id, person.address_id!))
      .get()!
    expect(address).toMatchObject({ street: 'Hauptstr. 1', zip_code: '01099', city: 'Dresden' })
    const membership = db
      .select()
      .from(schema.company_member)
      .where(eq(schema.company_member.person_id, person.id))
      .get()!
    expect(membership.role).toBe('Booking')
  })
})

describe('remembered mappings', () => {
  it('are reused for lists with the same columns', () => {
    const headers = ['Act', 'Label', 'Leute']
    const req = request('bands', headers, [])
    req.mapping = ['bandName', 'companyName', 'members']
    service().commit(req)

    const workbook: ImportWorkbook = {
      fileName: 'bands.xlsx',
      sheets: [
        {
          name: 'Tabelle1',
          headers,
          rows: [],
          suggestedTarget: 'venues',
          suggestedMappings: detectMappings(headers, []),
          mappingRemembered: false,
          suggestedKind: 'venue',
          suggestedCountry: 'DE'
        }
      ]
    }
    const [sheet] = service().withRememberedMappings(workbook).sheets
    expect(sheet.mappingRemembered).toBe(true)
    expect(sheet.suggestedTarget).toBe('bands')
    expect(sheet.suggestedMappings.bands).toEqual(['bandName', 'companyName', 'members'])
  })
})
