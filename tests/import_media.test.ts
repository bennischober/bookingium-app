// Import of media and radio lists (#138): numbered E-Mail/Telefon columns,
// the company kind and genres, rows that hold only an address, and rows of a
// person list that hold only a company. Invented data only (example.test).
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { asc, eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { ImportService } from '../src/main/services/ImportService'
import { CompanyService } from '../src/main/services/CompanyService'
import { detectMapping, suggestCompanyKind, suggestTarget } from '../src/main/import/detectMapping'
import { emailDomain, isFreemailDomain } from '../src/main/import/normalize'
import type {
  ImportOptions,
  ImportRequest,
  ImportTarget
} from '../src/main/api/schemas/import.schema'

import { setupTestDb } from './helpers/setup'

setupTestDb()

function request(
  target: ImportTarget,
  headers: string[],
  cells: string[][],
  options: Partial<ImportOptions> = {}
): ImportRequest {
  const rows = cells.map((row, index) => ({ rowNumber: index + 2, cells: row }))
  return {
    target,
    headers,
    rows,
    mapping: detectMapping(headers, rows, target),
    options: {
      kind: 'venue',
      companyKind: 'company',
      genres: '',
      defaultCountry: 'DE',
      ...options
    },
    excludedRows: []
  }
}

const service = () => container.resolve(ImportService)

const companyNamed = (name: string) =>
  db.select().from(schema.company).where(eq(schema.company.name, name)).get()

const contactOf = (id: number | null | undefined) =>
  db.select().from(schema.contact).where(eq(schema.contact.id, id!)).get()!

const otherEmails = (contactId: number | null | undefined): string[] =>
  db
    .select({ email: schema.contact_email.email })
    .from(schema.contact_email)
    .where(eq(schema.contact_email.contact_id, contactId!))
    .orderBy(asc(schema.contact_email.position))
    .all()
    .map((row) => row.email)

const MEDIA = ['Medienpartner', 'AP', 'E-Mail', 'E-Mail 2', 'E-Mail 3', 'Telefon', 'Telefon 2']

describe('columns of media lists', () => {
  it('maps the outlet, numbered addresses and numbered phones', () => {
    const mapping = detectMapping([...MEDIA, 'Genre'], [], 'companies')
    expect(mapping).toEqual([
      'companyName',
      'contactPerson',
      'email',
      'email',
      'email',
      'phone',
      'notes',
      'genre'
    ])
    expect(detectMapping(['Radiosender', 'Tel', 'Tel 2'], [], 'companies')).toEqual([
      'companyName',
      'phone',
      'notes'
    ])
  })

  it('suggests a company list of the kind Radio/Medien', () => {
    expect(suggestTarget('Tabelle1', MEDIA)).toBe('companies')
    expect(suggestCompanyKind('Tabelle1', MEDIA)).toBe('media')
    expect(suggestCompanyKind('Medienverteiler Metal', ['Name', 'E-Mail'])).toBe('media')
    expect(suggestCompanyKind('Tabelle1', ['Vorname', 'Nachname', 'Radiosender'])).toBe('media')
    expect(suggestCompanyKind('Kunden', ['Firma', 'Ansprechpartner'])).toBe('company')
  })

  it('reads Haupttelefon and Weitere Vornamen of Outlook exports', () => {
    expect(
      detectMapping(
        ['Vorname', 'Weitere Vornamen', 'Nachname', 'Haupttelefon', 'E-Mail-Adresse'],
        [],
        'persons'
      )
    ).toEqual(['firstName', 'notes', 'lastName', 'phone', 'email'])
  })
})

describe('media lists', () => {
  it('create media companies with genres and further addresses', () => {
    const result = service().commit(
      request(
        'companies',
        MEDIA,
        [
          [
            'Riffwelle Test',
            'Mara Welle',
            'mara@riffradio.example.test',
            'redaktion@riffradio.example.test',
            'news@riffradio.example.test',
            '030 1234567',
            '030 2345678'
          ]
        ],
        { companyKind: 'media', genres: 'Metal; Rock' }
      )
    )
    expect(result.companies.created).toBe(1)

    const company = companyNamed('Riffwelle Test')!
    expect(company).toMatchObject({ kind: 'media', genres: 'Metal, Rock' })
    expect(company.notes).toContain('Telefon 2: 030 2345678')
    const contact = contactOf(company.contact_id)
    expect(contact).toMatchObject({
      email: 'redaktion@riffradio.example.test',
      phone: '030 1234567'
    })
    expect(otherEmails(company.contact_id)).toEqual(['news@riffradio.example.test'])

    const person = db
      .select()
      .from(schema.person)
      .where(eq(schema.person.first_name, 'Mara'))
      .get()!
    expect(contactOf(person.contact_id).email).toBe('mara@riffradio.example.test')
  })

  it('names rows that hold only an address after its domain', () => {
    const req = request(
      'companies',
      MEDIA,
      [
        ['', '', 'info@heavyzine.example.test', '', '', '', ''],
        // Same domain as the row above: a further address of that outlet
        ['', '', 'chef@heavyzine.example.test', '', '', '', ''],
        ['', '', 'tips@loudmag.example.test', '', '', '', ''],
        // Not right below its outlet: still the same company
        ['', '', 'ads@heavyzine.example.test', '', '', '', '']
      ],
      { companyKind: 'media', genres: 'Metal' }
    )

    const preview = service().preview(req)
    expect(preview.rows.map((row) => row.status)).toEqual([
      'record',
      'continuation',
      'record',
      'record'
    ])
    expect(preview.rows[0].warnings).toEqual([
      'Kein Name angegeben – nach der E-Mail-Adresse „heavyzine.example.test“ benannt'
    ])
    expect(preview.rows.map((row) => row.company?.label)).toEqual([
      'heavyzine.example.test',
      'heavyzine.example.test',
      'loudmag.example.test',
      'heavyzine.example.test'
    ])

    const result = service().commit(req)
    expect(result.companies.created).toBe(2)
    const zine = companyNamed('heavyzine.example.test')!
    expect(zine).toMatchObject({ kind: 'media', genres: 'Metal' })
    expect(contactOf(zine.contact_id).email).toBe('info@heavyzine.example.test')
    expect(otherEmails(zine.contact_id)).toEqual([
      'chef@heavyzine.example.test',
      'ads@heavyzine.example.test'
    ])
  })

  // Freemail rows are named after the person or the address (outletName). Tracked files may
  // hold addresses at reserved test domains only (no_pii), so the domain check is tested alone.
  it('know freemail domains', () => {
    expect(emailDomain('Info@HeavyZine.example.test')).toBe('heavyzine.example.test')
    expect(isFreemailDomain('gmail.com')).toBe(true)
    expect(isFreemailDomain('web.de')).toBe(true)
    expect(isFreemailDomain('heavyzine.example.test')).toBe(false)
  })

  it('leave rows without a name alone in a list of plain companies', () => {
    const preview = service().preview(
      request('companies', MEDIA, [['', '', 'info@heavyzine.example.test', '', '', '', '']])
    )
    expect(preview.rows[0].status).toBe('skipped')
  })

  it('give a genre column to the companies and venues', () => {
    service().commit(
      request('companies', ['Firma', 'Genre'], [['Doom Testpresse', 'Doom, Sludge']], {
        companyKind: 'media'
      })
    )
    expect(companyNamed('Doom Testpresse')).toMatchObject({ kind: 'media', genres: 'Doom, Sludge' })

    service().commit(
      request(
        'venues',
        ['Festival', 'Ort', 'Genre'],
        [['Moortest Open Air', 'Musterdorf', 'Stoner']],
        {
          kind: 'festival',
          genres: 'Rock'
        }
      )
    )
    const venue = db
      .select()
      .from(schema.venue)
      .where(eq(schema.venue.name, 'Moortest Open Air'))
      .get()!
    expect(venue.genres).toBe('Stoner, Rock')
    expect(venue.notes).not.toContain('Genre')
  })
})

describe('person lists of radio stations', () => {
  const HEADERS = ['Radiosender', 'Vorname', 'Nachname', 'E-Mail', 'E-Mail 2', 'Position']

  it('take a row without a person as the station’s own data', () => {
    const req = request(
      'persons',
      HEADERS,
      [
        ['Testfunk Nord', 'Kai', 'Moderator', 'kai@wellenord.example.test', '', 'Musikredaktion'],
        [
          'Testfunk Nord',
          '',
          '',
          'studio@wellenord.example.test',
          'musik@wellenord.example.test',
          'Studio'
        ],
        ['', '', '', 'hits@radiohits.example.test', '', '']
      ],
      { companyKind: 'media', genres: 'Rock' }
    )
    const preview = service().preview(req)
    expect(preview.rows.map((row) => row.status)).toEqual(['record', 'record', 'record'])
    expect(preview.rows[1].primary).toBeNull()
    expect(preview.rows[2].company?.label).toBe('radiohits.example.test')

    const result = service().commit(req)
    expect(result.companies.created).toBe(2)
    expect(result.persons.created).toBe(1)
    const station = companyNamed('Testfunk Nord')!
    expect(station).toMatchObject({ kind: 'media', genres: 'Rock' })
    expect(station.notes).toContain('Rolle: Studio')
    expect(contactOf(station.contact_id).email).toBe('studio@wellenord.example.test')
    expect(otherEmails(station.contact_id)).toEqual(['musik@wellenord.example.test'])
    const members = db
      .select({ role: schema.company_member.role })
      .from(schema.company_member)
      .where(eq(schema.company_member.company_id, station.id))
      .all()
    expect(members).toEqual([{ role: 'Musikredaktion' }])
  })

  it('complete an existing contact with further addresses', async () => {
    const existing = await container.resolve(CompanyService).createCompany({
      name: 'Testfunk Süd',
      contact: { email: 'info@wellesued.example.test' },
      isDefaultForInvoicing: false
    })
    const result = service().commit(
      request('persons', HEADERS, [
        ['Testfunk Süd', '', '', 'info@wellesued.example.test', 'musik@wellesued.example.test', '']
      ])
    )
    expect(result.companies).toEqual({ created: 0, updated: 1 })
    const company = companyNamed('Testfunk Süd')!
    expect(company.id).toBe(existing.id)
    expect(contactOf(company.contact_id).email).toBe('info@wellesued.example.test')
    expect(otherEmails(company.contact_id)).toEqual(['musik@wellesued.example.test'])
  })
})
