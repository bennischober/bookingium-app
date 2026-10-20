// Follow-ups (Wiedervorlagen): on a record or general, open ones earliest
// first, done and back, gone with their record.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { FollowUpService } from '../src/main/services/FollowUpService'
import { CreateFollowUpInput } from '../src/main/api/schemas/followUp.schema'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const service = () => container.resolve(FollowUpService)

function createBand(name: string): number {
  const company = db
    .insert(schema.company)
    .values({ name: `${name} GbR` })
    .returning()
    .get()
  return db.insert(schema.band).values({ name, company_id: company.id }).returning().get().id
}

describe('FollowUpService', () => {
  it('lists open follow-ups earliest first with the record they are on', () => {
    const bandId = createBand('The New Roses')
    const eventId = db
      .insert(schema.deal_memo)
      .values({ name: 'München', date: '2026-06-11', band_id: bandId })
      .returning()
      .get().id
    const personId = db
      .insert(schema.person)
      .values({ first_name: 'Lea', last_name: 'Berg' })
      .returning()
      .get().id

    service().create({
      dueDate: '2026-11-03',
      note: 'Vertrag zurück?',
      record: { type: 'event', id: eventId }
    })
    service().create({
      dueDate: '2026-10-21',
      note: 'Anrufen',
      record: { type: 'person', id: personId }
    })
    service().create({ dueDate: '2026-10-25', note: 'Festivalsaison planen' })

    const open = service().listOpen()
    expect(open.map((followUp) => followUp.note)).toEqual([
      'Anrufen',
      'Festivalsaison planen',
      'Vertrag zurück?'
    ])
    expect(open[0].record).toEqual({ type: 'person', id: personId, name: 'Lea Berg' })
    expect(open[1].record).toBeNull()
    expect(open[2].record).toEqual({ type: 'event', id: eventId, name: 'München (11.06.2026)' })

    expect(
      service()
        .listOpenByRecord('event', eventId)
        .map((f) => f.note)
    ).toEqual(['Vertrag zurück?'])
    expect(service().listOpenByRecord('band', bandId)).toEqual([])
  })

  it('edits, marks done and back, deletes', () => {
    const bandId = createBand('Pretty Wild')
    const created = service().create({
      dueDate: '2026-10-22',
      note: 'Rider schicken',
      record: { type: 'band', id: bandId }
    })

    const moved = service().update({ id: created.id, dueDate: '2026-10-29' })
    expect(moved).toMatchObject({ dueDate: '2026-10-29', note: 'Rider schicken' })

    expect(service().setDone(created.id, true).doneAt).not.toBeNull()
    expect(service().listOpenByRecord('band', bandId)).toEqual([])
    expect(service().setDone(created.id, false).doneAt).toBeNull()
    expect(service().listOpenByRecord('band', bandId)).toHaveLength(1)

    service().delete(created.id)
    expect(service().listOpenByRecord('band', bandId)).toEqual([])
  })

  it('goes with its record', () => {
    const bandId = createBand('Gone Band')
    service().create({ dueDate: '2026-10-22', note: 'Weg', record: { type: 'band', id: bandId } })
    db.delete(schema.band).where(eq(schema.band.id, bandId)).run()
    expect(
      service()
        .listOpen()
        .some((followUp) => followUp.note === 'Weg')
    ).toBe(false)
  })

  it('needs a date and a note', () => {
    expect(CreateFollowUpInput.safeParse({ dueDate: '', note: 'x' }).success).toBe(false)
    expect(CreateFollowUpInput.safeParse({ dueDate: '2026-10-22', note: '  ' }).success).toBe(false)
  })
})
