// ========================================
// #53: reading a subscribed calendar (ICS from Google, iCloud, Outlook, ...)
// ========================================
// Pure: no Electron, no Node. A feed is parsed once (parseFeed) and then asked for the entries
// of a date range (entriesBetween), which expands recurring events (RRULE/RDATE minus EXDATE,
// moved or changed occurrences via RECURRENCE-ID). Times come out as wall-clock date and time
// of the given time zone (this computer's by default); all-day entries keep their days.

import ICAL from 'ical.js'
import { resolveZone } from './invitation'

export interface SubscribedEntry {
  // UID plus the occurrence for a recurring event: stable, usable as a React key
  key: string
  title: string
  location: string
  description: string
  // YYYY-MM-DD, the first and the last day it covers
  startDate: string
  endDate: string
  // HH:MM, null for all-day
  startTime: string | null
  endTime: string | null
  cancelled: boolean
}

export interface ParsedFeed {
  // X-WR-CALNAME, null when the feed has none
  name: string | null
  // Number of VEVENTs (occurrences not expanded)
  eventCount: number
  events: ICAL.Event[]
}

/** The feed's text must at least look like a calendar */
export function looksLikeCalendar(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text.replace(/^\uFEFF/, ''))
}

/** Parses an ICS feed; throws with a readable message when it is none */
export function parseFeed(text: string): ParsedFeed {
  const clean = text.replace(/^\uFEFF/, '')
  if (!looksLikeCalendar(clean)) {
    throw new Error('Unter der Adresse liegt kein Kalender (keine iCalendar-Daten).')
  }
  let root: ICAL.Component
  try {
    root = new ICAL.Component(ICAL.parse(clean) as unknown[])
  } catch (error) {
    throw new Error(
      `Der Kalender konnte nicht gelesen werden: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  const vevents = root.getAllSubcomponents('vevent')

  // Masters by UID; changed occurrences (RECURRENCE-ID) are related to their master
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Component[] = []
  const events: ICAL.Event[] = []
  for (const component of vevents) {
    if (component.hasProperty('recurrence-id')) {
      exceptions.push(component)
      continue
    }
    const event = new ICAL.Event(component)
    if (event.uid && !masters.has(event.uid)) masters.set(event.uid, event)
    events.push(event)
  }
  for (const component of exceptions) {
    const uid = component.getFirstPropertyValue('uid')
    const master = typeof uid === 'string' ? masters.get(uid) : undefined
    // A changed occurrence without its series (only it was shared) stands alone
    if (master?.isRecurring()) master.relateException(component)
    else events.push(new ICAL.Event(component))
  }

  const name = root.getFirstPropertyValue('x-wr-calname')
  return {
    name: typeof name === 'string' && name.trim() ? name.trim() : null,
    eventCount: vevents.length,
    events
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Wall-clock parts of an instant in a time zone */
function zonedParts(epochMs: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(epochMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') % 24,
    minute: get('minute')
  }
}

/** Epoch ms of a wall-clock time in an IANA time zone (two passes settle DST changes) */
export function zonedToEpoch(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string
): number {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  const offsetAt = (epoch: number) => {
    const p = zonedParts(epoch, timeZone)
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - epoch
  }
  let epoch = asUtc - offsetAt(asUtc)
  epoch = asUtc - offsetAt(epoch)
  return epoch
}

type Wall = { date: string; time: string }

/**
 * A DATE-TIME as wall clock of `timeZone`. Floating times stay as written; a TZID without a
 * VTIMEZONE in the feed is resolved like an invitation's (IANA names as Google and iCloud
 * write them, Windows names as Outlook does), otherwise taken as floating.
 */
function toWall(time: ICAL.Time, tzidParam: string | null, timeZone: string): Wall {
  const floating = !time.zone || time.zone.tzid === 'floating'
  const zone = floating && tzidParam ? resolveZone(tzidParam) : null
  let epoch: number | null = null
  if (!floating) {
    epoch = time.toUnixTime() * 1000
  } else if (zone) {
    epoch = zonedToEpoch(time, zone)
  }
  if (epoch === null) {
    return {
      date: `${time.year}-${pad(time.month)}-${pad(time.day)}`,
      time: `${pad(time.hour)}:${pad(time.minute)}`
    }
  }
  const p = zonedParts(epoch, timeZone)
  return {
    date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
    time: `${pad(p.hour)}:${pad(p.minute)}`
  }
}

function dateOf(time: ICAL.Time): string {
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`
}

function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function textOf(event: ICAL.Event, name: string): string {
  const value = event.component.getFirstPropertyValue(name)
  return typeof value === 'string' ? value.trim() : ''
}

function entryOf(
  event: ICAL.Event,
  start: ICAL.Time,
  end: ICAL.Time | null,
  key: string,
  timeZone: string
): SubscribedEntry {
  const base = {
    key,
    // '' when it has none: the renderer shows a placeholder in the UI language
    title: event.summary?.trim() ?? '',
    location: event.location?.trim() ?? '',
    description: event.description?.trim() ?? '',
    cancelled: textOf(event, 'status').toUpperCase() === 'CANCELLED'
  }
  if (start.isDate) {
    // DTEND of an all-day entry is the day after its last
    const last = end && end.compare(start) > 0 ? addDays(dateOf(end), -1) : dateOf(start)
    return { ...base, startDate: dateOf(start), endDate: last, startTime: null, endTime: null }
  }
  const tzid = (prop: string) => {
    const value = event.component.getFirstProperty(prop)?.getParameter('tzid')
    return typeof value === 'string' ? value : null
  }
  const from = toWall(start, tzid('dtstart'), timeZone)
  const to = end ? toWall(end, tzid('dtend') ?? tzid('dtstart'), timeZone) : from
  return {
    ...base,
    startDate: from.date,
    startTime: from.time,
    endDate: to.date < from.date ? from.date : to.date,
    endTime: to.time
  }
}

// A daily series since 1990 still reaches today; beyond that a feed is broken
const MAX_OCCURRENCES = 20_000

function overlaps(entry: SubscribedEntry, from: string, to: string): boolean {
  return entry.startDate <= to && entry.endDate >= from
}

/** The entries between two days (YYYY-MM-DD, both included), sorted by start */
export function entriesBetween(
  feed: ParsedFeed,
  from: string,
  to: string,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
): SubscribedEntry[] {
  const result: SubscribedEntry[] = []
  // Occurrences are compared by their own start; a day of margin covers zone shifts
  const stopAfter = addDays(to, 1)
  for (const event of feed.events) {
    if (!event.startDate) continue
    if (!event.isRecurring()) {
      const entry = entryOf(event, event.startDate, event.endDate ?? null, event.uid, timeZone)
      if (overlaps(entry, from, to)) result.push(entry)
      continue
    }
    const iterator = event.iterator()
    let count = 0
    for (let next = iterator.next(); next && count < MAX_OCCURRENCES; next = iterator.next()) {
      count++
      if (dateOf(next) > stopAfter) break
      const details = event.getOccurrenceDetails(next)
      const entry = entryOf(
        details.item,
        details.startDate,
        details.endDate,
        `${event.uid}/${next.toString()}`,
        timeZone
      )
      if (overlaps(entry, from, to)) result.push(entry)
    }
  }
  return result.sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      (a.startTime ?? '').localeCompare(b.startTime ?? '') ||
      a.title.localeCompare(b.title)
  )
}
