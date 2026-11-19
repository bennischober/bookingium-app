// #232: advancing and ticket quota of a show. The sheet's cells ("angeschrieben am 05.10.",
// "warten auf Bestätigung"), the service behind the event tabs and the tour overview, and the
// tour import filling both from the Advancing and Ticketkontingent sheets of a tour file.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import {
  advancingDateOf,
  advancingStatusOf,
  quotaOf,
  soldOf,
  utilizationPercent
} from '../src/main/advancing/advancing'
import { AdvancingService } from '../src/main/services/AdvancingService'
import { TourImportService } from '../src/main/services/TourImportService'
import { TourImportRepository } from '../src/main/repositories/TourImportRepository'
import { buildTourImportPlan, detectTourMapping } from '../src/main/import/tourDates'
import type { TourImportRequest } from '../src/main/api/schemas/tour_import.schema'
import { setupTestDb } from './helpers/setup'

setupTestDb()

describe('advancing and ticket cells', () => {
  it('reads the stage of a status cell, the furthest one winning', () => {
    expect(advancingStatusOf('angeschrieben am 05.10.')).toBe('contacted')
    expect(advancingStatusOf('im Austausch')).toBe('in_progress')
    expect(advancingStatusOf('Erledigt')).toBe('done')
    expect(advancingStatusOf('offen')).toBe('open')
    expect(advancingStatusOf('')).toBeNull()
    expect(advancingStatusOf('siehe Mail')).toBeNull()
  })

  it('dates a day without a year before the show', () => {
    expect(advancingDateOf('angeschrieben am 05.10.', '2026-10-30')).toBe('2026-10-05')
    // written in December for a show in January
    expect(advancingDateOf('angeschrieben am 12.12.', '2027-01-15')).toBe('2026-12-12')
    expect(advancingDateOf('am 3.4.27', '2027-05-01')).toBe('2027-04-03')
    expect(advancingDateOf('im Austausch', '2027-05-01')).toBeNull()
  })

  it('reads a quota as a number or as what stands instead', () => {
    expect(quotaOf('200')).toEqual({ quota: 200, note: '' })
    expect(quotaOf('1.200')).toEqual({ quota: 1200, note: '' })
    expect(quotaOf('warten auf Bestätigung')).toEqual({
      quota: null,
      note: 'warten auf Bestätigung'
    })
    expect(soldOf(' 143 ')).toBe(143)
    expect(soldOf('ausverkauft')).toBeNull()
    expect(utilizationPercent(143, 200)).toBe(72)
    expect(utilizationPercent(143, null)).toBeNull()
    expect(utilizationPercent(5, 0)).toBeNull()
  })
})

/** A band with its company, a club and a show there */
function seedShow(date: string, venueName = 'Halle Probe', tour = 'Herbst 2027') {
  const owner = db
    .insert(schema.company)
    .values({ name: `Firma ${date}` })
    .returning()
    .get()
  const band = db
    .insert(schema.band)
    .values({ name: `Band ${date}`, company_id: owner.id })
    .returning()
    .get()
  const address = db.insert(schema.address).values({ city: 'Köln' }).returning().get()
  const venue = db
    .insert(schema.venue)
    .values({ name: venueName, kind: 'venue', address_id: address.id })
    .returning()
    .get()
  const event = db
    .insert(schema.deal_memo)
    .values({ band_id: band.id, date, name: `Show ${date}`, venue_id: venue.id, tour })
    .returning()
    .get()
  return { band, venue, event }
}

function seedPerson(firstName: string, email: string) {
  const contact = db.insert(schema.contact).values({ email }).returning().get()
  return db
    .insert(schema.person)
    .values({ first_name: firstName, last_name: 'Probe', contact_id: contact.id })
    .returning()
    .get()
}

describe('advancing service', () => {
  it('keeps the stage, the contact on site, the quota and the reports of a show', () => {
    const service = container.resolve(AdvancingService)
    const { event } = seedShow('2027-11-05')
    const jo = seedPerson('Jo', 'jo@example.org')

    const empty = service.get(event.id)
    expect(empty).toMatchObject({ status: 'open', localContact: null, quota: null, sold: null })

    service.saveAdvancing({
      eventId: event.id,
      status: 'contacted',
      statusDate: '2027-10-05',
      localContactId: jo.id,
      notes: ' Load-in 16 Uhr '
    })
    service.saveQuota({ eventId: event.id, quota: 200, quotaNote: '' })
    service.saveReport({ eventId: event.id, reportDate: '2027-10-01', sold: 80, note: '' })
    service.saveReport({ eventId: event.id, reportDate: '2027-10-08', sold: 120, note: '' })
    // a second report the same day replaces the first
    const show = service.saveReport({
      eventId: event.id,
      reportDate: '2027-10-08',
      sold: 143,
      note: 'inkl. Gästeliste'
    })

    expect(show).toMatchObject({
      status: 'contacted',
      statusDate: '2027-10-05',
      localContact: { id: jo.id, name: 'Jo Probe', email: 'jo@example.org' },
      notes: 'Load-in 16 Uhr',
      quota: 200,
      sold: 143,
      utilization: 72
    })
    expect(show.reports.map((report) => [report.reportDate, report.sold])).toEqual([
      ['2027-10-08', 143],
      ['2027-10-01', 80]
    ])

    service.deleteReport(show.reports[0].id)
    expect(service.get(event.id).sold).toBe(80)
  })

  it('suggests the contact on site of the last show at the same club', () => {
    const service = container.resolve(AdvancingService)
    const first = seedShow('2027-03-01', 'Club Wiederkehr')
    const later = db
      .insert(schema.deal_memo)
      .values({
        band_id: first.band.id,
        date: '2027-12-01',
        name: 'Wieder da',
        venue_id: first.venue.id
      })
      .returning()
      .get()
    const kim = seedPerson('Kim', 'kim@example.org')
    service.saveAdvancing({
      eventId: first.event.id,
      status: 'done',
      statusDate: null,
      localContactId: kim.id,
      notes: ''
    })
    expect(service.get(later.id).suggestedContact).toMatchObject({ id: kim.id, name: 'Kim Probe' })
  })

  it('lists a tour with advancing and sales, the change since the report before', () => {
    const service = container.resolve(AdvancingService)
    const { event, band } = seedShow('2027-06-01', 'Halle Tour', 'Sommer 2027')
    service.saveQuota({ eventId: event.id, quota: 300, quotaNote: '' })
    service.saveReport({ eventId: event.id, reportDate: '2027-05-01', sold: 100, note: '' })
    service.saveReport({ eventId: event.id, reportDate: '2027-05-08', sold: 160, note: '' })
    const [show] = service.tour({ tour: 'Sommer 2027', bandId: band.id })
    expect(show).toMatchObject({
      venueName: 'Halle Tour',
      city: 'Köln',
      quota: 300,
      sold: 160,
      previousSold: 100,
      utilization: 53,
      status: 'open'
    })
    expect(service.tour({ tour: 'Andere Tour', bandId: null })).toEqual([])
  })

  it('removes advancing and reports with the event', () => {
    const service = container.resolve(AdvancingService)
    const { event } = seedShow('2027-07-01')
    service.saveQuota({ eventId: event.id, quota: 50, quotaNote: '' })
    service.saveReport({ eventId: event.id, reportDate: '2027-06-01', sold: 10, note: '' })
    db.delete(schema.deal_memo).where(eq(schema.deal_memo.id, event.id)).run()
    expect(
      db
        .select()
        .from(schema.ticket_report)
        .where(eq(schema.ticket_report.deal_memo_id, event.id))
        .all()
    ).toEqual([])
  })
})

describe('tour import of the advancing and ticket sheets', () => {
  const request = (band: string, headers: string[], rows: string[][]): TourImportRequest => ({
    fileName: 'Tour.xlsx',
    headers,
    rows: rows.map((cells, index) => ({ rowNumber: index + 3, cells })),
    mapping: detectTourMapping(
      headers,
      rows.map((cells) => ({ cells }))
    ),
    band,
    tour: 'Herbst 2027',
    defaultKind: 'venue',
    defaultStatus: 'confirmed',
    createVenues: true
  })

  it('fills stage, contact on site, quota and sales; a second run changes nothing', () => {
    const service = container.resolve(TourImportService)
    const advancing = container.resolve(AdvancingService)
    const owner = db.insert(schema.company).values({ name: 'Tourband GbR' }).returning().get()
    const band = db
      .insert(schema.band)
      .values({ name: 'Tourband', company_id: owner.id })
      .returning()
      .get()

    // The contacts sheet makes the events
    service.commit(
      request(
        band.name,
        ['Datum', 'Stadt', 'Club'],
        [
          ['29.10.2027', 'Lindau', 'Club Beispiel'],
          ['30.10.2027', 'Köln', 'Halle Probe']
        ]
      )
    )

    // Advancing: the e-mail under "Promoter Contact", the contact on site and its stage
    const advancingSheet = request(
      band.name,
      [
        'Datum',
        'City',
        'Location',
        'Promoter Contact',
        'Kontakt vor Ort',
        'Kontakt Email',
        'Status'
      ],
      [
        [
          '29.10.2027',
          'Lindau',
          'Club Beispiel',
          'lp@example.com',
          '',
          '',
          'angeschrieben am 05.10.'
        ],
        [
          '30.10.2027',
          'Köln',
          'Halle Probe',
          'eva@example.com',
          'Jo Vorort',
          'vorort@example.org',
          'im Austausch'
        ]
      ]
    )
    expect(advancingSheet.mapping).toEqual([
      'date',
      'city',
      'venueName',
      'promoterEmail',
      'localContact',
      'localContactEmail',
      'advancingStatus'
    ])
    const plan = service.preview(advancingSheet)
    expect(plan.rows.map((row) => row.details)).toEqual([
      'Angeschrieben',
      'Im Austausch · vor Ort: Jo Vorort'
    ])
    expect(service.commit(advancingSheet)).toMatchObject({ updated: 2, contactsCreated: 1 })

    // Ticketkontingent with a weekday column, sales reported today
    const quotaSheet = request(
      band.name,
      ['Tag', 'Datum', 'City', 'Club', 'Anfangsbestand', 'verkauft'],
      [
        ['FR', '29.10.2027', 'Lindau', 'Club Beispiel', '200', '120'],
        ['SA', '30.10.2027', 'Köln', 'Halle Probe', 'warten auf Bestätigung', '']
      ]
    )
    expect(service.commit(quotaSheet)).toMatchObject({ updated: 2 })

    const shows = advancing.tour({ tour: 'Herbst 2027', bandId: band.id })
    expect(
      shows.map((show) => [show.city, show.status, show.statusDate, show.localContact?.name ?? ''])
    ).toEqual([
      ['Lindau', 'contacted', '2027-10-05', ''],
      ['Köln', 'in_progress', null, 'Jo Vorort']
    ])
    expect(shows.map((show) => [show.quota, show.quotaNote, show.sold])).toEqual([
      [200, '', 120],
      [null, 'warten auf Bestätigung', null]
    ])

    // the same sheets again change nothing
    expect(service.preview(advancingSheet).counts).toMatchObject({ update: 0, unchanged: 2 })
    expect(service.preview(quotaSheet).counts).toMatchObject({ update: 0, unchanged: 2 })
  })

  it('skips a row whose club stands in another city on that date', () => {
    const { band } = seedShow('2027-10-31', 'Musikcafe Probe')
    const existing = container.resolve(TourImportRepository).loadForImport()
    const plan = buildTourImportPlan(
      request(band.name, ['Datum', 'City', 'Club'], [['31.10.2027', 'Lindau', 'Club Beispiel']]),
      existing
    )
    expect(plan.preview.rows[0]).toMatchObject({
      action: 'skipped',
      reason: 'Club weicht ab: am 31.10.2027 ist Musikcafe Probe, Köln eingetragen'
    })
  })
})
