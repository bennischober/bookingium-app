// Follow-ups (Wiedervorlagen): on a record or general, open ones earliest
// first, done and back, gone with their record.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { FollowUpService } from '../src/main/services/FollowUpService'
import { CreateFollowUpInput, FollowUpMail } from '../src/main/api/schemas/followUp.schema'

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

  it('keeps a history of done ones, the last ticked off first, in pages', () => {
    const ids = ['Erste', 'Zweite', 'Dritte'].map(
      (note) => service().create({ dueDate: '2026-11-02', note }).id
    )
    // Done one after another (done_at has seconds only: set them apart by hand)
    ids.forEach((id, index) => {
      service().setDone(id, true)
      db.update(schema.follow_up)
        .set({ done_at: `2026-11-0${index + 3} 10:00:00` })
        .where(eq(schema.follow_up.id, id))
        .run()
    })
    service().create({ dueDate: '2026-11-09', note: 'Noch offen' })

    const firstPage = service().listDone(2)
    expect(firstPage.items.map((followUp) => followUp.note)).toEqual(['Dritte', 'Zweite'])
    expect(firstPage.hasMore).toBe(true)
    const all = service().listDone(50)
    expect(all.items.map((followUp) => followUp.note).slice(0, 3)).toEqual([
      'Dritte',
      'Zweite',
      'Erste'
    ])
    expect(all.items.every((followUp) => followUp.doneAt !== null)).toBe(true)
    expect(all.hasMore).toBe(false)

    // Opened again, it leaves the history
    service().setDone(ids[2], false)
    expect(
      service()
        .listDone(2)
        .items.map((followUp) => followUp.note)
    ).toEqual(['Zweite', 'Erste'])
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

  it('is on an invoice: a draft by its recipient, gone with the draft', () => {
    const companyId = db
      .insert(schema.company)
      .values({ name: 'Live Music Berlin GmbH' })
      .returning()
      .get().id
    const recipientId = db
      .insert(schema.invoice_party_snapshot)
      .values({ kind: 'company', legal_name: 'Club Kesselhaus' })
      .returning()
      .get().id
    const draftId = db
      .insert(schema.invoice)
      .values({ company_id: companyId, recipient_snapshot_id: recipientId })
      .returning()
      .get().id
    const issuedId = db
      .insert(schema.invoice)
      .values({ company_id: companyId, invoice_number: 12, status: 'issued' })
      .returning()
      .get().id

    service().create({
      dueDate: '2026-10-27',
      note: 'Gage nachtragen',
      record: { type: 'invoice', id: draftId }
    })
    service().create({
      dueDate: '2026-11-20',
      note: 'Zahlung prüfen',
      record: { type: 'invoice', id: issuedId }
    })
    expect(service().listOpenByRecord('invoice', draftId)[0].record).toEqual({
      type: 'invoice',
      id: draftId,
      name: 'Rechnungsentwurf · Club Kesselhaus'
    })
    expect(service().listOpenByRecord('invoice', issuedId)[0].record?.name).toBe('Rechnung #12')

    db.delete(schema.invoice).where(eq(schema.invoice.id, draftId)).run()
    expect(service().listOpenByRecord('invoice', draftId)).toEqual([])
  })

  const followUpRow = (id: number) =>
    db.select().from(schema.follow_up).where(eq(schema.follow_up.id, id)).get()!

  it('waits for a reply to a sent mail and is closed by it once (#121)', () => {
    const bandId = createBand('Antwortband')
    // as the router hands it over: parsed, the Message-ID without its brackets
    const waiting = service().create(
      CreateFollowUpInput.parse({
        dueDate: '2026-11-13',
        note: 'Antwort auf „Angebot“',
        record: { type: 'band', id: bandId },
        mail: { accountId: 'acc', messageId: '<sent-1@example.test>' }
      })
    )
    expect(waiting).toMatchObject({
      mail: { accountId: 'acc', messageId: 'sent-1@example.test' },
      repliedAt: null
    })
    const plain = service().create({ dueDate: '2026-11-13', note: 'Ohne Mail' })
    expect(plain).toMatchObject({ mail: null, repliedAt: null })

    expect(service().closeByReplies('acc', [])).toBe(0)
    expect(service().closeByReplies('other', ['sent-1@example.test'])).toBe(0)
    expect(service().closeByReplies('acc', ['x@example.test', 'sent-1@example.test'])).toBe(1)
    const closed = followUpRow(waiting.id)
    expect(closed.replied_at).not.toBeNull()
    expect(closed.done_at).toBe(closed.replied_at)

    // Reopened by the user, it stays open when the same reply is seen again
    service().setDone(waiting.id, false)
    expect(service().closeByReplies('acc', ['sent-1@example.test'])).toBe(0)
    expect(followUpRow(waiting.id).done_at).toBeNull()
    expect(followUpRow(plain.id).done_at).toBeNull()
  })

  it('keeps the done date of one ticked off before the reply came (#121)', () => {
    const done = service().create({
      dueDate: '2026-11-13',
      note: 'Schon erledigt',
      mail: { accountId: 'acc', messageId: 'early@example.test' }
    })
    db.update(schema.follow_up)
      .set({ done_at: '2026-11-01 08:00:00' })
      .where(eq(schema.follow_up.id, done.id))
      .run()
    expect(service().closeByReplies('acc', ['early@example.test'])).toBe(1)
    expect(followUpRow(done.id).done_at).toBe('2026-11-01 08:00:00')
  })

  it('stores the Message-ID without brackets and needs one (#121)', () => {
    expect(FollowUpMail.parse({ accountId: 'a', messageId: ' <m@example.test> ' })).toEqual({
      accountId: 'a',
      messageId: 'm@example.test'
    })
    expect(FollowUpMail.safeParse({ accountId: 'a', messageId: '<>' }).success).toBe(false)
    expect(FollowUpMail.safeParse({ accountId: '', messageId: 'm@x.test' }).success).toBe(false)
  })

  it('needs a date and a note', () => {
    expect(CreateFollowUpInput.safeParse({ dueDate: '', note: 'x' }).success).toBe(false)
    expect(CreateFollowUpInput.safeParse({ dueDate: '2026-10-22', note: '  ' }).success).toBe(false)
  })
})
