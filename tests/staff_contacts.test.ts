// #262: contacts for an employee. An uploaded list shares its records with the employee (found
// ones without a duplicate, missing ones created); a contact the employee creates although the
// company has it is merged into the company's record.
import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { container } from 'tsyringe'
import { and, eq } from 'drizzle-orm'
import { db, getSqlite } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { ImportService } from '../src/main/services/ImportService'
import { MergeService } from '../src/main/services/MergeService'
import { detectMapping } from '../src/main/import/detectMapping'
import { idRange } from '../src/main/sync/ids'
import { mergeStaffDuplicates, type DuplicateMerger } from '../src/main/staff/dedupe'
import { shareRecords } from '../src/main/repositories/staffGrants'
import { computeStaffView } from '../src/main/staff/policy'
import type { ImportRequest } from '../src/main/api/schemas/import.schema'
import type { StaffGrantEntity } from '../src/main/api/schemas/staff.schema'
import { setupTestDb } from './helpers/setup'

const PREFIX = 555
// counting down: the in-memory database hands out ids above the highest one
let ownId = idRange(PREFIX).last

setupTestDb()

let employeeId: number
beforeEach(() => {
  const sqlite = getSqlite()
  for (const table of [
    'staff_grant',
    'employee',
    'contact_list_member',
    'company_member',
    'person',
    'company',
    'contact_email',
    'contact'
  ])
    sqlite.exec(`DELETE FROM ${table}`)
  employeeId = db
    .insert(schema.employee)
    .values({ name: 'Erika Muster', id_prefix: PREFIX })
    .returning()
    .get().id
})

function person(first: string, last: string, email: string | null, id?: number): number {
  const contactId = email ? db.insert(schema.contact).values({ email }).returning().get().id : null
  return db
    .insert(schema.person)
    .values({ ...(id ? { id } : {}), first_name: first, last_name: last, contact_id: contactId })
    .returning()
    .get().id
}

const grantsOf = (entity: string) =>
  db
    .select()
    .from(schema.staff_grant)
    .where(
      and(eq(schema.staff_grant.employee_id, employeeId), eq(schema.staff_grant.entity, entity))
    )
    .all()

const view = () => computeStaffView(getSqlite(), { employeeId, idPrefix: PREFIX })

describe('contact list shared with an employee', () => {
  const headers = ['Vorname', 'Name', 'Firma', 'E-Mail']
  const request = (cells: string[][]): ImportRequest => {
    const rows = cells.map((row, index) => ({ rowNumber: index + 2, cells: row }))
    return {
      target: 'persons',
      headers,
      rows,
      mapping: detectMapping(headers, rows, 'persons'),
      options: { kind: 'venue', companyKind: 'company', genres: '', defaultCountry: 'DE' },
      excludedRows: [],
      contactList: null,
      shareWith: employeeId
    }
  }

  it('shares found and new records without creating duplicates', () => {
    const known = person('Anna', 'Bekannt', 'anna@eins.example.test')
    const hidden = person('Otto', 'Geheim', 'otto@zwei.example.test')
    const result = container.resolve(ImportService).commit(
      request([
        ['Anna', 'Bekannt', 'Agentur Eins GmbH', 'anna@eins.example.test'],
        ['Bernd', 'Neu', '', 'bernd@drei.example.test']
      ])
    )
    expect(result.persons).toMatchObject({ created: 1, updated: 0 })
    expect(db.select().from(schema.person).all()).toHaveLength(3)
    // Anna, Bernd and the company
    expect(result.shared).toBe(3)
    const people = view().get('person')!
    expect(people.has(String(known))).toBe(true)
    expect(people.has(String(hidden))).toBe(false)
    expect([...people.values()].map((row) => row.first_name).sort()).toEqual(['Anna', 'Bernd'])
    expect(grantsOf('company')).toHaveLength(1)
  })

  it('shares a record again that was internal for the employee', () => {
    const known = person('Anna', 'Bekannt', 'anna@eins.example.test')
    db.insert(schema.staff_grant)
      .values({ employee_id: employeeId, entity: 'person', entity_id: known, access: 'internal' })
      .run()
    container.resolve(ImportService).commit(request([['Anna', 'Bekannt', '', '']]))
    expect(grantsOf('person').map((g) => g.access)).toEqual(['shared'])
  })

  it('refuses an employee whose access was taken away', () => {
    db.update(schema.employee).set({ revoked_at: '2026-11-01' }).run()
    expect(() => container.resolve(ImportService).commit(request([['Anna', 'B', '', '']]))).toThrow(
      /entzogen/
    )
    expect(db.select().from(schema.person).all()).toHaveLength(0)
  })
})

describe("the employee's duplicates", () => {
  const merger = (): DuplicateMerger => {
    const merge = container.resolve(MergeService)
    return {
      candidates: (kind, id) => merge.candidates(kind, id),
      merge: (input) => merge.merge(input),
      share: (kind, id) =>
        db.transaction((tx) => {
          shareRecords(tx, employeeId, kind as StaffGrantEntity, [id])
        })
    }
  }
  const run = (id: number) =>
    mergeStaffDuplicates(
      getSqlite(),
      { employeeId, idPrefix: PREFIX },
      [{ table: 'person', key: String(id) }],
      merger()
    )

  it('merges a person with the same e-mail into the company record and shares it', () => {
    const company = person('Anna', 'Bekannt', 'anna@eins.example.test')
    const own = person('A.', 'Bekannt', 'Anna@Eins.example.test ', ownId--)
    expect(run(own)).toBe(1)
    expect(
      db
        .select()
        .from(schema.person)
        .all()
        .map((p) => p.id)
    ).toEqual([company])
    expect(grantsOf('person').map((g) => [g.entity_id, g.access])).toEqual([[company, 'shared']])
    expect(view().get('person')!.has(String(company))).toBe(true)
  })

  it('merges a same-named person without e-mail', () => {
    const company = person('Bernd', 'Beispiel', 'bernd@zwei.example.test')
    const own = person('Bernd', 'Beispiel', null, ownId--)
    expect(run(own)).toBe(1)
    expect(
      db
        .select()
        .from(schema.person)
        .all()
        .map((p) => p.id)
    ).toEqual([company])
  })

  it('keeps a same-named person with a different e-mail, and one of two same-named', () => {
    person('Carla', 'Muster', 'carla@eins.example.test')
    const differs = person('Carla', 'Muster', 'carla@zwei.example.test', ownId--)
    expect(run(differs)).toBe(0)
    person('Dora', 'Muster', null)
    person('Dora', 'Muster', null)
    const twice = person('Dora', 'Muster', null, ownId--)
    expect(run(twice)).toBe(0)
    expect(grantsOf('person')).toHaveLength(0)
  })

  it('leaves the company records alone', () => {
    const company = person('Emil', 'Muster', null)
    person('Emil', 'Muster', null)
    expect(run(company)).toBe(0)
  })
})
