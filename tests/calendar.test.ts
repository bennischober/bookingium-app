// Calendar file: iCalendar details (escaping, folding, timed vs. all-day
// events, follow-ups) and the feed file that is rewritten after changes.
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
import { FollowUpService } from '../src/main/services/FollowUpService'

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

  it('writes follow-ups as all-day reminders with their own ids', () => {
    const ics = buildCalendar([], new Date(Date.UTC(2026, 10, 6, 8, 0)), [
      {
        id: 3,
        dueDate: '2026-11-12',
        note: 'Vertrag zurück?\nSonst anrufen, Montag',
        recordName: 'München (11.06.2026)',
        updatedAt: '2026-11-05 09:00:00'
      },
      { id: 4, dueDate: 'kein Datum', note: 'Ohne Datum', recordName: null, updatedAt: null }
    ])
    const unfolded = ics.replace(/\r\n /g, '')
    expect(unfolded).toContain('UID:follow-up-3@bookingium')
    expect(unfolded).toContain('DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113')
    // First line of the note as the title, all of it (and the record) as the text
    expect(unfolded).toContain('SUMMARY:Wiedervorlage: Vertrag zurück?\r\n')
    expect(unfolded).toContain(
      'DESCRIPTION:Zu: München (11.06.2026)\\n\\nVertrag zurück?\\nSonst anrufen\\, Montag'
    )
    expect(unfolded).toContain('TRANSP:TRANSPARENT')
    expect(unfolded).toContain('LAST-MODIFIED:20261105T090000Z')
    expect(unfolded).not.toContain('follow-up-4@')
    expect(unfolded).not.toContain('UID:event-')
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

  it('takes open follow-ups only when switched on, and drops done ones', async () => {
    const path = join(dir, 'Wiedervorlagen.ics')
    const settings = container.resolve(SettingsService)
    settings.update({ calendarFeedPath: path, calendarFeedFollowUps: false })
    const feed = container.resolve(CalendarFeedService)
    const followUps = container.resolve(FollowUpService)
    const created = followUps.create({ dueDate: '2026-11-20', note: 'Rider schicken' })

    expect(await feed.update()).toMatchObject({ includeFollowUps: false, followUps: 0 })
    expect(readFileSync(path, 'utf-8')).not.toContain('Wiedervorlage:')

    settings.update({ calendarFeedFollowUps: true })
    expect(await feed.update()).toMatchObject({ includeFollowUps: true, followUps: 1 })
    expect(readFileSync(path, 'utf-8')).toContain('SUMMARY:Wiedervorlage: Rider schicken')

    // Ticking it off rewrites the file shortly after, without it
    followUps.setDone(created.id, true)
    await new Promise((resolve) => setTimeout(resolve, 2000))
    expect(readFileSync(path, 'utf-8')).not.toContain('Wiedervorlage:')
    expect(feed.status()).toMatchObject({ followUps: 0 })

    settings.update({ calendarFeedFollowUps: false })
  })
})
