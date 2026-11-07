// #71: the rules of an own appointment (Termin) that both the main process and the dialog need:
// when its times are consistent, which reminders there are, and when a reminder is due. Kept free
// of Electron and Node, the renderer imports it.

/** The times of an appointment: with start and end time, or all-day (both times null) */
export interface AppointmentTimes {
  // YYYY-MM-DD
  startDate: string
  // HH:MM, null for all-day
  startTime: string | null
  // YYYY-MM-DD, the start day for an appointment on one day
  endDate: string
  // HH:MM, null for all-day
  endTime: string | null
}

/** Why the times do not fit together, in German for the form; null when they do */
export function appointmentTimesError(times: AppointmentTimes): string | null {
  const allDay = times.startTime === null
  if (allDay !== (times.endTime === null)) {
    return 'Beginn und Ende brauchen beide eine Uhrzeit, oder der Termin ist ganztägig'
  }
  if (times.endDate < times.startDate) return 'Das Ende liegt vor dem Beginn'
  if (!allDay && times.endDate === times.startDate && times.endTime! < times.startTime!) {
    return 'Das Ende liegt vor dem Beginn'
  }
  return null
}

/** At most a week ahead */
export const REMINDER_MAX_MINUTES = 7 * 24 * 60

/** The hour an all-day appointment counts from for its reminder, as the follow-up summary */
export const ALL_DAY_REMINDER_HOUR = 8

/** The reminders the dialog offers, in minutes before the start */
export const TIMED_REMINDERS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'Zum Beginn' },
  { minutes: 5, label: '5 Minuten vorher' },
  { minutes: 15, label: '15 Minuten vorher' },
  { minutes: 30, label: '30 Minuten vorher' },
  { minutes: 60, label: '1 Stunde vorher' },
  { minutes: 120, label: '2 Stunden vorher' },
  { minutes: 24 * 60, label: '1 Tag vorher' }
]

/** All-day: before 08:00 of the day, so "am Tag" is 08:00 and "am Vortag" 08:00 the day before */
export const ALL_DAY_REMINDERS: ReadonlyArray<{ minutes: number; label: string }> = [
  { minutes: 0, label: 'Am Tag um 8 Uhr' },
  { minutes: 24 * 60, label: 'Am Vortag um 8 Uhr' },
  { minutes: 2 * 24 * 60, label: '2 Tage vorher um 8 Uhr' },
  { minutes: 7 * 24 * 60, label: '1 Woche vorher um 8 Uhr' }
]

/** A reminder's label, also for minutes the lists do not offer (set elsewhere) */
export function reminderLabel(minutes: number, allDay: boolean): string {
  const offered = (allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).find((r) => r.minutes === minutes)
  if (offered) return offered.label
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} Tage vorher`
  if (minutes % 60 === 0) return `${minutes / 60} Stunden vorher`
  return `${minutes} Minuten vorher`
}

/** Local wall-clock time of a YYYY-MM-DD day at HH:MM */
export function localDateTime(isoDate: string, time: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  return new Date(year, month - 1, day, hours, minutes)
}

/** A timed appointment's reminder stays due this long after its start (the app started late) */
export const REMINDER_GRACE_MINUTES = 30

/**
 * When a reminder is due and until when it is still worth showing. Timed: `minutes` before the
 * start, until half an hour after it. All-day: `minutes` before 08:00 of the day, until the day
 * ends. A reminder missed in that window (the app was not running) is not shown later.
 */
export function reminderWindow(
  appointment: Pick<AppointmentTimes, 'startDate' | 'startTime'>,
  minutes: number
): { remindAt: Date; expiresAt: Date } {
  const pad = (n: number): string => String(n).padStart(2, '0')
  if (appointment.startTime !== null) {
    const start = localDateTime(appointment.startDate, appointment.startTime)
    return {
      remindAt: new Date(start.getTime() - minutes * 60_000),
      expiresAt: new Date(start.getTime() + REMINDER_GRACE_MINUTES * 60_000)
    }
  }
  const morning = localDateTime(appointment.startDate, `${pad(ALL_DAY_REMINDER_HOUR)}:00`)
  const [year, month, day] = appointment.startDate.split('-').map(Number)
  return {
    remindAt: new Date(morning.getTime() - minutes * 60_000),
    expiresAt: new Date(year, month - 1, day + 1)
  }
}
