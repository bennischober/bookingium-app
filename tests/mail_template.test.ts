// #123: the user's own mail templates - stored, renamed and deleted, the values an event
// gives their placeholders, and the template filled (a placeholder without a value stays).
// #136: the fixed texts for invoices and contracts in the same table, and the migration that
// copies the texts edited in older versions out of the settings.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { container } from 'tsyringe'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { MailTemplateService } from '../src/main/services/MailTemplateService'
import { SaveMailTemplateInput } from '../src/main/api/schemas/mailTemplate.schema'
import {
  fillMailTemplate,
  mailTemplateEventValues,
  type MailTemplateEvent
} from '../src/main/mail/mailTemplate'
import { DEFAULT_DOCUMENT_EMAILS } from '../src/main/api/schemas/settings.schema'
import { getTestDb, setupTestDb } from './helpers/setup'

setupTestDb()

const service = () => container.resolve(MailTemplateService)

describe('mail templates', () => {
  it('are listed by name, updated in place and deleted', () => {
    const second = service().save({ name: 'Zusage', subject: 'Zusage {Event}', body: 'Hallo' })
    const first = service().save({ name: 'absage', subject: '', body: 'Leider nein' })
    expect(
      service()
        .list()
        .map((t) => t.name)
    ).toEqual(['absage', 'Zusage'])

    const updated = service().save({ id: second.id, name: 'Zusage', subject: 'Neu', body: 'B' })
    expect(updated).toEqual({ id: second.id, name: 'Zusage', subject: 'Neu', body: 'B' })
    expect(service().list()).toHaveLength(2)

    service().delete(first.id)
    expect(
      service()
        .list()
        .map((t) => t.id)
    ).toEqual([second.id])
    service().delete(second.id)
  })

  it('need a name, and an unknown id is an error', () => {
    expect(SaveMailTemplateInput.safeParse({ name: '  ', subject: '', body: '' }).success).toBe(
      false
    )
    expect(() => service().save({ id: 9999, name: 'X', subject: '', body: '' })).toThrow(
      'Vorlage nicht gefunden'
    )
  })

  it("take an event's band, venue, city and LoPro", () => {
    const label = db.insert(schema.company).values({ name: 'Band GbR' }).returning().get()
    const band = db
      .insert(schema.band)
      .values({ name: 'Iron Fist', company_id: label.id })
      .returning()
      .get()
    const address = db.insert(schema.address).values({ city: 'Leipzig' }).returning().get()
    const venue = db
      .insert(schema.venue)
      .values({ name: 'Halle 5', address_id: address.id })
      .returning()
      .get()
    const lopro = db
      .insert(schema.person)
      .values({ first_name: 'Erika', last_name: 'Muster' })
      .returning()
      .get()
    const company = db
      .insert(schema.company)
      .values({ name: 'Veranstalter GmbH' })
      .returning()
      .get()
    const event = db
      .insert(schema.deal_memo)
      .values({
        name: 'Iron Fist live',
        date: '2027-03-14',
        performance_time: '20:00',
        band_id: band.id,
        venue_id: venue.id,
        lopro_person_id: lopro.id,
        lopro_company_id: company.id
      })
      .returning()
      .get()

    expect(service().event(event.id)).toEqual({
      name: 'Iron Fist live',
      date: '2027-03-14',
      performanceTime: '20:00',
      band: 'Iron Fist',
      venue: 'Halle 5',
      city: 'Leipzig',
      lopro: 'Erika Muster'
    })

    // Without a venue and a LoPro person: the company, and empty venue and city
    const bare = db
      .insert(schema.deal_memo)
      .values({
        name: 'Open Air',
        date: '2027-06-01',
        band_id: band.id,
        lopro_company_id: company.id
      })
      .returning()
      .get()
    expect(service().event(bare.id)).toMatchObject({
      venue: '',
      city: '',
      lopro: 'Veranstalter GmbH',
      performanceTime: ''
    })

    expect(service().event(9999)).toBeNull()
  })
})

describe('fillMailTemplate', () => {
  const event: MailTemplateEvent = {
    name: 'Iron Fist live',
    date: '2027-03-14',
    performanceTime: '20:00',
    band: 'Iron Fist',
    venue: 'Halle 5',
    city: 'Leipzig',
    lopro: 'Erika Muster'
  }

  it('fills every placeholder from the event and the recipient', () => {
    const filled = fillMailTemplate(
      {
        subject: '{Band} am {Datum} – {Veranstaltungsort}',
        body: 'Hallo {Empfänger},\n\n{Event}: {Datum}, Beginn {Beginn}, {Ort}. LoPro: {LoPro}'
      },
      { ...mailTemplateEventValues(event), Empfänger: 'Max' }
    )
    expect(filled).toEqual({
      subject: 'Iron Fist am 14.03.2027 – Halle 5',
      body: 'Hallo Max,\n\nIron Fist live: 14.03.2027, Beginn 20:00, Leipzig. LoPro: Erika Muster'
    })
  })

  it('keeps a placeholder that has no value, and an unknown one', () => {
    const filled = fillMailTemplate(
      { subject: '  Anfrage {Band}  ', body: 'Hallo {Empfänger}, {Unbekannt}' },
      { Empfänger: '' }
    )
    expect(filled).toEqual({ subject: 'Anfrage {Band}', body: 'Hallo {Empfänger}, {Unbekannt}' })
  })
})

describe('fixed templates (#136)', () => {
  const clear = () => getTestDb().sqlite.exec('DELETE FROM mail_template')

  it('lists all eight, default until edited, and resets to the default', () => {
    clear()
    const all = service().documents()
    expect(all.map((t) => `${t.kind}:${t.lang}`)).toEqual([
      'invoice:de',
      'invoice:en',
      'reminder:de',
      'reminder:en',
      'dunning:de',
      'dunning:en',
      'contract:de',
      'contract:en'
    ])
    expect(all.every((t) => !t.edited)).toBe(true)
    expect(service().documentTemplate('dunning', 'en')).toEqual(DEFAULT_DOCUMENT_EMAILS.dunning.en)

    service().saveDocument({ kind: 'dunning', lang: 'en', subject: 'S1', body: 'B1' })
    service().saveDocument({ kind: 'dunning', lang: 'en', subject: 'S2', body: 'B2' })
    expect(service().documentTemplate('dunning', 'en')).toEqual({ subject: 'S2', body: 'B2' })
    const edited = service()
      .documents()
      .filter((t) => t.edited)
    expect(edited).toEqual([
      { kind: 'dunning', lang: 'en', subject: 'S2', body: 'B2', edited: true }
    ])
    // the other language keeps its default
    expect(service().documentTemplate('dunning', 'de')).toEqual(DEFAULT_DOCUMENT_EMAILS.dunning.de)

    service().resetDocument({ kind: 'dunning', lang: 'en' })
    expect(service().documentTemplate('dunning', 'en')).toEqual(DEFAULT_DOCUMENT_EMAILS.dunning.en)
    expect(
      service()
        .documents()
        .some((t) => t.edited)
    ).toBe(false)
  })

  it('are no own templates: not listed, renamed or deleted through them', () => {
    clear()
    service().saveDocument({ kind: 'invoice', lang: 'de', subject: 'S', body: 'B' })
    const own = service().save({ name: 'Zusage', subject: '', body: 'Hallo' })
    expect(
      service()
        .list()
        .map((t) => t.id)
    ).toEqual([own.id])

    const fixedId = getTestDb()
      .db.select()
      .from(schema.mail_template)
      .all()
      .find((row) => row.kind === 'invoice')!.id
    expect(() => service().save({ id: fixedId, name: 'X', subject: 'X', body: 'X' })).toThrow(
      'Vorlage nicht gefunden'
    )
    service().delete(fixedId)
    expect(service().documentTemplate('invoice', 'de')).toEqual({ subject: 'S', body: 'B' })
  })

  it('migration 0024 copies the texts edited in the settings', () => {
    clear()
    const { sqlite } = getTestDb()
    const setting = sqlite.prepare('INSERT INTO app_setting (key, value) VALUES (?, ?)')
    setting.run('invoiceEmailDe', JSON.stringify({ subject: 'Alt', body: 'Alter Text' }))
    setting.run('contractEmailEn', JSON.stringify({ subject: 'Old', body: 'Old text' }))
    // not a template: no copy, no error
    setting.run('reminderEmailDe', JSON.stringify({ subject: 1 }))
    setting.run('dunningEmailDe', 'kein JSON')

    const sql = readFileSync(
      resolve(__dirname, '../src/main/db/migrations/0024_magenta_mesmero.sql'),
      'utf8'
    )
    const copies = sql
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) => statement.startsWith('INSERT INTO'))
    expect(copies).toHaveLength(8)
    for (const statement of copies) sqlite.exec(statement)

    expect(service().documentTemplate('invoice', 'de')).toEqual({
      subject: 'Alt',
      body: 'Alter Text'
    })
    expect(service().documentTemplate('contract', 'en')).toEqual({
      subject: 'Old',
      body: 'Old text'
    })
    expect(
      service()
        .documents()
        .filter((t) => t.edited)
    ).toHaveLength(2)
    expect(service().list()).toEqual([])
  })
})
