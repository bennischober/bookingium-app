// Calendar file: iCalendar details (escaping, folding, timed vs. all-day
// events) and the feed file that is rewritten after changes.
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import {
  buildCalendar,
  escapeText,
  foldLine,
  parseDurationMinutes,
  type CalendarEvent
} from '../src/main/calendar/ics'
import { CalendarFeedService } from '../src/main/services/CalendarFeedService'
import { SettingsService } from '../src/main/services/SettingsService'
import { DealMemoService } from '../src/main/services/DealMemoService'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const event = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 7,
  name: 'Pretty Wild – München',
  date: '2026-06-11',
  performanceTime: '21:00',
  performanceDuration: '90 Minuten',
  status: 'confirmed',
  bandName: 'Pretty Wild',
  venueName: 'Backstage',
  venueAddress: 'Reitknechtstr. 6, 80639 München',
  hotelName: null,
  deal: '60/40, Hotel',
  notes: '',
  updatedAt: '2026-05-01 10:00:00',
  ...overrides
})

describe('iCalendar', () => {
  it('escapes text and folds long lines', () => {
    expect(escapeText('Deal: 60/40; Hotel, Catering\nNotiz')).toBe(
      'Deal: 60/40\\; Hotel\\, Catering\\nNotiz'
    )
    const folded = foldLine(`DESCRIPTION:${'ä'.repeat(60)}`)
    for (const line of folded.split('\r\n')) {
      expect(Buffer.byteLength(line, 'utf-8')).toBeLessThanOrEqual(75)
    }
    expect(
      folded
        .split('\r\n')
        .slice(1)
        .every((line) => line.startsWith(' '))
    ).toBe(true)
  })

  it('reads show durations', () => {
    expect(parseDurationMinutes('90 minutes')).toBe(90)
    expect(parseDurationMinutes('75 Minuten')).toBe(75)
    expect(parseDurationMinutes('1:30')).toBe(90)
    expect(parseDurationMinutes('1,5 h')).toBe(90)
    expect(parseDurationMinutes('')).toBeNull()
  })

  it('writes timed and all-day events with status and stable ids', () => {
    const ics = buildCalendar(
      [
        event(),
        event({ id: 8, performanceTime: '', status: 'pending', name: 'Open Air' }),
        event({ id: 9, performanceTime: '23:30', performanceDuration: '', status: 'cancelled' })
      ],
      new Date(Date.UTC(2026, 4, 2, 8, 0))
    )
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('UID:event-7@bookingium')
    expect(unfolded).toContain('DTSTART:20260611T210000\r\nDTEND:20260611T223000')
    expect(unfolded).toContain('SUMMARY:Pretty Wild – München')
    expect(unfolded).toContain('LOCATION:Backstage\\, Reitknechtstr. 6\\, 80639 München')
    expect(unfolded).toContain('STATUS:CONFIRMED')
    // All-day without a show time
    expect(unfolded).toContain('DTSTART;VALUE=DATE:20260611\r\nDTEND;VALUE=DATE:20260612')
    expect(unfolded).toContain('STATUS:TENTATIVE')
    // Late show: 2 h default, ends after midnight
    expect(unfolded).toContain('DTSTART:20260611T233000\r\nDTEND:20260612T013000')
    expect(unfolded).toContain('STATUS:CANCELLED')
    expect(unfolded).toContain('LAST-MODIFIED:20260501T100000Z')
  })
})

describe('calendar file', () => {
  let dir: string

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bookingum-calendar-'))
  })

  afterAll(() => {
    container.resolve(SettingsService).update({ calendarFeedPath: '' })
    rmSync(dir, { recursive: true, force: true })
  })

  it('is written when set and rewritten shortly after an event changes', async () => {
    const company = db.insert(schema.company).values({ name: 'Band GbR' }).returning().get()
    const band = db
      .insert(schema.band)
      .values({ name: 'Pretty Wild', company_id: company.id })
      .returning()
      .get()
    const events = container.resolve(DealMemoService)
    const created = await events.createDealMemo({
      name: 'Bad Hindelang Open Air',
      date: '2026-07-04',
      bandId: band.id
    } as Parameters<DealMemoService['createDealMemo']>[0])

    const path = join(dir, 'Bookingium.ics')
    container.resolve(SettingsService).update({ calendarFeedPath: path })
    const feed = container.resolve(CalendarFeedService)
    const status = await feed.update()
    expect(status).toMatchObject({ path, events: 1, error: null })
    expect(readFileSync(path, 'utf-8')).toContain('SUMMARY:Bad Hindelang Open Air')

    await events.updateDealMemo({ id: created.id, name: 'Hindelang Open Air 2026' } as Parameters<
      DealMemoService['updateDealMemo']
    >[0])
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(readFileSync(path, 'utf-8')).toContain('SUMMARY:Hindelang Open Air 2026')
  })
})
