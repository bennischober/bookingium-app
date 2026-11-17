// Tour import (Tourdaten): an Excel or CSV tour sheet becomes own events. The .xlsx reader turns
// the first sheet into rows (dates, zero-padded postcodes, shared strings); the planner matches
// bands, venues and existing events (band + date); the service writes it, creates unknown clubs,
// remembers the columns, and a second run of the same sheet changes nothing.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { excelSerialToDate, readXlsx } from '../src/main/import/xlsx'
import { readImportFile } from '../src/main/import/readImportFile'
import {
  buildTourImportPlan,
  detectTourMapping,
  parseAmountCents,
  parseEventStatus,
  parseShowTime,
  type TourImportExisting
} from '../src/main/import/tourDates'
import { TourImportService, tourImportKey } from '../src/main/services/TourImportService'
import type { TourImportRequest } from '../src/main/api/schemas/tour_import.schema'
import { buildXlsx } from './helpers/xlsx'
import { setupTestDb } from './helpers/setup'

setupTestDb()

describe('xlsx reader', () => {
  it('reads the first sheet: strings, numbers, dates and zero-padded postcodes', () => {
    const file = buildXlsx(
      [
        ['Datum', 'Band', 'Club', 'PLZ', 'Ort', 'Gage', 'km'],
        [{ date: 46479 }, 'Pretty Wild', 'Club Volta', { zip: 1067 }, 'Dresden', 1500.5, 100],
        [null, 'Pretty Wild', 'Ohne Datum']
      ],
      'Tour 2027'
    )
    const { sheetName, records } = readXlsx(file)
    expect(sheetName).toBe('Tour 2027')
    expect(records[0]).toEqual(['Datum', 'Band', 'Club', 'PLZ', 'Ort', 'Gage', 'km'])
    expect(records[1]).toEqual([
      excelSerialToDate(46479),
      'Pretty Wild',
      'Club Volta',
      '01067',
      'Dresden',
      '1500,5',
      '100'
    ])
    // a missing cell keeps the columns in place
    expect(records[2]).toEqual(['', 'Pretty Wild', 'Ohne Datum'])
  })

  it('converts Excel date serials, including the 1900 leap-year quirk', () => {
    expect(excelSerialToDate(1)).toBe('01.01.1900')
    expect(excelSerialToDate(61)).toBe('01.03.1900')
    expect(excelSerialToDate(46023)).toBe('01.01.2026')
  })

  it('is read by the import like a CSV file', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'tour-xlsx-'))
    const path = join(folder, 'Tour Frühjahr.xlsx')
    writeFileSync(
      path,
      buildXlsx([
        ['Datum', 'Band'],
        [{ date: 46479 }, 'Pretty Wild']
      ])
    )
    const { fileName, table } = await readImportFile(path)
    expect(fileName).toBe('Tour Frühjahr.xlsx')
    expect(table?.headers).toEqual(['Datum', 'Band'])
    expect(table?.rows[0]).toEqual({
      rowNumber: 2,
      cells: [excelSerialToDate(46479), 'Pretty Wild']
    })
  })

  it('refuses a file that is no workbook', () => {
    expect(() => readXlsx(Buffer.from('Datum;Band\n'))).toThrow('keine Excel-Datei')
  })
})

describe('tour sheet cells', () => {
  it('detects the columns of a typical tour sheet', () => {
    expect(
      detectTourMapping([
        'Datum',
        'Künstler',
        'Location',
        'PLZ',
        'Stadt',
        'Status',
        'Gage',
        'VVK',
        'Gebietsschutz',
        'Wochen davor',
        'Wochen danach',
        'Tour',
        'Bemerkung',
        'Sonstiges'
      ])
    ).toEqual([
      'date',
      'band',
      'venueName',
      'zipCode',
      'city',
      'status',
      'guarantee',
      'ticketPriceVvk',
      'radiusKm',
      'radiusWeeksBefore',
      'radiusWeeksAfter',
      'tour',
      'notes',
      'ignore'
    ])
  })

  it('reads amounts, statuses and show times the way sheets write them', () => {
    expect(parseAmountCents('1.500 €')).toBe(150000)
    expect(parseAmountCents('1500,50')).toBe(150050)
    expect(parseAmountCents('1,500.50')).toBe(150050)
    expect(parseAmountCents('800,-')).toBe(80000)
    expect(parseAmountCents('nach Absprache')).toBeNull()
    expect(parseEventStatus('Option bis 1.3.', 'confirmed')).toBe('pending')
    expect(parseEventStatus('fix', 'pending')).toBe('confirmed')
    expect(parseEventStatus('abgesagt', 'confirmed')).toBe('cancelled')
    expect(parseEventStatus('', 'pending')).toBe('pending')
    expect(parseShowTime('20.30 Uhr')).toBe('20:30')
    expect(parseShowTime('nach Support')).toBe('nach Support')
  })
})

const HEADERS = ['Datum', 'Band', 'Club', 'Ort', 'Status', 'Gage', 'km']
const MAPPING = detectTourMapping(HEADERS)

function request(rows: string[][], extra: Partial<TourImportRequest> = {}): TourImportRequest {
  return {
    fileName: 'tour.xlsx',
    headers: HEADERS,
    rows: rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
    mapping: MAPPING,
    tour: 'Frühjahr 2027',
    defaultKind: 'venue',
    defaultStatus: 'confirmed',
    createVenues: true,
    ...extra
  }
}

describe('tour import plan', () => {
  const existing: TourImportExisting = {
    bands: [{ id: 1, name: 'Pretty Wild' }],
    venues: [
      { id: 10, name: 'Club Volta', kind: 'venue', city: 'Köln' },
      { id: 11, name: 'Club Volta', kind: 'venue', city: 'Dresden' }
    ],
    events: [
      {
        id: 100,
        band_id: 1,
        date: '2027-03-12',
        name: 'Pretty Wild – Club Volta',
        venue_id: 10,
        status: 'pending',
        tour: '',
        deal: '',
        guarantee_cents: null,
        ticket_price_vvk_cents: null,
        ticket_price_ak_cents: null,
        performance_time: null,
        radius_km: null,
        radius_weeks_before: null,
        radius_weeks_after: null,
        notes: ''
      }
    ]
  }

  it('updates the event of the same band and date, creates the rest and unknown clubs once', () => {
    const plan = buildTourImportPlan(
      request([
        ['12.03.2027', 'Pretty Wild', 'Club Volta', 'Köln', 'fix', '1.500 €', '80'],
        ['13.03.2027', 'pretty wild', 'Club Volta', 'Dresden', '', '', ''],
        ['14.03.2027', 'Pretty Wild', 'Kantine', 'Berlin', 'Option', '', ''],
        ['15.03.2027', 'Pretty Wild', 'Kantine', 'Berlin', '', '', ''],
        ['16.03.2027', 'Unbekannte Band', 'Kantine', 'Berlin', '', '', ''],
        ['kein Datum', 'Pretty Wild', 'Kantine', 'Berlin', '', '', ''],
        ['12.03.2027', 'Pretty Wild', 'Doppelt', 'Köln', '', '', '']
      ]),
      existing
    )
    expect(plan.preview.errors).toEqual([])
    expect(plan.preview.counts).toEqual({
      new: 3,
      update: 1,
      unchanged: 0,
      skipped: 3,
      newVenues: 1
    })
    expect(plan.update).toEqual([
      {
        id: 100,
        venue: null,
        fields: {
          status: 'confirmed',
          guarantee_cents: 150000,
          radius_km: 80,
          tour: 'Frühjahr 2027'
        }
      }
    ])
    // the second Club Volta is the one in Dresden; Kantine is new, created once for both rows
    expect(plan.create[0].venue).toEqual({ id: 11 })
    expect(plan.create[1].venue).toEqual({ key: 'kantine|berlin' })
    expect(plan.create[2].venue).toEqual({ key: 'kantine|berlin' })
    expect(plan.create[1].fields).toMatchObject({
      name: 'Pretty Wild – Kantine',
      status: 'pending',
      tour: 'Frühjahr 2027'
    })
    expect(plan.venues).toEqual([
      expect.objectContaining({ name: 'Kantine', city: 'Berlin', kind: 'venue' })
    ])
    expect(
      plan.preview.rows.filter((row) => row.action === 'skipped').map((row) => row.reason)
    ).toEqual([
      'Band ist nicht angelegt',
      'Kein gültiges Datum',
      'Doppelt in der Datei (wie Zeile 2)'
    ])
  })

  it('without creating venues keeps the place in the notes', () => {
    const plan = buildTourImportPlan(
      request([['14.03.2027', 'Pretty Wild', 'Kantine', 'Berlin', '', '', '']], {
        createVenues: false
      }),
      existing
    )
    expect(plan.venues).toEqual([])
    expect(plan.create[0].venue).toBeNull()
    expect(plan.create[0].fields.notes).toBe('Kantine, Berlin')
  })

  it('needs a band and a date column', () => {
    const plan = buildTourImportPlan(
      request([], { mapping: MAPPING.map((field) => (field === 'date' ? 'ignore' : field)) }),
      existing
    )
    expect(plan.preview.errors).toEqual(['Keine Spalte ist dem Datum zugeordnet.'])
  })
})

describe('tour import service', () => {
  it('writes events and clubs, remembers the columns, and a second run changes nothing', () => {
    const company = db.insert(schema.company).values({ name: 'Agentur' }).returning().get()
    const band = db
      .insert(schema.band)
      .values({ name: 'Tour Band', company_id: company.id })
      .returning()
      .get()
    const service = container.resolve(TourImportService)
    const sheet = request([
      ['01.05.2027', 'Tour Band', 'Halle Nord', 'Hamburg', '', '900', '120'],
      ['02.05.2027', 'Tour Band', 'Halle Süd', 'München', 'Option', '', '']
    ])

    const first = service.commit(sheet)
    expect(first).toMatchObject({ created: 2, updated: 0, venuesCreated: 2 })
    const events = db
      .select()
      .from(schema.deal_memo)
      .where(eq(schema.deal_memo.band_id, band.id))
      .all()
      .sort((a, b) => a.date.localeCompare(b.date))
    expect(
      events.map((e) => [e.date, e.name, e.status, e.tour, e.guarantee_cents, e.radius_km])
    ).toEqual([
      ['2027-05-01', 'Tour Band – Halle Nord', 'confirmed', 'Frühjahr 2027', 90000, 120],
      ['2027-05-02', 'Tour Band – Halle Süd', 'pending', 'Frühjahr 2027', null, null]
    ])
    const venue = db
      .select()
      .from(schema.venue)
      .where(eq(schema.venue.id, events[0].venue_id!))
      .get()
    expect(venue?.name).toBe('Halle Nord')

    const again = service.commit(sheet)
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2, venuesCreated: 0 })

    const remembered = service.suggest(HEADERS)
    expect(remembered).toMatchObject({ remembered: true, tour: 'Frühjahr 2027' })
    expect(tourImportKey(HEADERS)).toMatch(/^tourImport:/)
    expect(service.tours()).toContain('Frühjahr 2027')
  })
})
