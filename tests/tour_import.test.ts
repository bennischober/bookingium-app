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
import { excelSerialToDate, readXlsx, readXlsxSheets } from '../src/main/import/xlsx'
import { importTable, readImportFile } from '../src/main/import/readImportFile'
import {
  buildTourImportPlan,
  detectTourMapping,
  emailOf,
  promoterNameOf,
  tourTitleHints,
  parseAmountCents,
  parseEventStatus,
  parseShowTime,
  type TourImportExisting
} from '../src/main/import/tourDates'
import { TourImportService, tourImportKey } from '../src/main/services/TourImportService'
import type { TourImportRequest } from '../src/main/api/schemas/tour_import.schema'
import { buildXlsx, buildXlsxSheets } from './helpers/xlsx'
import { setupTestDb } from './helpers/setup'
import { SettingsRepository } from '../src/main/repositories/SettingsRepository'

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

  it('keeps quotes and markup characters in the sheet name and in text cells', () => {
    const name = `Tour "Herbst" & Rock'n'Roll <26>`
    const { sheetName, records } = readXlsx(buildXlsx([['Band'], [name]], name))
    expect(sheetName).toBe(name)
    expect(records).toEqual([['Band'], [name]])
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
    band: '',
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
      newVenues: 1,
      newPromoters: 0,
      newContacts: 0
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

// A promoter list as tours arrive: a title row naming band and tour, no header row, weekday,
// date (an Excel date), city, club, promoter, contact, e-mail (all made up)
describe('tour sheet without a header row', () => {
  const records = [
    ['Pretty Wild TOUR Herbst 2027'],
    [],
    [
      'FR',
      '29.10.2027',
      'Lindau',
      'Club Beispiel',
      'Beispiel Konzerte',
      'Florian',
      'florian@example.com'
    ],
    ['SA', '30.10.2027', 'Köln', 'Halle Probe', 'Probe GmbH', 'Lisa', 'lisa@example.com']
  ]

  it('skips the title row and names the columns when the next row is data', () => {
    const table = importTable('Promoter Kontakte', records, 'DE')!
    expect(table.title).toBe('Pretty Wild TOUR Herbst 2027')
    expect(table.headers.slice(0, 3)).toEqual(['Spalte A', 'Spalte B', 'Spalte C'])
    expect(table.rows.map((row) => row.rowNumber)).toEqual([3, 4])
  })

  it('keeps a header row below a title row', () => {
    const table = importTable(
      'Tour',
      [['Tour 2027'], ['Datum', 'Band', 'Club'], ['01.05.2027', 'X', 'Y']],
      'DE'
    )!
    expect(table).toMatchObject({ title: 'Tour 2027', headers: ['Datum', 'Band', 'Club'] })
    expect(table.rows).toHaveLength(1)
  })

  it('maps the columns by their cells: date, then city and club, the rest as notes', () => {
    const table = importTable('Promoter Kontakte', records, 'DE')!
    expect(detectTourMapping(table.headers, table.rows)).toEqual([
      'ignore',
      'date',
      'city',
      'venueName',
      'promoter',
      'promoterContact',
      'promoterEmail'
    ])
  })

  it('reads band and tour from the title', () => {
    const bands = [{ name: 'Pretty Wild' }, { name: 'Wild' }]
    expect(tourTitleHints('Pretty Wild TOUR Herbst 2027', bands)).toEqual({
      band: 'Pretty Wild',
      tour: 'Herbst 2027'
    })
    expect(tourTitleHints('Tourdaten: PRETTY WILD – Frühjahr', bands)).toEqual({
      band: 'Pretty Wild',
      tour: 'Frühjahr'
    })
    expect(tourTitleHints('Unbekannte Band Tour', bands)).toEqual({ band: '', tour: '' })
  })

  it('imports every row for the band chosen for the sheet, with promoter and contact', () => {
    const table = importTable('Promoter Kontakte', records, 'DE')!
    const plan = buildTourImportPlan(
      {
        fileName: 'promoter.xlsx',
        headers: table.headers,
        rows: table.rows,
        mapping: detectTourMapping(table.headers, table.rows),
        band: 'Pretty Wild',
        tour: 'Herbst 2027',
        defaultKind: 'venue',
        defaultStatus: 'confirmed',
        createVenues: true
      },
      { bands: [{ id: 1, name: 'Pretty Wild' }], venues: [], events: [] }
    )
    expect(plan.preview.errors).toEqual([])
    expect(plan.preview.counts).toMatchObject({ new: 2, skipped: 0, newVenues: 2 })
    // Promoter and contact are linked to the event, not written into its notes
    expect(plan.create[0].fields.notes).toBeUndefined()
    expect(plan.create[0].lopro).toEqual({
      company: { key: 'beispiel konzerte' },
      person: { key: 'florian@example.com' }
    })
    expect(plan.promoters.map((p) => p.name)).toEqual(['Beispiel Konzerte', 'Probe GmbH'])
    expect(plan.contacts[0]).toMatchObject({
      firstName: 'Florian',
      lastName: '',
      email: 'florian@example.com'
    })
    expect(plan.preview.counts).toMatchObject({ newPromoters: 2, newContacts: 2 })
    expect(plan.create[0].fields.tour).toBe('Herbst 2027')
  })

  it('asks for a band when the sheet has neither a band column nor a chosen band', () => {
    const plan = buildTourImportPlan(
      request([['01.05.2027', 'X', 'Y']], { mapping: ['date', 'ignore', 'venueName'] }),
      {
        bands: [],
        venues: [],
        events: []
      }
    )
    expect(plan.preview.errors[0]).toMatch(/Band für alle Zeilen/)
  })
})

describe('promoter and contact (LoPro)', () => {
  it('cleans e-mail addresses out of their cells', () => {
    expect(emailOf(' LP@Example.com')).toBe('lp@example.com')
    expect(emailOf('bs-extern@example.com>')).toBe('bs-extern@example.com')
    expect(emailOf('daniel@backstage.')).toBe('')
  })

  it('links known companies and creates the others once, in the database', () => {
    const service = container.resolve(TourImportService)
    const owner = db.insert(schema.company).values({ name: 'Lopro Band GbR' }).returning().get()
    const band = db
      .insert(schema.band)
      .values({ name: 'Lopro Band', company_id: owner.id })
      .returning()
      .get()
    const known = db
      .insert(schema.company)
      .values({ name: 'Bekannte Konzerte GmbH' })
      .returning()
      .get()
    const headers = ['Datum', 'Club', 'Ort', 'Veranstalter', 'Ansprechpartner', 'E-Mail']
    const rows = [
      [
        '01.09.2027',
        'Halle Eins',
        'Köln',
        'Bekannte Konzerte GmbH',
        'Eva Muster',
        'eva@example.com'
      ],
      ['02.09.2027', 'Halle Zwei', 'Bonn', 'Neue Konzerte', 'Tim', 'tim@example.com>'],
      ['03.09.2027', 'Halle Drei', 'Aachen', 'Neue Konzerte', 'Tim', 'tim@example.com']
    ]
    const sheet: TourImportRequest = {
      fileName: 'lopro.xlsx',
      headers,
      rows: rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
      mapping: detectTourMapping(headers),
      band: band.name,
      tour: '',
      defaultKind: 'venue',
      defaultStatus: 'confirmed',
      createVenues: true
    }
    expect(sheet.mapping).toEqual([
      'date',
      'venueName',
      'city',
      'promoter',
      'promoterContact',
      'promoterEmail'
    ])
    expect(service.commit(sheet)).toMatchObject({
      created: 3,
      promotersCreated: 1,
      contactsCreated: 2
    })

    const events = db
      .select()
      .from(schema.deal_memo)
      .where(eq(schema.deal_memo.band_id, band.id))
      .all()
      .sort((a, b) => a.date.localeCompare(b.date))
    expect(events[0].lopro_company_id).toBe(known.id)
    expect(events[1].lopro_company_id).toBe(events[2].lopro_company_id)
    expect(events[1].lopro_person_id).toBe(events[2].lopro_person_id)
    const tim = db
      .select()
      .from(schema.person)
      .where(eq(schema.person.id, events[1].lopro_person_id!))
      .get()
    expect(tim).toMatchObject({ first_name: 'Tim', last_name: '' })
    const member = db
      .select()
      .from(schema.company_member)
      .where(eq(schema.company_member.person_id, tim!.id))
      .get()
    expect(member).toMatchObject({ company_id: events[1].lopro_company_id, role: 'Kontakt' })

    // The next version of the sheet finds them again: nothing new
    expect(service.commit(sheet)).toMatchObject({
      created: 0,
      unchanged: 3,
      promotersCreated: 0,
      contactsCreated: 0
    })
  })
})

describe('promoter names', () => {
  it('drops the contact first name a list tacked onto the promoter', () => {
    expect(promoterNameOf('Batschkapp / Anna', 'Anna ')).toBe('Batschkapp')
    expect(promoterNameOf('Hellraiser katrin', 'Katrin')).toBe('Hellraiser')
    expect(promoterNameOf('Concertbüro Franken / Guido', 'Guido')).toBe('Concertbüro Franken')
    expect(promoterNameOf('Living Concerts', 'Erik')).toBe('Living Concerts')
    expect(promoterNameOf('Anna', 'Anna')).toBe('Anna')
  })
})

describe('a tour workbook with several lists', () => {
  // The three lists a tour file usually holds: contacts (title row, no header), advancing and
  // the ticket quota with a weekday column "Tag" next to "Datum"
  const workbook = () =>
    buildXlsxSheets([
      {
        name: 'Kontakte',
        rows: [
          ['Pretty Wild TOUR Herbst 2027'],
          [],
          [
            'FR',
            '29.10.2027',
            'Lindau',
            'Club Beispiel',
            'Beispiel Konzerte',
            'Florian',
            'florian@example.com'
          ]
        ]
      },
      {
        name: 'Advancing',
        rows: [
          [
            'Datum',
            'City',
            'Location',
            'Promoter Contact',
            null,
            'Kontakt vor Ort',
            'Kontakt Email',
            'Status'
          ],
          [],
          [
            { date: 47420 },
            'Lindau',
            'Club Beispiel',
            'florian@example.com',
            null,
            'Jo Probe',
            'jo@example.org',
            'angeschrieben am 05.10.'
          ],
          [
            { date: 47421 },
            'Köln',
            'Halle Probe',
            'lisa@example.com',
            null,
            null,
            null,
            'im Austausch'
          ]
        ]
      },
      {
        name: 'Ticketkontingent',
        rows: [
          ['Tag', 'Datum', 'City', 'Club', 'Anfangsbestand', 'update Sales'],
          [],
          ['FR', { date: 47420 }, 'Lindau', 'Club Beispiel', 200],
          ['SA', { date: 47421 }, 'Köln', 'Halle Probe', 'warten auf Bestätigung']
        ]
      }
    ])

  it('reads every sheet in tab order, following the relationships', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bookingum-sheets-'))
    const path = join(dir, 'Tour.xlsx')
    writeFileSync(path, workbook())
    const file = await readImportFile(path)
    expect(file.sheets.map((sheet) => sheet.name)).toEqual([
      'Kontakte',
      'Advancing',
      'Ticketkontingent'
    ])
    // The generic import keeps reading the first sheet
    expect(file.table?.title).toBe('Pretty Wild TOUR Herbst 2027')
    expect(file.sheets[2].table?.rows[0].cells.slice(0, 2)).toEqual([
      'FR',
      excelSerialToDate(47420)
    ])
  })

  it('never takes the weekday column "Tag" for the date', () => {
    const sheets = readXlsxSheets(workbook())
    const quota = importTable('Tour', sheets[2].records, 'DE')!
    expect(detectTourMapping(quota.headers, quota.rows)).toEqual([
      'ignore',
      'date',
      'city',
      'venueName',
      'notes',
      'ignore'
    ])
  })

  it('checks headers against the cells: e-mails, and a status that is no booking status', () => {
    const sheets = readXlsxSheets(workbook())
    const advancing = importTable('Tour', sheets[1].records, 'DE')!
    expect(detectTourMapping(advancing.headers, advancing.rows)).toEqual([
      'date',
      'city',
      'venueName',
      'promoterEmail',
      'ignore',
      'notes',
      'notes',
      'notes'
    ])
  })

  it('imports the quota sheet with the dates and the quota in the notes', () => {
    const quota = importTable('Tour', readXlsxSheets(workbook())[2].records, 'DE')!
    const plan = buildTourImportPlan(
      {
        fileName: 'Tour.xlsx',
        headers: quota.headers,
        rows: quota.rows,
        mapping: detectTourMapping(quota.headers, quota.rows),
        band: 'Pretty Wild',
        tour: 'Herbst 2027',
        defaultKind: 'venue',
        defaultStatus: 'confirmed',
        createVenues: true
      },
      { bands: [{ id: 1, name: 'Pretty Wild' }], venues: [], events: [] }
    )
    expect(plan.preview.counts).toMatchObject({ new: 2, skipped: 0 })
    expect(plan.preview.rows.map((row) => row.date)).toEqual(['2029-10-29', '2029-10-30'])
    expect(plan.create[0].fields.notes).toBe('Anfangsbestand: 200')
  })

  it('forgets a remembered mapping whose date column holds no dates', () => {
    const service = container.resolve(TourImportService)
    const headers = ['Tag', 'Datum', 'Club']
    const rows = [{ cells: ['FR', '29.10.2027', 'Club Beispiel'] }]
    container.resolve(SettingsRepository).setMany({
      [tourImportKey(headers)]: JSON.stringify({
        mapping: ['date', 'ignore', 'venueName'],
        band: '',
        tour: 'Alt',
        defaultKind: 'venue',
        defaultStatus: 'confirmed'
      })
    })
    expect(service.suggest(headers, '', rows)).toMatchObject({
      mapping: ['ignore', 'date', 'venueName'],
      remembered: false
    })
  })
})
