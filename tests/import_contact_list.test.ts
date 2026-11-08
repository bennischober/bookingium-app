// #154: an imported CSV list saved as a Verteiler (member list). The records
// that take an address of the file go into the list in the same transaction;
// the list mails their current primary addresses, honours "Keine Werbung" and
// loses a record when it is deleted.
import 'reflect-metadata'
import { describe, it as sharedIt, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { ImportService } from '../src/main/services/ImportService'
import { ContactListService } from '../src/main/services/ContactListService'
import { detectMapping } from '../src/main/import/detectMapping'
import { ContactListFilters } from '../src/main/api/schemas/contactList.schema'
import type {
  ImportContactList,
  ImportRequest,
  ImportTarget
} from '../src/main/api/schemas/import.schema'

import { setupTestDb } from './helpers/setup'

// Every case starts from an empty database: setupTestDb() opens one per describe
const it = (name: string, run: () => void): void =>
  describe(name, () => {
    setupTestDb()
    sharedIt('', run)
  })

function request(
  target: ImportTarget,
  headers: string[],
  cells: string[][],
  contactList: ImportContactList | null = null
): ImportRequest {
  const rows = cells.map((row, index) => ({ rowNumber: index + 2, cells: row }))
  return {
    target,
    headers,
    rows,
    mapping: detectMapping(headers, rows, target),
    options: { kind: 'venue', companyKind: 'company', genres: '', defaultCountry: 'DE' },
    excludedRows: [],
    contactList
  }
}

const PERSON_HEADERS = ['Vorname', 'Name', 'Firma', 'E-Mail']
const personRows = [
  ['Anna', 'Liste', 'Agentur Eins GmbH', 'anna@eins.example.test'],
  ['Bernd', 'Liste', '', 'bernd@zwei.example.test'],
  // A company's own address: the company is the member
  ['', '', 'Verlag Drei', 'info@drei.example.test'],
  // No address: nobody goes into the list
  ['Carla', 'Ohnemail', 'Agentur Eins GmbH', '']
]

const importer = () => container.resolve(ImportService)
const lists = () => container.resolve(ContactListService)

const memberEmails = (listId: number): string[] =>
  lists()
    .build({ memberListId: listId })
    .recipients.map((row) => row.email)
    .sort()

describe('import as Verteiler', () => {
  it('counts the list members in the preview', () => {
    const preview = importer().preview(request('persons', PERSON_HEADERS, personRows))
    expect(preview.listMembers).toBe(3)
  })

  it('creates a member list with every record that took an address of the file', () => {
    const result = importer().commit(
      request('persons', PERSON_HEADERS, personRows, { id: null, name: 'Import-Liste' })
    )
    expect(result.contactList).toMatchObject({ name: 'Import-Liste', added: 3 })
    const saved = lists()
      .listSaved()
      .find((entry) => entry.id === result.contactList!.id)!
    expect(saved.kind).toBe('members')

    expect(memberEmails(saved.id)).toEqual([
      'anna@eins.example.test',
      'bernd@zwei.example.test',
      'info@drei.example.test'
    ])
    const built = lists().build({ memberListId: saved.id })
    const anna = built.recipients.find((row) => row.email === 'anna@eins.example.test')!
    expect(anna).toMatchObject({
      firstName: 'Anna',
      company: 'Agentur Eins GmbH',
      types: ['member']
    })
    const company = built.recipients.find((row) => row.email === 'info@drei.example.test')!
    expect(company).toMatchObject({ name: 'Verlag Drei', types: ['venue'] })
  })

  it('adds existing records to an existing list once, without a second import creating them', () => {
    const first = importer().commit(
      request('persons', PERSON_HEADERS, personRows, { id: null, name: 'Zweimal' })
    )
    const listId = first.contactList!.id
    const again = importer().commit(
      request(
        'persons',
        PERSON_HEADERS,
        [...personRows, ['Dora', 'Neu', '', 'dora@vier.example.test']],
        { id: listId, name: '' }
      )
    )
    // Only the new person is added; the others are on the list already
    expect(again.contactList).toEqual({ id: listId, name: 'Zweimal', added: 1 })
    expect(again.persons.created).toBe(1)
    expect(memberEmails(listId)).toHaveLength(4)
  })

  it('takes the clubs and their people of a venue list', () => {
    const result = importer().commit(
      request(
        'venues',
        ['Club', 'Ort', 'Ansprechpartner', 'E-Mail'],
        [
          [
            'Kellerclub',
            'Stadt',
            'Eva Booking',
            'eva@keller.example.test; info@keller.example.test'
          ],
          ['Hallenclub', 'Stadt', '', 'kontakt@halle.example.test']
        ],
        { id: null, name: 'Clubs aus Datei' }
      )
    )
    expect(result.contactList!.added).toBe(3)
    const built = lists().build({ memberListId: result.contactList!.id })
    expect(built.recipients.map((row) => row.email).sort()).toEqual([
      'eva@keller.example.test',
      'info@keller.example.test',
      'kontakt@halle.example.test'
    ])
    const eva = built.recipients.find((row) => row.email === 'eva@keller.example.test')!
    expect(eva.sources.map((source) => source.name)).toEqual(['Kellerclub'])
  })

  it('refuses a filter list or a missing list as target and then writes nothing', () => {
    const filterList = lists().save({
      name: 'Nur Filter',
      filters: ContactListFilters.parse({ kinds: ['venue'] })
    })
    expect(() =>
      importer().commit(
        request('persons', PERSON_HEADERS, personRows, { id: filterList.id, name: '' })
      )
    ).toThrow(/Filter-Verteiler/)
    expect(() =>
      importer().commit(request('persons', PERSON_HEADERS, personRows, { id: 99999, name: '' }))
    ).toThrow(/existiert nicht mehr/)
    expect(() =>
      importer().commit(request('persons', PERSON_HEADERS, personRows, { id: null, name: '' }))
    ).toThrow(/Namen/)
    // The whole import ran in the failed transaction
    expect(db.select().from(schema.person).all()).toHaveLength(0)
  })
})

describe('member lists', () => {
  const imported = (name: string): number =>
    importer().commit(request('persons', PERSON_HEADERS, personRows, { id: null, name }))
      .contactList!.id

  it('leave out "Keine Werbung" addresses', () => {
    const listId = imported('Werbung')
    lists().setNoAdvertising('BERND@zwei.example.test', true)
    const built = lists().build({ memberListId: listId })
    expect(built.recipients.map((row) => row.email)).not.toContain('bernd@zwei.example.test')
    expect(built.excluded.map((row) => row.email)).toEqual(['bernd@zwei.example.test'])
  })

  it('remove members by address, keeping the contact', () => {
    const listId = imported('Entfernen')
    expect(lists().removeMember(listId, ' Anna@Eins.example.test ')).toBe(1)
    expect(memberEmails(listId)).toEqual(['bernd@zwei.example.test', 'info@drei.example.test'])
    expect(
      db.select().from(schema.person).where(eq(schema.person.first_name, 'Anna')).all()
    ).toHaveLength(1)
  })

  it('lose a record that is deleted, and follow a changed primary address', () => {
    const listId = imported('Folgen')
    const bernd = db
      .select()
      .from(schema.person)
      .where(eq(schema.person.first_name, 'Bernd'))
      .get()!
    db.update(schema.contact)
      .set({ email: 'bernd.neu@zwei.example.test' })
      .where(eq(schema.contact.id, bernd.contact_id!))
      .run()
    const anna = db.select().from(schema.person).where(eq(schema.person.first_name, 'Anna')).get()!
    db.delete(schema.person).where(eq(schema.person.id, anna.id)).run()

    expect(memberEmails(listId)).toEqual(['bernd.neu@zwei.example.test', 'info@drei.example.test'])
    expect(db.select().from(schema.contact_list_member).all()).toHaveLength(2)
  })

  it('point at exactly one record', () => {
    const listId = imported('Prüfung')
    const company = db.select().from(schema.company).get()!
    const person = db.select().from(schema.person).get()!
    expect(() =>
      db
        .insert(schema.contact_list_member)
        .values({ contact_list_id: listId, person_id: person.id, company_id: company.id })
        .run()
    ).toThrow(/CHECK/)
    expect(() =>
      db.insert(schema.contact_list_member).values({ contact_list_id: listId }).run()
    ).toThrow(/CHECK/)
  })

  it('keep their members on rename and drop them with the list', () => {
    const listId = imported('Alt')
    const renamed = lists().save({
      id: listId,
      name: 'Neu',
      filters: ContactListFilters.parse({ kinds: ['venue'] })
    })
    expect(renamed).toMatchObject({ name: 'Neu', kind: 'members' })
    expect(memberEmails(listId)).toHaveLength(3)

    lists().deleteSaved(listId)
    expect(db.select().from(schema.contact_list_member).all()).toHaveLength(0)
    expect(db.select().from(schema.person).all().length).toBeGreaterThan(0)
  })

  it('cannot be built or edited as a filter list the other way round', () => {
    const filterList = lists().save({ name: 'Filter', filters: ContactListFilters.parse({}) })
    expect(() => lists().build({ memberListId: filterList.id })).toThrow(/Filter-Verteiler/)
    expect(() => lists().removeMember(filterList.id, 'anna@eins.example.test')).toThrow(
      /Filter-Verteiler/
    )
  })
})
