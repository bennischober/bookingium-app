// #123: the user's own mail templates - stored, renamed and deleted, the values an event
// gives their placeholders, and the template filled (a placeholder without a value stays).
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
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
import { setupTestDb } from './helpers/setup'

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
