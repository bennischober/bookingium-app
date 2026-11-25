// The calendar page's filter: only some calendars, artists or tours. The page loads every event
// of the days it shows (the paged list stopped at 100) and the tours for the tour filter.
import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { container } from 'tsyringe'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { DealMemoService } from '../src/main/services/DealMemoService'
import {
  EMPTY_CALENDAR_FILTER,
  filterAgencyBookings,
  filterEvents,
  filterSubscribed,
  isFiltered,
  parseCalendarFilter,
  showsSource,
  type CalendarFilter
} from '../src/renderer/src/components/calendar/calendarFilter'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const filter = (overrides: Partial<CalendarFilter> = {}): CalendarFilter => ({
  ...EMPTY_CALENDAR_FILTER,
  ...overrides
})

const EVENTS = [
  { id: 1, bandId: 10, tour: 'Herbsttour 2026' },
  { id: 2, bandId: 10, tour: '' },
  { id: 3, bandId: 20, tour: 'Herbsttour 2026' },
  { id: 4, bandId: 20, tour: 'Clubtour' }
]
const AGENCY = [
  { id: 1, bandId: 10 },
  { id: 2, bandId: 30 }
]
const SUBSCRIBED = [
  { key: 'a', subscriptionId: 5 },
  { key: 'b', subscriptionId: 6 }
]
const ids = (list: { id: number }[]) => list.map((entry) => entry.id)

describe('calendar filter', () => {
  it('shows everything without a filter', () => {
    const none = filter()
    expect(isFiltered(none)).toBe(false)
    expect(ids(filterEvents(EVENTS, none))).toEqual([1, 2, 3, 4])
    expect(ids(filterAgencyBookings(AGENCY, none))).toEqual([1, 2])
    expect(filterSubscribed(SUBSCRIBED, none)).toHaveLength(2)
    for (const source of ['appointments', 'followUps'] as const) {
      expect(showsSource(none, source)).toBe(true)
    }
  })

  it('only calendar xy: one subscribed calendar and nothing else', () => {
    const only = filter({ sources: ['sub:6'] })
    expect(filterSubscribed(SUBSCRIBED, only).map((entry) => entry.key)).toEqual(['b'])
    expect(filterEvents(EVENTS, only)).toEqual([])
    expect(filterAgencyBookings(AGENCY, only)).toEqual([])
    expect(showsSource(only, 'appointments')).toBe(false)
    expect(showsSource(only, 'followUps')).toBe(false)
  })

  it('only artist xy: their events and other agencies bookings of them', () => {
    const artist = filter({ bands: ['10'] })
    expect(ids(filterEvents(EVENTS, artist))).toEqual([1, 2])
    expect(ids(filterAgencyBookings(AGENCY, artist))).toEqual([1])
    // Appointments, follow-ups and subscribed calendars belong to no artist
    expect(showsSource(artist, 'appointments')).toBe(false)
    expect(filterSubscribed(SUBSCRIBED, artist)).toEqual([])
  })

  it('only tour xy: its events, of every artist; agency bookings have no tour', () => {
    const tour = filter({ tours: ['Herbsttour 2026'] })
    expect(ids(filterEvents(EVENTS, tour))).toEqual([1, 3])
    expect(filterAgencyBookings(AGENCY, tour)).toEqual([])
  })

  it('combines artist, tour and chosen calendars', () => {
    const both = filter({ bands: ['20'], tours: ['Herbsttour 2026'] })
    expect(ids(filterEvents(EVENTS, both))).toEqual([3])
    // A calendar chosen on purpose stays next to the artist's events
    const withAppointments = filter({ bands: ['10'], sources: ['events', 'appointments'] })
    expect(ids(filterEvents(EVENTS, withAppointments))).toEqual([1, 2])
    expect(showsSource(withAppointments, 'appointments')).toBe(true)
    expect(showsSource(withAppointments, 'followUps')).toBe(false)
  })

  it('reads a stored filter leniently', () => {
    expect(parseCalendarFilter(null)).toEqual(EMPTY_CALENDAR_FILTER)
    expect(parseCalendarFilter('kaputt')).toEqual(EMPTY_CALENDAR_FILTER)
    expect(parseCalendarFilter('{"bands":["10",7],"tours":"x"}')).toEqual({
      sources: [],
      bands: ['10'],
      tours: []
    })
  })
})

describe('calendar events and tours', () => {
  it('lists every event of a date range, past the 100 of the paged list', async () => {
    const company = db.insert(schema.company).values({ name: 'Kalender Firma' }).returning().get()
    const band = db
      .insert(schema.band)
      .values({ name: 'Kalender Band', company_id: company.id })
      .returning()
      .get()
    // 120 events in March, one in April, one archived in March
    for (let i = 0; i < 120; i++) {
      db.insert(schema.deal_memo)
        .values({
          name: `März ${i}`,
          band_id: band.id,
          date: `2031-03-${String((i % 31) + 1).padStart(2, '0')}`,
          tour: i % 2 === 0 ? 'Frühjahrstour' : ''
        })
        .run()
    }
    db.insert(schema.deal_memo)
      .values({ name: 'April', band_id: band.id, date: '2031-04-01', tour: 'Clubtour' })
      .run()
    db.insert(schema.deal_memo)
      .values({
        name: 'Archiviert',
        band_id: band.id,
        date: '2031-03-15',
        tour: 'Alte Tour',
        archived_at: '2031-01-01 00:00:00'
      })
      .run()

    const service = container.resolve(DealMemoService)
    const march = await service.listDealMemosBetween('2031-03-01', '2031-03-31')
    expect(march).toHaveLength(120)
    expect(march.every((event) => event.date.startsWith('2031-03'))).toBe(true)
    expect(march[0].band?.name).toBe('Kalender Band')

    const tours = await service.listTours()
    expect(tours).toEqual(expect.arrayContaining(['Alte Tour', 'Clubtour', 'Frühjahrstour']))
    expect(tours).not.toContain('')
    expect([...tours].sort((a, b) => a.localeCompare(b))).toEqual(tours)
  })
})
