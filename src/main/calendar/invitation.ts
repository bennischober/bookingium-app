// #71: a calendar invitation from a mail (iMIP METHOD:REQUEST, an attached .ics) read as an own
// appointment. Only the first event of the file is taken, in the local wall-clock time the
// appointment table stores. Kept free of Electron and Node, the renderer imports it.

/** What the appointment dialog opens with when an invitation is taken over */
export interface Invitation {
  /** The event's UID: taking the same invitation over again updates that appointment */
  uid: string | null
  /** METHOD of the calendar (REQUEST, PUBLISH), null when the file names none */
  method: string | null
  /** '' when the event has no SUMMARY */
  title: string
  // YYYY-MM-DD and HH:MM in the local zone; both times null for an all-day event
  startDate: string
  startTime: string | null
  endDate: string
  endTime: string | null
  place: string
  notes: string
  /** Hints for the dialog in German: a series, a time zone that is not known, several events */
  hints: string[]
}

export type InvitationResult = { ok: true; invitation: Invitation } | { ok: false; error: string }

/** A larger file is no invitation */
export const INVITATION_MAX_BYTES = 1024 * 1024

// The appointment's own limits (appointment.schema.ts)
const TITLE_MAX = 200
const PLACE_MAX = 500
const NOTES_MAX = 10_000
const UID_MAX = 500

export const SERIES_HINT =
  'Ein Serientermin: übernommen wird nur der erste Termin, Wiederholungen gibt es noch nicht.'

/** Is this mail part a calendar file? A text/calendar part, or an attachment named *.ics */
export function isCalendarPart(part: { contentType: string; filename: string }): boolean {
  return (
    /^(text|application)\/(calendar|ics)\b/i.test(part.contentType.trim()) ||
    /\.ics$/i.test(part.filename.trim())
  )
}

type Property = { name: string; params: Record<string, string>; value: string }

/** RFC 5545 3.1: a line that starts with a space or tab continues the one before */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '')
}

/** `NAME;PARAM=a;PARAM2="b:c":value`, with quoted parameter values that may hold : and ; */
function parseLine(line: string): Property | null {
  let i = 0
  const nameEnd = line.search(/[;:]/)
  if (nameEnd <= 0) return null
  const name = line.slice(0, nameEnd).toUpperCase()
  i = nameEnd
  const params: Record<string, string> = {}
  while (line[i] === ';') {
    i++
    const eq = line.indexOf('=', i)
    if (eq < 0) return null
    const key = line.slice(i, eq).toUpperCase()
    i = eq + 1
    let value = ''
    while (i < line.length && line[i] !== ';' && line[i] !== ':') {
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1)
        if (close < 0) return null
        value += line.slice(i + 1, close)
        i = close + 1
      } else {
        value += line[i++]
      }
    }
    params[key] = value
  }
  if (line[i] !== ':') return null
  return { name, params, value: line.slice(i + 1) }
}

/** TEXT values: \n is a line break, \, \; \\ the character itself */
function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c))
}

/** The properties of each VEVENT, without those of its VALARMs */
function vevents(lines: string[]): { method: string | null; events: Property[][] } {
  let method: string | null = null
  const events: Property[][] = []
  const stack: string[] = []
  let current: Property[] | null = null
  for (const line of lines) {
    const prop = parseLine(line)
    if (!prop) continue
    if (prop.name === 'BEGIN') {
      const component = prop.value.trim().toUpperCase()
      stack.push(component)
      if (component === 'VEVENT' && stack.length === 2) current = []
      continue
    }
    if (prop.name === 'END') {
      const component = stack.pop()
      if (component === 'VEVENT' && current) {
        events.push(current)
        current = null
      }
      continue
    }
    if (stack.length === 1 && stack[0] === 'VCALENDAR' && prop.name === 'METHOD') {
      method = prop.value.trim().toUpperCase()
    }
    // Directly in the VEVENT, not in a VALARM within it
    if (current && stack.length === 2) current.push(prop)
  }
  return { method, events }
}

// Outlook and Exchange name their zones the Windows way (CLDR windowsZones, the common ones)
const WINDOWS_ZONES: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'GTB Standard Time': 'Europe/Bucharest',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'China Standard Time': 'Asia/Shanghai',
  'India Standard Time': 'Asia/Kolkata',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  UTC: 'UTC',
  'Coordinated Universal Time': 'UTC'
}

const knownZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The IANA zone a TZID means, null when it is not known */
export function resolveZone(tzid: string): string | null {
  const name = tzid.trim()
  if (WINDOWS_ZONES[name]) return WINDOWS_ZONES[name]
  if (knownZone(name)) return name
  // "/mozilla.org/20050126_1/Europe/Berlin", "/citadel.org/.../Europe/Berlin"
  const tail = /([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/.exec(name)?.[1]
  if (tail && knownZone(tail)) return tail
  return null
}

type Wall = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const wallToMs = (w: Wall): number =>
  Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)

const msToWall = (ms: number): Wall => {
  const d = new Date(ms)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds()
  }
}

/** The wall-clock time of an instant in a zone */
function wallIn(instant: number, zone: string): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(instant))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second')
  }
}

/** The instant a wall-clock time in a zone is; in a DST gap the time after it */
function instantOf(wall: Wall, zone: string): number {
  const asUtc = wallToMs(wall)
  const offset = (at: number): number => wallToMs(wallIn(at, zone)) - at
  const first = asUtc - offset(asUtc)
  const second = asUtc - offset(first)
  return second
}

/** A DATE-TIME as an instant, or as a floating wall time (no zone, or one not known) */
type Moment = { instant: number } | { floating: Wall }

const DATE = /^(\d{4})(\d{2})(\d{2})$/
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i

type ParsedTime =
  | { kind: 'date'; wall: Wall }
  | { kind: 'time'; moment: Moment; unknownZone: string | null }

function parseTime(prop: Property): ParsedTime | null {
  const value = prop.value.trim()
  const date = DATE.exec(value)
  if (date) {
    const [, y, m, d] = date
    return {
      kind: 'date',
      wall: { year: +y, month: +m, day: +d, hour: 0, minute: 0, second: 0 }
    }
  }
  const match = DATE_TIME.exec(value)
  if (!match) return null
  const [, y, m, d, hh, mm, ss, utc] = match
  const wall: Wall = { year: +y, month: +m, day: +d, hour: +hh, minute: +mm, second: +(ss ?? 0) }
  if (utc) return { kind: 'time', moment: { instant: wallToMs(wall) }, unknownZone: null }
  const tzid = prop.params.TZID
  if (!tzid) return { kind: 'time', moment: { floating: wall }, unknownZone: null }
  const zone = resolveZone(tzid)
  if (!zone) return { kind: 'time', moment: { floating: wall }, unknownZone: tzid }
  return { kind: 'time', moment: { instant: instantOf(wall, zone) }, unknownZone: null }
}

/** RFC 5545 DURATION (P1W, P1DT2H30M, PT90M), in seconds; null when it is not one */
export function durationSeconds(value: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
    value.trim()
  )
  if (!match || value.trim().toUpperCase().replace(/^[+-]/, '') === 'P') return null
  const [, sign, w, d, h, m, s] = match
  const total = (+(w ?? 0) * 7 + +(d ?? 0)) * 86_400 + +(h ?? 0) * 3600 + +(m ?? 0) * 60 + +(s ?? 0)
  return sign === '-' ? -total : total
}

const pad = (n: number): string => String(n).padStart(2, '0')
const isoDate = (w: Wall): string =>
  `${String(w.year).padStart(4, '0')}-${pad(w.month)}-${pad(w.day)}`
const hhmm = (w: Wall): string => `${pad(w.hour)}:${pad(w.minute)}`

/** The local wall time of a moment: an instant in `zone`, a floating one as it is */
const localWall = (moment: Moment, zone: string): Wall =>
  'instant' in moment ? wallIn(moment.instant, zone) : moment.floating

const addSeconds = (moment: Moment, seconds: number): Moment =>
  'instant' in moment
    ? { instant: moment.instant + seconds * 1000 }
    : { floating: msToWall(wallToMs(moment.floating) + seconds * 1000) }

const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text)

/** The system's zone, the one the appointment table means */
const systemZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

/**
 * Reads the first event of an invitation. `zone` is the zone the appointment is stored in, the
 * system's by default (tests pass one). A cancellation or a reply is no appointment to take over.
 */
export function parseInvitation(text: string, zone: string = systemZone()): InvitationResult {
  if (text.length > INVITATION_MAX_BYTES) {
    return { ok: false, error: 'Die Kalenderdatei ist zu groß.' }
  }
  const { method, events } = vevents(unfold(text))
  if (method === 'CANCEL') {
    return {
      ok: false,
      error:
        'Diese Mail sagt einen Termin ab. Ein schon übernommener Termin bleibt im Kalender, bis du ihn löschst.'
    }
  }
  if (method === 'REPLY') {
    return { ok: false, error: 'Diese Mail ist eine Antwort auf eine Einladung, kein Termin.' }
  }
  // An overridden occurrence (RECURRENCE-ID) belongs to its series, the main event comes first
  const main = events.filter((props) => !props.some((p) => p.name === 'RECURRENCE-ID'))
  const event = main[0] ?? events[0]
  if (!event) return { ok: false, error: 'Die Kalenderdatei enthält keinen Termin.' }

  const prop = (name: string): Property | undefined => event.find((p) => p.name === name)
  const textOf = (name: string): string => {
    const found = prop(name)
    return found ? unescapeText(found.value).trim() : ''
  }

  const startProp = prop('DTSTART')
  const start = startProp ? parseTime(startProp) : null
  if (!start)
    return { ok: false, error: 'Der Termin in der Kalenderdatei hat keinen gültigen Beginn.' }

  const hints: string[] = []
  const recurring = Boolean(prop('RRULE') || prop('RDATE'))
  if (recurring) hints.push(SERIES_HINT)
  if (main.length > 1) {
    hints.push(`Die Datei enthält ${main.length} Termine, übernommen wird der erste.`)
  }

  const endProp = prop('DTEND')
  const end = endProp ? parseTime(endProp) : null
  const duration = prop('DURATION') ? durationSeconds(prop('DURATION')!.value) : null

  let times: Pick<Invitation, 'startDate' | 'startTime' | 'endDate' | 'endTime'>
  if (start.kind === 'date') {
    const startDate = isoDate(start.wall)
    // DTEND of an all-day event is the day AFTER it (exclusive)
    let lastDay = startDate
    if (end?.kind === 'date') {
      lastDay = isoDate(msToWall(wallToMs(end.wall) - 86_400_000))
    } else if (duration !== null && duration >= 86_400) {
      lastDay = isoDate(
        msToWall(wallToMs(start.wall) + (Math.ceil(duration / 86_400) - 1) * 86_400_000)
      )
    }
    times = {
      startDate,
      startTime: null,
      endDate: lastDay < startDate ? startDate : lastDay,
      endTime: null
    }
  } else {
    if (start.unknownZone) {
      hints.push(
        `Die Zeitzone „${cut(start.unknownZone, 80)}“ ist nicht bekannt: die Uhrzeit ist so übernommen, wie sie in der Einladung steht.`
      )
    }
    const endMoment =
      end?.kind === 'time'
        ? end.moment
        : duration !== null && duration > 0
          ? addSeconds(start.moment, duration)
          : start.moment
    const from = localWall(start.moment, zone)
    let to = localWall(endMoment, zone)
    if (wallToMs(to) < wallToMs(from)) to = from
    times = {
      startDate: isoDate(from),
      startTime: hhmm(from),
      endDate: isoDate(to),
      endTime: hhmm(to)
    }
  }

  const description = textOf('DESCRIPTION')
  const notes = recurring ? [description, SERIES_HINT].filter(Boolean).join('\n\n') : description
  const uid = prop('UID')?.value.trim()

  return {
    ok: true,
    invitation: {
      uid: uid ? cut(uid, UID_MAX) : null,
      method,
      title: cut(textOf('SUMMARY').replace(/\s+/g, ' '), TITLE_MAX),
      ...times,
      place: cut(textOf('LOCATION').replace(/\s+/g, ' '), PLACE_MAX),
      notes: cut(notes, NOTES_MAX),
      hints
    }
  }
}
