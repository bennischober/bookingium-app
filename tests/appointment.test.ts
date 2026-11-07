// #71: own appointments (Termine): stored with their times, listed by the days they are on,
// edited field by field, kept when their record goes, reminded once, and in the calendar file
// only when switched on.
import 'reflect-metadata'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { container } from 'tsyringe'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { eq } from 'drizzle-orm'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { AppointmentService } from '../src/main/services/AppointmentService'
import { CalendarFeedService } from '../src/main/services/CalendarFeedService'
import { SettingsService } from '../src/main/services/SettingsService'
import {
  CreateAppointmentInput,
  ListAppointmentsInput,
  UpdateAppointmentInput
} from '../src/main/api/schemas/appointment.schema'
import {
  appointmentTimesError,
  reminderLabel,
  reminderWindow
} from '../src/main/calendar/appointments'
import { buildCalendar, type CalendarAppointment } from '../src/main/calendar/ics'
import {
  checkAppointmentReminders,
  type AppointmentReminderCandidate
} from '../src/main/notifications/appointmentReminders'
import { appointmentReminderNotice, type Notice } from '../src/main/notifications/noticeText'
import {
  appointmentDays,
  appointmentsByDay,
  appointmentTimeLabel,
  reminderAfterSwitch
} from '../src/renderer/src/components/appointments/appointmentDays'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const service = () => container.resolve(AppointmentService)

const timed = {
  title: 'Telefonat Veranstalter',
  startDate: '2026-11-20',
  startTime: '14:00',
  endDate: '2026-11-20',
  endTime: '15:30'
}

const remindedAt = (id: number) =>
  db
    .select({ at: schema.appointment.reminded_at })
    .from(schema.appointment)
    .where(eq(schema.appointment.id, id))
    .get()?.at ?? null

describe('appointment times', () => {
  it('wants both times or none, and the end not before the start', () => {
    expect(appointmentTimesError(timed)).toBeNull()
    expect(appointmentTimesError({ ...timed, startTime: null, endTime: null })).toBeNull()
    expect(appointmentTimesError({ ...timed, endTime: null })).toMatch(/beide eine Uhrzeit/)
    expect(appointmentTimesError({ ...timed, endTime: '13:00' })).toMatch(/vor dem Beginn/)
    expect(appointmentTimesError({ ...timed, endDate: '2026-11-19' })).toMatch(/vor dem Beginn/)
    // Over midnight: the earlier time on the next day is fine
    expect(
      appointmentTimesError({
        ...timed,
        startTime: '22:00',
        endDate: '2026-11-21',
        endTime: '02:00'
      })
    ).toBeNull()
  })

  it('is checked by the create input', () => {
    expect(CreateAppointmentInput.safeParse(timed).success).toBe(true)
    expect(CreateAppointmentInput.safeParse({ ...timed, endTime: '13:00' }).success).toBe(false)
    expect(CreateAppointmentInput.safeParse({ ...timed, startTime: '25:00' }).success).toBe(false)
    expect(CreateAppointmentInput.safeParse({ ...timed, title: '  ' }).success).toBe(false)
    expect(CreateAppointmentInput.safeParse({ ...timed, reminderMinutes: -5 }).success).toBe(false)
    expect(ListAppointmentsInput.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success).toBe(
      false
    )
  })

  it('labels reminders, also ones the lists do not offer', () => {
    expect(reminderLabel(15, false)).toBe('15 Minuten vorher')
    expect(reminderLabel(0, true)).toBe('Am Tag um 8 Uhr')
    expect(reminderLabel(3 * 24 * 60, true)).toBe('3 Tage vorher')
    expect(reminderLabel(180, false)).toBe('3 Stunden vorher')
    expect(reminderLabel(45, false)).toBe('45 Minuten vorher')
  })
})

describe('AppointmentService', () => {
  it('stores an appointment and lists it on every day it is on', () => {
    const created = service().create(
      CreateAppointmentInput.parse({ ...timed, place: ' Büro ', reminderMinutes: 15 })
    )
    expect(created).toMatchObject({
      title: 'Telefonat Veranstalter',
      startTime: '14:00',
      endTime: '15:30',
      place: 'Büro',
      notes: '',
      reminderMinutes: 15,
      record: null
    })
    const trip = service().create(
      CreateAppointmentInput.parse({
        title: 'Messe',
        startDate: '2026-11-24',
        startTime: null,
        endDate: '2026-11-26',
        endTime: null
      })
    )

    const titles = (from: string, to: string) =>
      service()
        .listBetween(from, to)
        .map((appointment) => appointment.title)
    expect(titles('2026-11-20', '2026-11-20')).toEqual(['Telefonat Veranstalter'])
    // A several-day one shows on its middle and last day too
    expect(titles('2026-11-25', '2026-11-25')).toEqual(['Messe'])
    expect(titles('2026-11-26', '2026-11-30')).toEqual(['Messe'])
    expect(titles('2026-11-21', '2026-11-23')).toEqual([])
    expect(titles('2026-11-01', '2026-11-30')).toEqual(['Telefonat Veranstalter', 'Messe'])

    service().delete(created.id)
    service().delete(trip.id)
    expect(titles('2026-11-01', '2026-11-30')).toEqual([])
  })

  it('changes only the given fields and checks the merged times', () => {
    const created = service().create(
      CreateAppointmentInput.parse({ ...timed, notes: 'Rider klären', reminderMinutes: 30 })
    )
    const moved = service().update(
      UpdateAppointmentInput.parse({ id: created.id, startTime: '09:00', endTime: '10:00' })
    )
    expect(moved).toMatchObject({
      title: 'Telefonat Veranstalter',
      startTime: '09:00',
      endTime: '10:00',
      notes: 'Rider klären',
      reminderMinutes: 30
    })
    // Taking the reminder off is a change, not "keep"
    expect(service().update({ id: created.id, reminderMinutes: null }).reminderMinutes).toBeNull()
    // The end before the merged start is refused
    expect(() => service().update({ id: created.id, endTime: '08:00' })).toThrow(/vor dem Beginn/)
    expect(service().getById(created.id).endTime).toBe('10:00')
    service().delete(created.id)
  })

  it('shows the record it is on and keeps the appointment when the record goes', () => {
    const personId = db
      .insert(schema.person)
      .values({ first_name: 'Lea', last_name: 'Berg' })
      .returning()
      .get().id
    const created = service().create(
      CreateAppointmentInput.parse({ ...timed, record: { type: 'person', id: personId } })
    )
    expect(created.record).toEqual({ type: 'person', id: personId, name: 'Lea Berg' })

    // Editing another field keeps the link
    expect(service().update({ id: created.id, title: 'Rückruf' }).record).toMatchObject({
      id: personId
    })

    db.delete(schema.person).where(eq(schema.person.id, personId)).run()
    expect(service().getById(created.id)).toMatchObject({ title: 'Rückruf', record: null })

    service().update({ id: created.id, record: null })
    expect(service().getById(created.id).record).toBeNull()
    service().delete(created.id)
  })

  it('reminds once, and again after the time or the reminder changed', () => {
    const created = service().create(
      CreateAppointmentInput.parse({ ...timed, reminderMinutes: 15 })
    )
    expect(
      service()
        .reminderCandidates('2026-11-20', '2026-11-20')
        .map((c) => c.id)
    ).toEqual([created.id])

    service().markReminded([created.id])
    expect(remindedAt(created.id)).not.toBeNull()
    expect(service().reminderCandidates('2026-11-20', '2026-11-20')).toEqual([])

    // Notes or a title don't bring the reminder back
    service().update({ id: created.id, notes: 'Neu' })
    expect(remindedAt(created.id)).not.toBeNull()

    service().update({ id: created.id, startTime: '14:30', endTime: '15:30' })
    expect(remindedAt(created.id)).toBeNull()

    service().markReminded([created.id])
    service().update({ id: created.id, reminderMinutes: 60 })
    expect(remindedAt(created.id)).toBeNull()

    // No reminder: never a candidate
    service().update({ id: created.id, reminderMinutes: null })
    expect(service().reminderCandidates('2026-11-20', '2026-11-20')).toEqual([])
    service().delete(created.id)
  })
})

describe('appointment reminders', () => {
  it('are due from the reminder time until half an hour after the start', () => {
    const { remindAt, expiresAt } = reminderWindow(timed, 15)
    expect(remindAt).toEqual(new Date(2026, 10, 20, 13, 45))
    expect(expiresAt).toEqual(new Date(2026, 10, 20, 14, 30))
  })

  it('count from 08:00 on all-day appointments and last until the day ends', () => {
    const allDay = { startDate: '2026-11-20', startTime: null }
    expect(reminderWindow(allDay, 0)).toEqual({
      remindAt: new Date(2026, 10, 20, 8, 0),
      expiresAt: new Date(2026, 10, 21)
    })
    expect(reminderWindow(allDay, 24 * 60).remindAt).toEqual(new Date(2026, 10, 19, 8, 0))
  })

  /** A check against a fake clock; returns what it showed and marked */
  function check(
    at: Date,
    candidates: AppointmentReminderCandidate[],
    enabled = true
  ): { ids: number[]; shown: Array<{ notice: Notice; day: string }>; marked: number[] } {
    const shown: Array<{ notice: Notice; day: string }> = []
    const marked: number[] = []
    const ids = checkAppointmentReminders({
      now: () => at,
      enabled: () => enabled,
      candidates: () => candidates,
      markReminded: (list) => marked.push(...list),
      show: (notice, day) => shown.push({ notice, day })
    })
    return { ids, shown, marked }
  }

  const call = { id: 1, startDate: '2026-11-20', startTime: '14:00', reminderMinutes: 15 }
  const fair = { id: 2, startDate: '2026-11-20', startTime: null, reminderMinutes: 0 }

  it('announce the due ones together and mark them', () => {
    const result = check(new Date(2026, 10, 20, 13, 50), [call, fair])
    expect(result.ids).toEqual([1, 2])
    expect(result.marked).toEqual([1, 2])
    expect(result.shown).toHaveLength(1)
    expect(result.shown[0].day).toBe('2026-11-20')
    expect(result.shown[0].notice.title).toBe('2 Termine, der erste heute um 14:00')
  })

  it('wait before their time and skip ones whose window passed', () => {
    expect(check(new Date(2026, 10, 20, 13, 40), [call]).shown).toEqual([])
    const late = check(new Date(2026, 10, 20, 14, 31), [call])
    expect(late.shown).toEqual([])
    expect(late.marked).toEqual([])
    // Still within the grace time
    expect(check(new Date(2026, 10, 20, 14, 20), [call]).ids).toEqual([1])
  })

  it('show and mark nothing while switched off', () => {
    const off = check(new Date(2026, 10, 20, 13, 50), [call], false)
    expect(off).toEqual({ ids: [], shown: [], marked: [] })
  })

  it('say the day and time, never the title', () => {
    expect(
      appointmentReminderNotice([{ startDate: '2026-11-21', startTime: '09:30' }], '2026-11-20')
    ).toEqual({
      title: 'Termin morgen um 09:30',
      body: 'Erinnerung an einen eigenen Termin. Zum Kalender.'
    })
    expect(
      appointmentReminderNotice([{ startDate: '2026-11-27', startTime: null }], '2026-11-20').title
    ).toBe('Termin am 27.11.')
    expect(
      appointmentReminderNotice([{ startDate: '2026-11-20', startTime: null }], '2026-11-20').title
    ).toBe('Termin heute')
  })
})

describe('appointments in the calendar view', () => {
  const fair = {
    startDate: '2026-11-24',
    startTime: '10:00',
    endDate: '2026-11-26',
    endTime: '16:00'
  }

  it('are on each of their days within the range', () => {
    expect(appointmentDays(fair, '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-24',
      '2026-11-25',
      '2026-11-26'
    ])
    expect(appointmentDays(fair, '2026-11-25', '2026-11-25')).toEqual(['2026-11-25'])
    const byDay = appointmentsByDay([fair], '2026-11-25', '2026-11-30')
    expect([...byDay.keys()]).toEqual(['2026-11-25', '2026-11-26'])
  })

  it('show their time per day', () => {
    expect(appointmentTimeLabel(timed, '2026-11-20')).toBe('14:00–15:30')
    expect(appointmentTimeLabel({ ...timed, endTime: '14:00' }, '2026-11-20')).toBe('14:00')
    expect(appointmentTimeLabel({ ...fair, startTime: null, endTime: null }, '2026-11-24')).toBe(
      'Ganztägig'
    )
    expect(appointmentTimeLabel(fair, '2026-11-24')).toBe('ab 10:00')
    expect(appointmentTimeLabel(fair, '2026-11-25')).toBe('Ganztägig')
    expect(appointmentTimeLabel(fair, '2026-11-26')).toBe('bis 16:00')
  })

  it('keep a reminder across the all-day switch when the other list has it', () => {
    expect(reminderAfterSwitch(24 * 60, true)).toBe(24 * 60)
    expect(reminderAfterSwitch(15, true)).toBe(0)
    expect(reminderAfterSwitch(7 * 24 * 60, false)).toBe(15)
    expect(reminderAfterSwitch(null, true)).toBeNull()
  })
})

describe('appointments in the calendar file', () => {
  const appointment: CalendarAppointment = {
    id: 7,
    title: 'Besprechung, Tour',
    startDate: '2026-11-20',
    startTime: '14:00',
    endDate: '2026-11-20',
    endTime: '15:30',
    place: 'Büro',
    notes: 'Rider klären',
    recordName: 'Pretty Wild',
    updatedAt: '2026-11-01 10:00:00'
  }

  it('keep their wall-clock times, or are all-day across their days', () => {
    const ics = buildCalendar([], new Date('2026-11-07T10:00:00Z'), [], [appointment])
    expect(ics).toContain('UID:appointment-7@bookingium')
    expect(ics).toContain('DTSTART:20261120T140000\r\n')
    expect(ics).toContain('DTEND:20261120T153000\r\n')
    expect(ics).toContain('SUMMARY:Besprechung\\, Tour')
    expect(ics).toContain('LOCATION:Büro')
    expect(ics).toContain('DESCRIPTION:Zu: Pretty Wild\\n\\nRider klären')
    expect(ics).toContain('CATEGORIES:Termin')
    expect(ics).toContain('LAST-MODIFIED:20261101T100000Z')

    const allDay = buildCalendar(
      [],
      new Date(),
      [],
      [
        {
          ...appointment,
          startTime: null,
          endDate: '2026-11-22',
          endTime: null,
          notes: '',
          recordName: null,
          place: ''
        }
      ]
    )
    expect(allDay).toContain('DTSTART;VALUE=DATE:20261120')
    // The day after the last
    expect(allDay).toContain('DTEND;VALUE=DATE:20261123')
    expect(allDay).not.toContain('DESCRIPTION:')
    expect(allDay).not.toContain('LOCATION:')
  })

  describe('feed', () => {
    let dir: string

    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'bookingum-appointments-'))
    })

    afterAll(() => {
      container
        .resolve(SettingsService)
        .update({ calendarFeedPath: '', calendarFeedAppointments: false })
      rmSync(dir, { recursive: true, force: true })
    })

    it('takes appointments only when switched on, and follows changes', async () => {
      const path = join(dir, 'Termine.ics')
      const settings = container.resolve(SettingsService)
      settings.update({ calendarFeedPath: path })
      expect(settings.get().calendarFeedAppointments).toBe(false)
      const feed = container.resolve(CalendarFeedService)
      const created = service().create(CreateAppointmentInput.parse(timed))

      expect(await feed.update()).toMatchObject({ includeAppointments: false, appointments: 0 })
      expect(readFileSync(path, 'utf-8')).not.toContain('UID:appointment-')

      settings.update({ calendarFeedAppointments: true })
      expect(await feed.update()).toMatchObject({ includeAppointments: true, appointments: 1 })
      expect(readFileSync(path, 'utf-8')).toContain('SUMMARY:Telefonat Veranstalter')

      // A change rewrites the file shortly after
      service().update({ id: created.id, title: 'Rückruf Veranstalter' })
      await new Promise((resolve) => setTimeout(resolve, 2000))
      expect(readFileSync(path, 'utf-8')).toContain('SUMMARY:Rückruf Veranstalter')

      service().delete(created.id)
      await new Promise((resolve) => setTimeout(resolve, 2000))
      expect(readFileSync(path, 'utf-8')).not.toContain('UID:appointment-')
      expect(feed.status()).toMatchObject({ appointments: 0 })
    })
  })
})
