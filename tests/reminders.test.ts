// #142: the daily summary of due follow-ups (when it shows, what it says, where), and the
// app's tray texts without mail
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import {
  checkFollowUpSummary,
  localDay,
  type FollowUpSummaryDeps
} from '../src/main/notifications/followUpSummary'
import {
  followUpSummaryNotice,
  reminderChannel,
  stillRunningNotice,
  trayTooltip,
  type Notice
} from '../src/main/notifications/noticeText'
import { FollowUpService } from '../src/main/services/FollowUpService'

import { setupTestDb } from './helpers/setup'

setupTestDb()

/** A summary run against a fake clock and store; returns what it showed and marked */
function run(
  at: string,
  options: { enabled?: boolean; lastDay?: string | null; due?: number } = {}
): { shown: Notice[]; marked: string[]; asked: string[]; result: boolean } {
  const shown: Notice[] = []
  const marked: string[] = []
  const asked: string[] = []
  const deps: FollowUpSummaryDeps = {
    now: () => new Date(at),
    enabled: () => options.enabled ?? true,
    lastDay: () => options.lastDay ?? null,
    setLastDay: (day) => marked.push(day),
    dueCount: (today) => {
      asked.push(today)
      return options.due ?? 2
    },
    show: (notice) => shown.push(notice)
  }
  const result = checkFollowUpSummary(deps)
  return { shown, marked, asked, result }
}

describe('checkFollowUpSummary', () => {
  it('stays quiet before 08:00 and leaves the day open', () => {
    const { shown, marked, result } = run('2026-11-07T07:59:00')
    expect(result).toBe(false)
    expect(shown).toEqual([])
    expect(marked).toEqual([])
  })

  it('shows the count the first time at or after 08:00 and marks the day', () => {
    const { shown, marked, asked, result } = run('2026-11-07T08:00:00', { due: 3 })
    expect(result).toBe(true)
    expect(shown).toEqual([followUpSummaryNotice(3)])
    expect(marked).toEqual(['2026-11-07'])
    expect(asked).toEqual(['2026-11-07'])
  })

  it('shows once a day: a day already marked stays quiet', () => {
    const { shown, marked } = run('2026-11-07T15:30:00', { lastDay: '2026-11-07' })
    expect(shown).toEqual([])
    expect(marked).toEqual([])
    // The next day it shows again
    expect(run('2026-11-08T09:00:00', { lastDay: '2026-11-07' }).shown).toHaveLength(1)
  })

  it('marks the day with nothing due, so a later follow-up that day stays quiet', () => {
    const { shown, marked, result } = run('2026-11-07T10:00:00', { due: 0 })
    expect(result).toBe(false)
    expect(shown).toEqual([])
    expect(marked).toEqual(['2026-11-07'])
  })

  it('switched off, shows nothing and leaves the day open for when it is on again', () => {
    const { shown, marked, asked } = run('2026-11-07T10:00:00', { enabled: false })
    expect(shown).toEqual([])
    expect(marked).toEqual([])
    expect(asked).toEqual([])
  })

  it('counts the local day, not the UTC one', () => {
    expect(localDay(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01')
    expect(localDay(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31')
  })
})

describe('reminder texts', () => {
  it('names the count only', () => {
    expect(followUpSummaryNotice(1).title).toBe('1 Wiedervorlage fällig')
    expect(followUpSummaryNotice(4).title).toBe('4 Wiedervorlagen fällig')
    expect(followUpSummaryNotice(4).body).toBe(
      'Heute fällig oder überfällig. Zur Übersicht im Dashboard.'
    )
  })

  it('shows in the app with the main window in front, otherwise from Windows', () => {
    expect(reminderChannel('main')).toBe('app')
    expect(reminderChannel('none')).toBe('desktop')
    // A mail window in front does not swallow a reminder
    expect(reminderChannel('other')).toBe('desktop')
  })

  it('the tray works without mail', () => {
    expect(trayTooltip([])).toBe('Bookingium')
    expect(stillRunningNotice(false)).toEqual({
      title: 'Bookingium läuft weiter',
      body: 'Erinnerungen kommen weiter. Beenden über das Symbol im Infobereich.'
    })
    expect(stillRunningNotice(true).body).toBe(
      'Erinnerungen und E-Mails kommen weiter. Beenden über das Symbol im Infobereich.'
    )
  })
})

describe('FollowUpService for the summary', () => {
  const service = () => container.resolve(FollowUpService)

  it('counts open follow-ups due on the day or earlier', () => {
    expect(service().countDue('2026-11-07')).toBe(0)
    service().create({ dueDate: '2026-11-01', note: 'Überfällig' })
    service().create({ dueDate: '2026-11-07', note: 'Heute' })
    service().create({ dueDate: '2026-11-08', note: 'Morgen' })
    const done = service().create({ dueDate: '2026-11-02', note: 'Erledigt' })
    service().setDone(done.id, true)
    expect(service().countDue('2026-11-07')).toBe(2)
    expect(service().countDue('2026-11-08')).toBe(3)
  })

  it('keeps the day it last looked', () => {
    expect(service().summaryDay()).toBeNull()
    service().setSummaryDay('2026-11-07')
    expect(service().summaryDay()).toBe('2026-11-07')
    service().setSummaryDay('2026-11-08')
    expect(service().summaryDay()).toBe('2026-11-08')
  })
})
