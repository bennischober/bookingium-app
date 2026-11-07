import { addDays } from '@/lib/followUps'
import { ALL_DAY_REMINDERS, TIMED_REMINDERS } from '../../../../main/calendar/appointments'
import type { AppointmentDto } from '../../../../main/api/schemas/appointment.schema'

// #71: how the calendar shows own appointments (Termine): on which days and with which time.
// Pure, for the tests.

type Span = Pick<AppointmentDto, 'startDate' | 'startTime' | 'endDate' | 'endTime'>

/** The days (YYYY-MM-DD) an appointment is on within `from`..`to`; several-day ones on each */
export function appointmentDays(appointment: Span, from: string, to: string): string[] {
  const days: string[] = []
  let day = appointment.startDate < from ? from : appointment.startDate
  const last = appointment.endDate > to ? to : appointment.endDate
  // A year at most: guards against a broken row looping long
  for (let i = 0; day <= last && i < 366; i++) {
    days.push(day)
    day = addDays(day, 1)
  }
  return days
}

/** Appointments by day within `from`..`to`, each day's in the order given (by start) */
export function appointmentsByDay<T extends Span>(
  appointments: T[],
  from: string,
  to: string
): Map<string, T[]> {
  const byDay = new Map<string, T[]>()
  for (const appointment of appointments) {
    for (const day of appointmentDays(appointment, from, to)) {
      byDay.set(day, [...(byDay.get(day) ?? []), appointment])
    }
  }
  return byDay
}

/**
 * The time an appointment has on `day`: "14:00–15:30", "Ganztägig", and for several days
 * "ab 14:00" on the first, "bis 12:00" on the last and "Ganztägig" in between
 */
export function appointmentTimeLabel(appointment: Span, day: string): string {
  const { startDate, startTime, endDate, endTime } = appointment
  if (startTime === null || endTime === null) return 'Ganztägig'
  if (startDate === endDate) return startTime === endTime ? startTime : `${startTime}–${endTime}`
  if (day === startDate) return `ab ${startTime}`
  if (day === endDate) return `bis ${endTime}`
  return 'Ganztägig'
}

/** The dialog's reminder choices; the value "none" is no reminder */
export function reminderOptions(
  allDay: boolean
): ReadonlyArray<{ minutes: number; label: string }> {
  return allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS
}

/** A new appointment's reminder: a quarter of an hour before, or 08:00 on an all-day one's day */
export const defaultReminder = (allDay: boolean): number => (allDay ? 0 : 15)

/**
 * The reminder after switching between all-day and timed: kept when the other list offers it,
 * otherwise that list's default; no reminder stays none
 */
export function reminderAfterSwitch(minutes: number | null, allDay: boolean): number | null {
  if (minutes === null) return null
  return reminderOptions(allDay).some((option) => option.minutes === minutes)
    ? minutes
    : defaultReminder(allDay)
}
