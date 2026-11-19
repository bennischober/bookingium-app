// #249: merging two records that are the same company, person or club/festival
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { setupTestDb, getTestDb } from './helpers/setup'
import { MergeService } from '../src/main/services/MergeService'
import { CompanyService } from '../src/main/services/CompanyService'
import { PersonService } from '../src/main/services/PersonService'
import { BandService } from '../src/main/services/BandService'
import { RelationService } from '../src/main/services/RelationService'
import { CreateCompanyInput } from '../src/main/api/schemas/company.schema'
import { CreatePersonInput } from '../src/main/api/schemas/person.schema'
import { schema } from '../src/main/db/schema'

setupTestDb()

const merge = () => container.resolve(MergeService)
const db = () => getTestDb().db
const company = (name: string, extra: object = {}) =>
  container.resolve(CompanyService).createCompany(CreateCompanyInput.parse({ name, ...extra }))
const person = (firstName: string, lastName: string, email = '') =>
  container
    .resolve(PersonService)
    .createPerson(CreatePersonInput.parse({ firstName, lastName, notes: null, contact: { email } }))

describe('merging companies', () => {
  it('moves bands, fills empty fields, asks for differing ones and removes the other', async () => {
    const keep = await company('Merge Konzerte GmbH', { vatId: 'DE123456789' })
    const drop = await company('Merge Konzerte', {
      vatId: 'DE987654321',
      taxNumber: '12/345/67890',
      notes: 'aus der Liste'
    })
    const band = await container
      .resolve(BandService)
      .createBand({ name: 'Merge Band', companyId: drop.id, genre: '', notes: '' })

    const preview = merge().preview({ kind: 'company', keepId: keep.id, dropId: drop.id })
    expect(preview.fields).toEqual([
      { key: 'name', label: 'Name', keep: 'Merge Konzerte GmbH', drop: 'Merge Konzerte' },
      { key: 'vat_id', label: 'USt-IdNr.', keep: 'DE123456789', drop: 'DE987654321' }
    ])
    expect(preview.fills.map((f) => f.label)).toContain('Steuernummer')
    expect(preview.moves).toEqual([{ label: 'Band', count: 1 }])

    merge().merge({ kind: 'company', keepId: keep.id, dropId: drop.id, take: ['vat_id'] })
    const kept = db().select().from(schema.company).where(eq(schema.company.id, keep.id)).get()!
    expect(kept).toMatchObject({
      name: 'Merge Konzerte GmbH',
      vat_id: 'DE987654321',
      tax_number: '12/345/67890',
      notes: 'aus der Liste'
    })
    expect(
      db().select().from(schema.company).where(eq(schema.company.id, drop.id)).get()
    ).toBeUndefined()
    expect(
      db().select().from(schema.band).where(eq(schema.band.id, band.id)).get()?.company_id
    ).toBe(keep.id)
  })

  it('suggests a record with the same name without legal form', async () => {
    const a = await company('Vorschlag Booking GmbH')
    const b = await company('Vorschlag Booking')
    expect(merge().candidates('company', a.id)).toEqual([
      { id: b.id, name: 'Vorschlag Booking', reason: 'gleicher Name' }
    ])
  })
})

describe('merging persons', () => {
  it('keeps one band membership when both were in the band, and joins the emails', async () => {
    const owner = await company('Merge Personen GmbH')
    const band = await container
      .resolve(BandService)
      .createBand({ name: 'Personen Band', companyId: owner.id, genre: '', notes: '' })
    const keep = await person('Johanna', 'Beispiel', 'johanna@example.test')
    const drop = await person('Jo', 'Beispiel', 'jo@example.test')
    const relations = container.resolve(RelationService)
    await relations.addBandMember({
      bandId: band.id,
      personId: keep.id,
      role: 'Gitarre',
      notes: ''
    })
    await relations.addBandMember({ bandId: band.id, personId: drop.id, role: 'Gesang', notes: '' })

    expect(
      merge()
        .candidates('person', keep.id)
        .map((c) => c.id)
    ).not.toContain(drop.id)

    merge().merge({ kind: 'person', keepId: keep.id, dropId: drop.id, take: [] })
    const members = db()
      .select()
      .from(schema.band_member)
      .where(eq(schema.band_member.band_id, band.id))
      .all()
    expect(members.map((m) => m.person_id)).toEqual([keep.id])
    const kept = db().select().from(schema.person).where(eq(schema.person.id, keep.id)).get()!
    const emails = db()
      .select({ email: schema.contact_email.email })
      .from(schema.contact_email)
      .where(eq(schema.contact_email.contact_id, kept.contact_id!))
      .all()
      .map((row) => row.email)
    expect(emails).toContain('jo@example.test')
    expect(
      db().select().from(schema.person).where(eq(schema.person.id, drop.id)).get()
    ).toBeUndefined()
  })

  it('suggests a person with the same email', async () => {
    const a = await person('Max', 'Muster', 'max@example.test')
    const b = await person('Maximilian', 'Muster', 'max@example.test')
    expect(merge().candidates('person', a.id)).toEqual([
      { id: b.id, name: 'Maximilian Muster', reason: 'gleiche E-Mail' }
    ])
  })

  it('refuses to merge a record with itself', () => {
    expect(() => merge().preview({ kind: 'person', keepId: 5, dropId: 5 })).toThrow(
      /zwei verschiedene/
    )
  })
})
