// #142: the daily summary of follow-ups (Wiedervorlagen) that are due. Follow-ups have a due day
// but no time, so the app announces them once a day: the first time it runs at or after 08:00
// (local time) on that day, with the number due today or earlier. The day it last looked is
// kept, so a restart the same day stays quiet. Kept free of Electron for the tests.

import { followUpSummaryNotice, type Notice } from './noticeText'

/** The hour from which the day's summary is shown */
export const SUMMARY_HOUR = 8

/** The local calendar day as 2026-11-07, the format of follow_up.due_date */
export function localDay(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export interface FollowUpSummaryDeps {
  now: () => Date
  /** The reminder switch (Einstellungen); off, nothing is shown and the day stays unchecked */
  enabled: () => boolean
  /** The day the summary was last considered (YYYY-MM-DD), or null */
  lastDay: () => string | null
  setLastDay: (day: string) => void
  /** Open follow-ups due on `today` or earlier */
  dueCount: (today: string) => number
  show: (notice: Notice) => void
}

/**
 * One look at the clock: shows the day's summary if it is time and the day has not had one yet.
 * The day counts as done even with nothing due, so a follow-up added later that day for the same
 * day does not announce itself. Returns whether a notice was shown.
 */
export function checkFollowUpSummary(deps: FollowUpSummaryDeps): boolean {
  const now = deps.now()
  if (now.getHours() < SUMMARY_HOUR || !deps.enabled()) return false
  const today = localDay(now)
  if (deps.lastDay() === today) return false
  deps.setLastDay(today)
  const count = deps.dueCount(today)
  if (count <= 0) return false
  deps.show(followUpSummaryNotice(count))
  return true
}
