// #71: reminders of own appointments (Termine). The app looks every minute which appointments
// with a reminder are due: from the reminder time until the start plus half an hour (all-day: until
// the day ends). Due ones are marked as reminded and announced together in one notice; one whose
// window passed while the app was not running is not announced later. Kept free of Electron for
// the tests.

import { reminderWindow } from '../calendar/appointments'
import { localDay } from './followUpSummary'
import { appointmentReminderNotice, type Notice } from './noticeText'

export interface AppointmentReminderCandidate {
  id: number
  startDate: string
  startTime: string | null
  reminderMinutes: number | null
}

export interface AppointmentReminderDeps {
  now: () => Date
  /** The reminder switch (Einstellungen); off, nothing is shown and nothing is marked */
  enabled: () => boolean
  /** Not yet reminded appointments with a reminder starting from `from` to `to` (YYYY-MM-DD) */
  candidates: (from: string, to: string) => AppointmentReminderCandidate[]
  markReminded: (ids: number[]) => void
  /** `day`: the first due appointment's day, the calendar opens on it */
  show: (notice: Notice, day: string) => void
}

const DAY_MS = 24 * 60 * 60_000

/** One look at the clock; returns the ids that were announced */
export function checkAppointmentReminders(deps: AppointmentReminderDeps): number[] {
  if (!deps.enabled()) return []
  const now = deps.now()
  // From yesterday (a timed one late in the evening, still in its grace time after midnight) to
  // the longest reminder ahead (a week) plus a day
  const from = localDay(new Date(now.getTime() - DAY_MS))
  const to = localDay(new Date(now.getTime() + 8 * DAY_MS))
  const due = deps.candidates(from, to).filter((appointment) => {
    if (appointment.reminderMinutes === null) return false
    const { remindAt, expiresAt } = reminderWindow(appointment, appointment.reminderMinutes)
    return remindAt <= now && now < expiresAt
  })
  if (due.length === 0) return []
  const ids = due.map((appointment) => appointment.id)
  deps.markReminded(ids)
  deps.show(appointmentReminderNotice(due, localDay(now)), due[0].startDate)
  return ids
}
