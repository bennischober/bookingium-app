// Agenturbuchungen (#103): shows of the user's bands another agency booked. The export's
// cells read as dates, statuses and kinds; one file plans new, changed, unchanged and
// skipped bookings against the stored ones; the import writes them per agency; and the map
// takes them as read-only shows whose radius clause binds the band like an own event.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import {
  buildAgencyImportPlan,
  detectAgencyMapping,
  parseBookingKind,
  parseBookingStatus,
  parseShowDate,
  type StoredAgencyBooking
} from '../src/main/import/agencyBookings'
import {
  ExternalBookingService,
  agencyImportKey
} from '../src/main/services/ExternalBookingService'
import { ExternalBookingRepository } from '../src/main/repositories/ExternalBookingRepository'
import { buildMapData, type MapEventRow, type MapVenueRow } from '../src/main/map/markers'
import {
  blockHtml,
  markerColor,
  markerHref,
  MARKER_COLORS,
  pointPopupHtml,
  groupByPoint,
  showDotColor
} from '../src/renderer/src/components/map/mapDisplay'
import type { ExternalBookingImportRequest } from '../src/main/api/schemas/external_booking.schema'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const HEADERS = ['Nr', 'Künstler', 'Datum', 'Spielstätte', 'PLZ', 'Ort', 'Status', 'Bemerkung']

const request = (
  rows: string[][],
  parts: Partial<ExternalBookingImportRequest> = {}
): ExternalBookingImportRequest => ({
  fileName: 'agentur.csv',
  agency: 'Beispiel Agentur',
  headers: HEADERS,
  rows: rows.map((cells, index) => ({ rowNumber: index + 2, cells })),
  mapping: detectAgencyMapping(parts.headers ?? HEADERS),
  defaultKind: 'venue',
  removeMissing: false,
  ...parts
})

const stored = (parts: Partial<StoredAgencyBooking> = {}): StoredAgencyBooking => ({
  id: 1,
  band_id: 1,
  band_name: 'Die Testband',
  date: '2027-03-12',
  kind: 'venue',
  status: 'confirmed',
  venue_name: 'Club Muster',
  street: '',
  zip_code: '10115',
  city: 'Berlin',
  country: '',
  notes: '',
  source_key: 'id:A1',
  ...parts
})

const BANDS = [
  { id: 1, name: 'Die Testband' },
  { id: 2, name: 'Zweite Band' }
]

describe('cell parsing', () => {
  it('reads German, ISO and slashed dates, with a weekday or time around them', () => {
    expect(parseShowDate('12.03.2027')).toBe('2027-03-12')
    expect(parseShowDate('12.3.27')).toBe('2027-03-12')
    expect(parseShowDate('2027-03-12')).toBe('2027-03-12')
    expect(parseShowDate('12/03/2027')).toBe('2027-03-12')
    expect(parseShowDate('Fr, 12.03.2027')).toBe('2027-03-12')
    expect(parseShowDate('12.03.2027 20:00')).toBe('2027-03-12')
  })

  it('rejects what is no date', () => {
    expect(parseShowDate('')).toBe('')
    expect(parseShowDate('demnächst')).toBe('')
    expect(parseShowDate('31.02.2027')).toBe('')
    expect(parseShowDate('2027-13-01')).toBe('')
  })

  it('reads cancelled and option wording; anything else counts as confirmed', () => {
    expect(parseBookingStatus('abgesagt')).toBe('cancelled')
    expect(parseBookingStatus('Storniert')).toBe('cancelled')
    expect(parseBookingStatus('1. Option')).toBe('pending')
    expect(parseBookingStatus('Option bis 12.3.')).toBe('pending')
    expect(parseBookingStatus('unbestätigt')).toBe('pending')
    expect(parseBookingStatus('fix')).toBe('confirmed')
    expect(parseBookingStatus('bestätigt')).toBe('confirmed')
    expect(parseBookingStatus('')).toBe('confirmed')
    expect(parseBookingStatus('irgendwas')).toBe('confirmed')
  })

  it('reads club or festival, else the default', () => {
    expect(parseBookingKind('Festival', 'venue')).toBe('festival')
    expect(parseBookingKind('Open Air', 'venue')).toBe('festival')
    expect(parseBookingKind('Club', 'festival')).toBe('venue')
    expect(parseBookingKind('', 'festival')).toBe('festival')
    expect(parseBookingKind('Sonstiges', 'venue')).toBe('venue')
  })

  it('detects the columns by their headers; notes may take several', () => {
    expect(detectAgencyMapping(HEADERS)).toEqual([
      'sourceKey',
      'band',
      'date',
      'venueName',
      'zipCode',
      'city',
      'status',
      'notes'
    ])
    expect(
      detectAgencyMapping(['Band', 'Datum', 'Datum', 'Notiz', 'Veranstalter', 'Gage'])
    ).toEqual(['band', 'date', 'ignore', 'notes', 'notes', 'ignore'])
  })
})

describe('import plan', () => {
  it('plans new, changed, unchanged and skipped rows by source key', () => {
    const plan = buildAgencyImportPlan(
      request([
        ['A1', 'Die Testband', '12.03.2027', 'Club Muster', '10115', 'Berlin', 'fix', ''],
        ['A2', 'Die Testband', '13.03.2027', 'Beispielhalle', '20095', 'Hamburg', 'Option', ''],
        ['A3', 'die testband', '14.03.2027', 'Club Muster', '80331', 'München', '', 'Support'],
        ['A4', 'Unbekannte Band', '15.03.2027', 'Club Muster', '10115', 'Berlin', '', ''],
        ['A5', 'Die Testband', 'bald', 'Club Muster', '10115', 'Berlin', '', ''],
        ['A2', 'Die Testband', '13.03.2027', 'Beispielhalle', '20095', 'Hamburg', '', ''],
        ['', '', '', '', '', '', '', '']
      ]),
      {
        bands: BANDS,
        bookings: [
          stored(),
          stored({ id: 2, source_key: 'id:A2', date: '2027-03-13', status: 'confirmed' }),
          stored({ id: 3, source_key: 'id:GONE', date: '2027-04-01' })
        ]
      }
    )
    expect(plan.preview.rows.map((row) => [row.rowNumber, row.action, row.reason])).toEqual([
      [2, 'unchanged', undefined],
      [3, 'update', undefined],
      [4, 'new', undefined],
      [5, 'skipped', 'Band ist nicht angelegt'],
      [6, 'skipped', 'Kein gültiges Datum'],
      [7, 'skipped', 'Doppelt in der Datei (wie Zeile 3)']
    ])
    expect(plan.preview.counts).toEqual({
      new: 1,
      update: 1,
      unchanged: 1,
      skipped: 3,
      missing: 1
    })
    expect(plan.unchanged).toEqual([1])
    expect(plan.update).toMatchObject([{ id: 2, fields: { status: 'pending', city: 'Hamburg' } }])
    // The band's stored spelling, the note with its header
    expect(plan.create).toMatchObject([
      { band_id: 1, date: '2027-03-14', notes: 'Bemerkung: Support', source_key: 'id:A3' }
    ])
    expect(plan.preview.rows[2].bandName).toBe('Die Testband')
    expect(plan.preview.missing.map((booking) => booking.id)).toEqual([3])
    // Missing bookings stay unless the request removes them
    expect(plan.remove).toEqual([])
  })

  it('removes the missing ones only when asked', () => {
    const plan = buildAgencyImportPlan(request([], { removeMissing: true }), {
      bands: BANDS,
      bookings: [stored()]
    })
    expect(plan.remove).toEqual([1])
  })

  it('never counts a skipped row of a stored booking as missing', () => {
    const plan = buildAgencyImportPlan(
      request([['A1', 'Die Testband', 'bald', 'Club Muster', '10115', 'Berlin', '', '']]),
      { bands: BANDS, bookings: [stored()] }
    )
    expect(plan.preview.counts.skipped).toBe(1)
    expect(plan.preview.missing).toEqual([])
  })

  it('keys a row without an ID column by band, date and place, and splits "PLZ Ort"', () => {
    const headers = ['Band', 'Datum', 'Ort', 'Land']
    const plan = buildAgencyImportPlan(
      request([['Die Testband', '12.03.2027', '6020 Innsbruck', 'Österreich']], { headers }),
      { bands: BANDS, bookings: [] }
    )
    expect(plan.create).toMatchObject([
      {
        zip_code: '6020',
        city: 'Innsbruck',
        country: 'AT',
        source_key: 'auto:die testband|2027-03-12|innsbruck'
      }
    ])
  })

  it('refuses a mapping without band or date', () => {
    const plan = buildAgencyImportPlan(
      request([['A1', 'Die Testband']], {
        headers: ['Nr', 'Künstler'],
        mapping: ['sourceKey', 'ignore']
      }),
      { bands: BANDS, bookings: [stored()] }
    )
    expect(plan.preview.errors).toEqual([
      'Keine Spalte ist der Band zugeordnet.',
      'Keine Spalte ist dem Datum zugeordnet.'
    ])
    expect(plan.create).toEqual([])
    expect(plan.preview.missing).toEqual([])
  })
})

describe('import into the database', () => {
  const service = () => container.resolve(ExternalBookingService)
  const repository = () => container.resolve(ExternalBookingRepository)
  let bandId = 0

  it('writes an agency file, then updates it by source key', () => {
    const company = db.insert(schema.company).values({ name: 'Band GbR' }).returning().get()
    bandId = db
      .insert(schema.band)
      .values({ name: 'Die Testband', company_id: company.id })
      .returning()
      .get().id

    const first = service().commit(
      request([
        ['A1', 'Die Testband', '12.03.2027', 'Club Muster', '10115', 'Berlin', 'fix', ''],
        ['A2', 'Die Testband', '20.03.2027', 'Beispielhalle', '20095', 'Hamburg', 'Option', ''],
        ['A3', 'Die Testband', '25.03.2027', 'Club Muster', '80331', 'München', 'abgesagt', '']
      ])
    )
    expect(first).toEqual({ created: 3, updated: 0, unchanged: 0, skipped: 0, removed: 0 })

    const rows = db
      .select()
      .from(schema.external_booking)
      .where(eq(schema.external_booking.agency, 'Beispiel Agentur'))
      .all()
    expect(rows.map((row) => [row.source_key, row.status, row.band_id])).toEqual([
      ['id:A1', 'confirmed', bandId],
      ['id:A2', 'pending', bandId],
      ['id:A3', 'cancelled', bandId]
    ])
    expect(rows[0].source_file).toBe('agentur.csv')

    // The next export: A2 confirmed now, A3 gone - removed on request
    const second = service().commit(
      request(
        [
          ['A1', 'Die Testband', '12.03.2027', 'Club Muster', '10115', 'Berlin', 'fix', ''],
          ['A2', 'Die Testband', '20.03.2027', 'Beispielhalle', '20095', 'Hamburg', 'fix', '']
        ],
        { removeMissing: true, fileName: 'agentur-2.csv' }
      )
    )
    expect(second).toEqual({ created: 0, updated: 1, unchanged: 1, skipped: 0, removed: 1 })
    const after = db.select().from(schema.external_booking).all()
    expect(after.map((row) => [row.source_key, row.status, row.source_file])).toEqual([
      ['id:A1', 'confirmed', 'agentur-2.csv'],
      ['id:A2', 'confirmed', 'agentur-2.csv']
    ])
  })

  it('keeps agencies apart: the same key of another agency is its own booking', () => {
    const result = service().commit(
      request([['A1', 'Die Testband', '01.05.2027', 'Club Muster', '10115', 'Berlin', '', '']], {
        agency: 'Andere Agentur'
      })
    )
    expect(result.created).toBe(1)
    expect(service().agencies()).toEqual([
      { agency: 'Andere Agentur', count: 1 },
      { agency: 'Beispiel Agentur', count: 2 }
    ])
  })

  it('remembers the columns and agency for the same export layout', () => {
    expect(service().suggest(HEADERS)).toMatchObject({
      agency: 'Andere Agentur',
      remembered: true,
      mapping: detectAgencyMapping(HEADERS)
    })
    expect(agencyImportKey(HEADERS)).toBe(agencyImportKey(HEADERS.map((h) => h.toUpperCase())))
    expect(service().suggest(['Band', 'Datum'])).toMatchObject({ remembered: false, agency: '' })
  })

  it('lists a band day and a range; cancelled bookings only in the range', () => {
    service().commit(
      request(
        [['B1', 'Die Testband', '02.06.2027', 'Club Muster', '10115', 'Berlin', 'abgesagt', '']],
        {
          agency: 'Dritte Agentur'
        }
      )
    )
    expect(service().listForBand(bandId, '2027-03-12', '2027-03-12')).toMatchObject([
      { bandName: 'Die Testband', venueName: 'Club Muster', agency: 'Beispiel Agentur' }
    ])
    expect(service().listForBand(bandId, '2027-06-02', '2027-06-02')).toEqual([])
    expect(service().listBetween('2027-06-01', '2027-06-30')).toMatchObject([
      { status: 'cancelled' }
    ])
    expect(
      repository()
        .listActive()
        .every((row) => row.status !== 'cancelled')
    ).toBe(true)
  })

  it('removes one booking, or all of an agency', () => {
    const [one] = service().listBetween('2027-05-01', '2027-05-01')
    service().delete(one.id)
    expect(() => service().delete(one.id)).toThrow('Agenturbuchung nicht gefunden')
    expect(service().deleteAgency('Beispiel Agentur')).toBe(2)
    expect(service().agencies()).toEqual([{ agency: 'Dritte Agentur', count: 1 }])
  })

  it('goes with its band', () => {
    db.delete(schema.band).where(eq(schema.band.id, bandId)).run()
    expect(db.select().from(schema.external_booking).all()).toEqual([])
  })
})

describe('agency bookings on the map', () => {
  // Berlin 10115 and Potsdam 14467 are ~26 km apart
  const address = (zip: string): NonNullable<MapEventRow['address']> => ({
    street: 'Musterstraße',
    street_number: '1',
    zip_code: zip,
    city: 'Berlin',
    country: 'DE',
    country_code: 'DE'
  })
  const agencyShow = (parts: Partial<MapEventRow> = {}): MapEventRow => ({
    id: 1,
    name: 'Die Testband – Club Muster',
    date: '2026-05-01',
    status: 'confirmed',
    band_id: 1,
    venue_id: null,
    venue_kind: 'venue',
    address: address('10115'),
    agency: 'Beispiel Agentur',
    ...parts
  })
  const potsdam: MapVenueRow = {
    id: 11,
    name: 'Club Potsdam',
    kind: 'venue',
    address: address('14467')
  }

  it('draws an agency marker that blocks the band like an own show', () => {
    const data = buildMapData([agencyShow()], [potsdam], { bandId: 1 })
    const marker = data.markers.find((entry) => entry.type === 'agency')!
    expect(marker).toMatchObject({
      id: 1,
      agency: 'Beispiel Agentur',
      located: true,
      ring: { km: 100 }
    })
    expect(data.markers.find((entry) => entry.type === 'venue')!.blockedBy).toEqual([
      {
        eventId: 1,
        name: 'Die Testband – Club Muster',
        date: '2026-05-01',
        agency: 'Beispiel Agentur'
      }
    ])
  })

  it('lists an agency booking without an address as such, not as "no venue"', () => {
    const data = buildMapData([agencyShow({ address: null })], [], {})
    expect(data.unlocated).toEqual([
      {
        type: 'agency',
        id: 1,
        kind: 'venue',
        name: 'Die Testband – Club Muster',
        reason: 'no_address'
      }
    ])
  })

  it('collides with the what-if booking and says so', () => {
    const data = buildMapData([agencyShow()], [potsdam], {
      bandId: 1,
      candidate: { venueId: 11, date: '2026-05-08' }
    })
    expect(data.candidate!.conflicts).toMatchObject([
      { eventId: 1, agency: 'Beispiel Agentur', kind: 'both' }
    ])
  })

  it('is teal, has no page and is marked in the popup', () => {
    const [marker] = buildMapData([agencyShow()], [], {}).markers
    expect(markerColor(marker)).toBe(MARKER_COLORS.agency)
    expect(markerHref(marker)).toBeNull()
    const [point] = groupByPoint([marker])
    expect(showDotColor(point)).toBe(MARKER_COLORS.agency)
    const popup = pointPopupHtml(point)
    expect(popup).toContain('Agenturbuchung (Beispiel Agentur)')
    expect(popup).not.toContain('<a href')
    expect(blockHtml({ eventId: 1, name: 'A', date: '2026-05-01', agency: 'X' })).not.toContain(
      '<a'
    )
    expect(blockHtml({ eventId: 1, name: 'A', date: '2026-05-01' })).toContain('href="#/events/1"')
  })
})
