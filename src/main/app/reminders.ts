import { powerMonitor } from 'electron'
import { container } from 'tsyringe'
import type { AppTray } from '../notifications/appTray'
import { checkAppointmentReminders } from '../notifications/appointmentReminders'
import { checkFollowUpSummary } from '../notifications/followUpSummary'
import { reminderChannel, type Notice } from '../notifications/noticeText'
import { AppointmentService } from '../services/AppointmentService'
import { FollowUpService } from '../services/FollowUpService'
import { SettingsService } from '../services/SettingsService'
import { getMainWindow, showCalendarDay, showFollowUps, windowFocus } from './windows'

/** #142: the first look for due follow-ups after the start or a wake, then the regular one */
const REMINDER_FIRST_CHECK_MS = 10_000
const REMINDER_CHECK_MS = 5 * 60_000
/** #71: appointment reminders are looked at every minute (a timed one has a time) */
const APPOINTMENT_CHECK_MS = 60_000

/**
 * #142: the daily summary of due follow-ups: a look soon after the start, then every few minutes
 * (the first look at or after 08:00 shows it) and after a wake. #71: own appointments' reminders,
 * looked at every minute. Both go to the popup with the main window in front, otherwise to Windows;
 * a click opens the dashboard or the appointment's day in the calendar.
 */
export function setUpReminders(tray: AppTray): void {
  const settings = container.resolve(SettingsService)
  const followUps = container.resolve(FollowUpService)
  const appointments = container.resolve(AppointmentService)
  // `day`: an appointment's reminder, opened on that day in the calendar
  const announce = (notice: Notice, day?: string): void => {
    const mainWindow = getMainWindow()
    if (reminderChannel(windowFocus()) === 'app' && mainWindow) {
      mainWindow.webContents.send('app:reminder', { ...notice, day })
    } else tray.notify(notice, day ? () => showCalendarDay(day) : showFollowUps)
  }
  const checkAppointments = (): void => {
    try {
      checkAppointmentReminders({
        now: () => new Date(),
        enabled: () => settings.get().reminderNotifications,
        candidates: (from, to) => appointments.reminderCandidates(from, to),
        markReminded: (ids) => appointments.markReminded(ids),
        show: announce
      })
    } catch (error) {
      console.error('Checking the appointment reminders failed:', error)
    }
  }
  setTimeout(checkAppointments, REMINDER_FIRST_CHECK_MS)
  setInterval(checkAppointments, APPOINTMENT_CHECK_MS)
  powerMonitor.on('resume', () => setTimeout(checkAppointments, REMINDER_FIRST_CHECK_MS))
  const check = (): void => {
    try {
      checkFollowUpSummary({
        now: () => new Date(),
        enabled: () => settings.get().reminderNotifications,
        lastDay: () => followUps.summaryDay(),
        setLastDay: (day) => followUps.setSummaryDay(day),
        dueCount: (today) => followUps.countDue(today),
        show: (notice) => announce(notice)
      })
    } catch (error) {
      console.error('Checking the due follow-ups failed:', error)
    }
  }
  // The window has loaded by then, so with the app in front the popup can show
  setTimeout(check, REMINDER_FIRST_CHECK_MS)
  setInterval(check, REMINDER_CHECK_MS)
  powerMonitor.on('resume', () => setTimeout(check, REMINDER_FIRST_CHECK_MS))
}
