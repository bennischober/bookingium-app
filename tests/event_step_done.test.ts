// Steps of a show ticked as done outside the program ("extern erledigt"): stored per event and
// step, and no open point any more.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { EventStepService } from '../src/main/services/EventStepService'
import { OpenItemsService } from '../src/main/services/OpenItemsService'
import { keyOf } from '../src/main/sync/merge'
import { ALIAS_KEYS } from '../src/main/sync/tables'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const TODAY = '2026-11-18'

let counter = 0
function event(values: Partial<typeof schema.deal_memo.$inferInsert> = {}): number {
  counter += 1
  const company = db
    .insert(schema.company)
    .values({ name: `Schritt Firma ${counter}` })
    .returning()
    .get()
  const band = db
    .insert(schema.band)
    .values({ name: `Schritt Band ${counter}`, company_id: company.id })
    .returning()
    .get()
  return db
    .insert(schema.deal_memo)
    .values({ name: `Schritt ${counter}`, band_id: band.id, date: '2027-03-01', ...values })
    .returning()
    .get().id
}

const steps = () => container.resolve(EventStepService)
const kinds = async (eventId: number) =>
  (await container.resolve(OpenItemsService).list(eventId, TODAY)).map((item) => item.kind)

describe('steps done outside the program', () => {
  it('ticks and unticks a step; ticking twice keeps one row', () => {
    const id = event()
    expect(steps().list(id)).toEqual([])

    steps().set({ eventId: id, step: 'contract', done: true })
    const ticked = steps().set({ eventId: id, step: 'contract', done: true })
    expect(ticked.map((s) => s.step)).toEqual(['contract'])
    expect(ticked[0].doneAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

    steps().set({ eventId: id, step: 'invoice', done: true })
    expect(
      steps()
        .list(id)
        .map((s) => s.step)
    ).toEqual(['contract', 'invoice'])

    expect(steps().set({ eventId: id, step: 'contract', done: false })).toMatchObject([
      { step: 'invoice' }
    ])
  })

  it('ticks the settlement as done externally without touching the open points', async () => {
    const id = event({ contract_sent_at: '2026-11-01', status: 'confirmed', date: '2026-11-10' })
    const before = await kinds(id)
    expect(steps().set({ eventId: id, step: 'settlement', done: true })).toMatchObject([
      { step: 'settlement' }
    ])
    expect(await kinds(id)).toEqual(before)
  })

  it('refuses an unknown event', () => {
    expect(() => steps().set({ eventId: 999_999, step: 'hotel', done: true })).toThrow(
      'Event nicht gefunden'
    )
  })

  it('goes with its event', () => {
    const id = event()
    steps().set({ eventId: id, step: 'tickets', done: true })
    db.delete(schema.deal_memo).where(eq(schema.deal_memo.id, id)).run()
    expect(
      db
        .select()
        .from(schema.event_step_done)
        .where(eq(schema.event_step_done.deal_memo_id, id))
        .all()
    ).toEqual([])
  })

  it('takes a ticked step out of the open points, and back in when unticked', async () => {
    // contract sent, not back; a confirmed show already over without an invoice
    const id = event({ contract_sent_at: '2026-11-01', status: 'confirmed', date: '2026-11-10' })
    expect(await kinds(id)).toEqual(['contract', 'invoice'])

    steps().set({ eventId: id, step: 'contract', done: true })
    expect(await kinds(id)).toEqual(['invoice'])
    steps().set({ eventId: id, step: 'invoice', done: true })
    expect(await kinds(id)).toEqual([])

    steps().set({ eventId: id, step: 'contract', done: false })
    expect(await kinds(id)).toEqual(['contract'])
  })

  it('only hides the ticked event in the list of all open points', async () => {
    const ticked = event({ contract_sent_at: '2026-11-02' })
    const other = event({ contract_sent_at: '2026-11-03' })
    steps().set({ eventId: ticked, step: 'contract', done: true })
    const all = await container.resolve(OpenItemsService).list(undefined, TODAY)
    const ids = all.filter((item) => item.kind === 'contract').map((item) => item.eventId)
    expect(ids).toContain(other)
    expect(ids).not.toContain(ticked)
  })

  it('is the same row on two computers when event and step match', () => {
    expect(ALIAS_KEYS.event_step_done).toEqual([{ columns: ['deal_memo_id', 'step'] }])
    expect(keyOf('event_step_done', { deal_memo_id: 4, step: 'hotel', id: 1 })).toBe(
      keyOf('event_step_done', { deal_memo_id: 4, step: 'hotel', id: 99 })
    )
  })
})
