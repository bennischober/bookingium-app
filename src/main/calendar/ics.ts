// ========================================
// iCalendar (RFC 5545) for events
// ========================================
// Outlook, Google, Apple and Thunderbird read these. Events with a show
// time are timed (local "floating" time, as the times are entered); others
// are all-day. The UID is stable per event, so a re-import or subscription
// updates entries instead of duplicating them. Open follow-ups
// (Wiedervorlagen), when included, are all-day entries on their due date;
// one ticked off drops out, and so out of the subscribed calendars.

export interface CalendarEvent {
  id: number
  name: string
  // YYYY-MM-DD
  date: string
  // "21:00" or ''
  performanceTime: string
  // "90 minutes", "75 Minuten", "1:30" or ''
  performanceDuration: string
  status: string
  bandName: string | null
  venueName: string | null
  venueAddress: string | null
  hotelName: string | null
  deal: string
  notes: string
  updatedAt: string | null
}

/** An open follow-up (Wiedervorlage) in the calendar */
export interface CalendarFollowUp {
  id: number
  // YYYY-MM-DD
  dueDate: string
  note: string
  // The record it is on ("München (11.06.2026)"), null for a general one
  recordName: string | null
  updatedAt: string | null
}

const STATUS: Record<string, string> = {
  confirmed: 'CONFIRMED',
  pending: 'TENTATIVE',
  cancelled: 'CANCELLED'
}

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Bestätigt',
  pending: 'Ausstehend',
  cancelled: 'Storniert'
}

const DEFAULT_DURATION_MINUTES = 120

/** Text value escaping: backslash, semicolon, comma, line breaks */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Lines longer than 75 octets continue on the next line after a space */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf-8')
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const charSize = Buffer.byteLength(char, 'utf-8')
    // First line 75 octets, continuation lines 74 (+ the leading space)
    if (size + charSize > (parts.length === 0 ? 75 : 74)) {
      parts.push(current)
      current = ''
      size = 0
    }
    current += char
    size += charSize
  }
  parts.push(current)
  return parts.join('\r\n ')
}

const pad = (n: number) => String(n).padStart(2, '0')

/** "90 minutes" / "90 Min" / "1:30" / "1,5 h" → minutes */
export function parseDurationMinutes(text: string): number | null {
  const value = text.trim().toLowerCase()
  if (!value) return null
  const clock = value.match(/^(\d{1,2}):(\d{2})$/)
  if (clock) return Number(clock[1]) * 60 + Number(clock[2])
  const hours = value.match(/^(\d+(?:[.,]\d+)?)\s*(h|std|stunden?|hours?)\b/)
  if (hours) return Math.round(Number(hours[1].replace(',', '.')) * 60)
  const minutes = value.match(/^(\d+)/)
  return minutes ? Number(minutes[1]) : null
}

function formatDate(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
}

function formatDateTime(date: Date): string {
  return `${formatDate(date)}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}00`
}

/** UTC timestamp as YYYYMMDDTHHMMSSZ (DTSTAMP, LAST-MODIFIED) */
function formatUtc(date: Date): string {
  return `${formatDateTime(date)}Z`
}

/** DTSTART/DTEND of an all-day entry on 2026-06-11 */
function allDayLines(isoDate: string): string[] {
  const [year, month, day] = isoDate.split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day))
  const end = new Date(Date.UTC(year, month - 1, day + 1))
  return [`DTSTART;VALUE=DATE:${formatDate(start)}`, `DTEND;VALUE=DATE:${formatDate(end)}`]
}

/** LAST-MODIFIED from an SQLite "2026-05-01 10:00:00" (UTC) or an ISO timestamp */
function lastModifiedLines(updatedAt: string | null): string[] {
  if (!updatedAt) return []
  const updated = new Date(updatedAt.replace(' ', 'T') + (updatedAt.endsWith('Z') ? '' : 'Z'))
  return Number.isNaN(updated.getTime()) ? [] : [`LAST-MODIFIED:${formatUtc(updated)}`]
}

function eventLines(event: CalendarEvent, now: Date): string[] {
  const [year, month, day] = event.date.split('-').map(Number)
  const lines = ['BEGIN:VEVENT', `UID:event-${event.id}@bookingium`, `DTSTAMP:${formatUtc(now)}`]

  const time = event.performanceTime.trim().match(/^(\d{1,2})[:.](\d{2})/)
  if (time) {
    // Wall-clock time of the show (floating, no time zone conversion);
    // computed in UTC fields only to get the date arithmetic right
    const start = new Date(Date.UTC(year, month - 1, day, Number(time[1]), Number(time[2])))
    const minutes = parseDurationMinutes(event.performanceDuration) ?? DEFAULT_DURATION_MINUTES
    const end = new Date(start.getTime() + minutes * 60_000)
    lines.push(`DTSTART:${formatDateTime(start)}`, `DTEND:${formatDateTime(end)}`)
  } else {
    lines.push(...allDayLines(event.date))
  }

  lines.push(`SUMMARY:${escapeText(event.name)}`)
  const location = [event.venueName, event.venueAddress].filter(Boolean).join(', ')
  if (location) lines.push(`LOCATION:${escapeText(location)}`)

  const description = [
    event.bandName && `Band: ${event.bandName}`,
    `Status: ${STATUS_LABELS[event.status] ?? event.status}`,
    event.performanceTime && `Showtime: ${event.performanceTime}`,
    event.performanceDuration && `Spielzeit: ${event.performanceDuration}`,
    event.hotelName && `Hotel: ${event.hotelName}`,
    event.deal && `Deal: ${event.deal}`,
    event.notes && `\n${event.notes}`
  ]
    .filter(Boolean)
    .join('\n')
  lines.push(`DESCRIPTION:${escapeText(description)}`)

  if (STATUS[event.status]) lines.push(`STATUS:${STATUS[event.status]}`)
  lines.push(...lastModifiedLines(event.updatedAt), 'END:VEVENT')
  return lines
}

function followUpLines(followUp: CalendarFollowUp, now: Date): string[] {
  // The note's first line is the title; the whole note is the description
  const title = followUp.note.split(/\r?\n/)[0].trim()
  const description = [followUp.recordName && `Zu: ${followUp.recordName}`, followUp.note]
    .filter(Boolean)
    .join('\n\n')
  return [
    'BEGIN:VEVENT',
    `UID:follow-up-${followUp.id}@bookingium`,
    `DTSTAMP:${formatUtc(now)}`,
    ...allDayLines(followUp.dueDate),
    `SUMMARY:${escapeText(`Wiedervorlage: ${title}`)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'CATEGORIES:Wiedervorlage',
    // A reminder, not an appointment: it doesn't block the day
    'TRANSP:TRANSPARENT',
    ...lastModifiedLines(followUp.updatedAt),
    'END:VEVENT'
  ]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/

/** A whole calendar file (CRLF line endings, folded lines) */
export function buildCalendar(
  events: CalendarEvent[],
  now = new Date(),
  followUps: CalendarFollowUp[] = []
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bookingium//Events//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Bookingium',
    ...events
      .filter((event) => ISO_DATE.test(event.date))
      .flatMap((event) => eventLines(event, now)),
    ...followUps
      .filter((followUp) => ISO_DATE.test(followUp.dueDate))
      .flatMap((followUp) => followUpLines(followUp, now)),
    'END:VCALENDAR'
  ]
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
