// #71: invitations from mail (iMIP REQUEST, attached .ics) taken over as own appointments: read
// in the local zone, all-day ends made inclusive, series and unknown zones named, cancellations
// refused, and a second take-over of the same UID updating instead of duplicating.
// Synthetic calendars with example.test addresses only.
import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { container } from 'tsyringe'
import { AppointmentService } from '../src/main/services/AppointmentService'
import { CreateAppointmentInput } from '../src/main/api/schemas/appointment.schema'
import {
  durationSeconds,
  isCalendarPart,
  parseInvitation,
  resolveZone,
  SERIES_HINT,
  type Invitation
} from '../src/main/calendar/invitation'
import {
  calendarText,
  invitationPart,
  withTitle
} from '../src/renderer/src/components/mail/invitationPrefill'
import type { AttachmentInfo } from '../src/main/mailclient/core/types'

import { setupTestDb } from './helpers/setup'

setupTestDb()

const BERLIN = 'Europe/Berlin'

/** A calendar around the given VEVENT lines, CRLF as RFC 5545 has it */
const calendar = (event: string[], { method = 'REQUEST', extra = [] as string[] } = {}) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Example//Test//EN',
    ...(method ? [`METHOD:${method}`] : []),
    ...extra,
    'BEGIN:VEVENT',
    'UID:meeting-1@example.test',
    'ORGANIZER;CN=Example Organizer:mailto:organizer@example.test',
    'ATTENDEE;CN=Example Guest;RSVP=TRUE:mailto:guest@example.test',
    ...event,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n')

const read = (text: string, zone = BERLIN): Invitation => {
  const result = parseInvitation(text, zone)
  if (!result.ok) throw new Error(result.error)
  return result.invitation
}

const refused = (text: string): string => {
  const result = parseInvitation(text, BERLIN)
  if (result.ok) throw new Error('expected a refusal')
  return result.error
}

describe('parseInvitation: times', () => {
  it('reads UTC times in the local zone, winter and summer', () => {
    const winter = read(
      calendar(['SUMMARY:Abstimmung', 'DTSTART:20270115T090000Z', 'DTEND:20270115T100000Z'])
    )
    expect(winter).toMatchObject({
      uid: 'meeting-1@example.test',
      method: 'REQUEST',
      title: 'Abstimmung',
      startDate: '2027-01-15',
      startTime: '10:00',
      endDate: '2027-01-15',
      endTime: '11:00',
      hints: []
    })
    const summer = read(calendar(['DTSTART:20270615T090000Z', 'DTEND:20270615T093000Z']))
    expect(summer).toMatchObject({ startTime: '11:00', endTime: '11:30' })
  })

  it('converts a TZID time into the local zone', () => {
    const fromLondon = read(
      calendar([
        'DTSTART;TZID=Europe/London:20270301T180000',
        'DTEND;TZID=Europe/London:20270301T193000'
      ])
    )
    expect(fromLondon).toMatchObject({ startTime: '19:00', endTime: '20:30' })
    // Across midnight into the next local day
    const fromNewYork = read(
      calendar([
        'DTSTART;TZID=America/New_York:20270301T200000',
        'DTEND;TZID=America/New_York:20270301T210000'
      ])
    )
    expect(fromNewYork).toMatchObject({
      startDate: '2027-03-02',
      startTime: '02:00',
      endDate: '2027-03-02',
      endTime: '03:00'
    })
    // Already the local zone: unchanged
    expect(
      read(
        calendar([
          'DTSTART;TZID=Europe/Berlin:20270301T080000',
          'DTEND;TZID=Europe/Berlin:20270301T090000'
        ])
      )
    ).toMatchObject({ startTime: '08:00', endTime: '09:00' })
  })

  it('knows the Windows zone names Outlook sends, quoted or not', () => {
    const outlook = read(
      calendar([
        'DTSTART;TZID="W. Europe Standard Time":20270510T140000',
        'DTEND;TZID=W. Europe Standard Time:20270510T150000'
      ])
    )
    expect(outlook).toMatchObject({ startTime: '14:00', endTime: '15:00', hints: [] })
    expect(resolveZone('GMT Standard Time')).toBe('Europe/London')
    expect(resolveZone('/mozilla.org/20050126_1/Europe/Vienna')).toBe('Europe/Vienna')
    expect(resolveZone('Nowhere Standard Time')).toBeNull()
  })

  it('keeps the wall time of an unknown zone and says so', () => {
    const unknown = read(
      calendar([
        'DTSTART;TZID=Custom Zone:20270510T140000',
        'DTEND;TZID=Custom Zone:20270510T150000'
      ])
    )
    expect(unknown).toMatchObject({ startTime: '14:00', endTime: '15:00' })
    expect(unknown.hints).toHaveLength(1)
    expect(unknown.hints[0]).toContain('Custom Zone')
  })

  it('takes a floating time as it is, in any zone', () => {
    const text = calendar(['DTSTART:20270510T140000', 'DTEND:20270510T153000'])
    expect(read(text, 'America/New_York')).toMatchObject({ startTime: '14:00', endTime: '15:30' })
  })

  it('makes the exclusive all-day end inclusive', () => {
    const oneDay = read(calendar(['DTSTART;VALUE=DATE:20270704', 'DTEND;VALUE=DATE:20270705']))
    expect(oneDay).toMatchObject({
      startDate: '2027-07-04',
      startTime: null,
      endDate: '2027-07-04',
      endTime: null
    })
    const festival = read(calendar(['DTSTART;VALUE=DATE:20270730', 'DTEND;VALUE=DATE:20270802']))
    expect(festival).toMatchObject({ startDate: '2027-07-30', endDate: '2027-08-01' })
    // Without DTEND: the one day
    expect(read(calendar(['DTSTART;VALUE=DATE:20270704']))).toMatchObject({
      endDate: '2027-07-04'
    })
    // A broken end before the start stays on the start day
    expect(
      read(calendar(['DTSTART;VALUE=DATE:20270704', 'DTEND;VALUE=DATE:20270701']))
    ).toMatchObject({ endDate: '2027-07-04' })
  })

  it('takes DURATION when there is no DTEND', () => {
    expect(read(calendar(['DTSTART:20270115T090000Z', 'DURATION:PT90M']))).toMatchObject({
      startTime: '10:00',
      endTime: '11:30'
    })
    expect(read(calendar(['DTSTART;VALUE=DATE:20270730', 'DURATION:P3D']))).toMatchObject({
      startDate: '2027-07-30',
      endDate: '2027-08-01'
    })
    // Neither: it ends when it begins
    expect(read(calendar(['DTSTART:20270115T090000Z']))).toMatchObject({
      startTime: '10:00',
      endTime: '10:00'
    })
    expect(durationSeconds('P1W')).toBe(7 * 86_400)
    expect(durationSeconds('P1DT2H30M')).toBe(86_400 + 9000)
    expect(durationSeconds('-PT15M')).toBe(-900)
    expect(durationSeconds('P')).toBeNull()
    expect(durationSeconds('soon')).toBeNull()
  })

  it('moves a time in the spring gap forward, never back', () => {
    // 02:30 does not exist in Berlin on 2027-03-28
    const gap = read(
      calendar([
        'DTSTART;TZID=Europe/Berlin:20270328T023000',
        'DTEND;TZID=Europe/Berlin:20270328T040000'
      ])
    )
    expect(gap.startDate).toBe('2027-03-28')
    expect(gap.startTime! >= '03:00').toBe(true)
    expect(gap.endTime).toBe('04:00')
  })
})

describe('parseInvitation: content', () => {
  it('unfolds lines and unescapes text', () => {
    const text = calendar([
      'SUMMARY:Probe\\, Technik\\; Ablauf',
      'LOCATION:Saal 2\\, Beispielstraße 1',
      'DESCRIPTION:Erste Zeile\\nzweite Zeile mit einem sehr langen Text, der umgebr',
      ' ochen wurde\\\\Ende',
      'DTSTART:20270115T090000Z'
    ])
    expect(read(text)).toMatchObject({
      title: 'Probe, Technik; Ablauf',
      place: 'Saal 2, Beispielstraße 1',
      notes: 'Erste Zeile\nzweite Zeile mit einem sehr langen Text, der umgebrochen wurde\\Ende'
    })
  })

  it('reads LF-only files and lower-case component names', () => {
    const text = calendar(['SUMMARY:Kurz', 'DTSTART:20270115T090000Z'])
      .replace(/\r\n/g, '\n')
      .replace('BEGIN:VEVENT', 'BEGIN:vevent')
    expect(read(text).title).toBe('Kurz')
  })

  it('ignores the alarm and time zone parts of the file', () => {
    const text = calendar(
      [
        'SUMMARY:Treffen',
        'DTSTART;TZID=Europe/Berlin:20270115T100000',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Erinnerung des Absenders',
        'TRIGGER:-PT15M',
        'END:VALARM'
      ],
      {
        extra: [
          'BEGIN:VTIMEZONE',
          'TZID:Europe/Berlin',
          'BEGIN:STANDARD',
          'DTSTART:19701025T030000',
          'TZOFFSETFROM:+0200',
          'TZOFFSETTO:+0100',
          'END:STANDARD',
          'END:VTIMEZONE'
        ]
      }
    )
    expect(read(text)).toMatchObject({ startDate: '2027-01-15', startTime: '10:00', notes: '' })
  })

  it('takes the first event of a series and notes that it repeats', () => {
    const series = read(
      calendar([
        'SUMMARY:Wöchentliche Runde',
        'DESCRIPTION:Bitte vorbereiten',
        'DTSTART:20270115T090000Z',
        'RRULE:FREQ=WEEKLY;COUNT=10'
      ])
    )
    expect(series.hints).toEqual([SERIES_HINT])
    expect(series.notes).toBe(`Bitte vorbereiten\n\n${SERIES_HINT}`)
  })

  it('takes the main event before a changed occurrence', () => {
    const text = [
      'BEGIN:VCALENDAR',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      'UID:series@example.test',
      'RECURRENCE-ID:20270122T090000Z',
      'SUMMARY:Verschoben',
      'DTSTART:20270123T090000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:series@example.test',
      'SUMMARY:Runde',
      'DTSTART:20270115T090000Z',
      'RRULE:FREQ=WEEKLY',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
    expect(read(text)).toMatchObject({
      title: 'Runde',
      startDate: '2027-01-15',
      hints: [SERIES_HINT]
    })
  })

  it('says when a file holds several events', () => {
    const text = calendar(['DTSTART:20270115T090000Z']).replace(
      'END:VCALENDAR',
      'BEGIN:VEVENT\r\nUID:other@example.test\r\nDTSTART:20270116T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR'
    )
    const first = read(text)
    expect(first.startDate).toBe('2027-01-15')
    expect(first.hints).toEqual(['Die Datei enthält 2 Termine, übernommen wird der erste.'])
  })

  it('cuts what is longer than an appointment holds', () => {
    const text = calendar([`SUMMARY:${'x'.repeat(300)}`, 'DTSTART:20270115T090000Z'])
    expect(read(text).title).toHaveLength(200)
  })

  it('reads a published calendar without METHOD', () => {
    expect(read(calendar(['DTSTART:20270115T090000Z'], { method: '' })).method).toBeNull()
  })
})

describe('parseInvitation: refusals', () => {
  it('refuses a cancellation and a reply', () => {
    expect(refused(calendar(['DTSTART:20270115T090000Z'], { method: 'CANCEL' }))).toContain(
      'sagt einen Termin ab'
    )
    expect(refused(calendar(['DTSTART:20270115T090000Z'], { method: 'REPLY' }))).toContain(
      'Antwort'
    )
  })

  it('refuses a file without an event or without a start', () => {
    expect(refused('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n')).toContain('keinen Termin')
    expect(refused('not a calendar at all')).toContain('keinen Termin')
    expect(refused(calendar(['SUMMARY:Ohne Beginn']))).toContain('keinen gültigen Beginn')
    expect(refused(calendar(['DTSTART:morgen']))).toContain('keinen gültigen Beginn')
  })
})

describe('the invitation in a mail', () => {
  const part = (over: Partial<AttachmentInfo>): AttachmentInfo => ({
    partId: '2',
    filename: '',
    contentType: 'application/octet-stream',
    sizeBytes: 100,
    isInline: false,
    contentId: null,
    ...over
  })

  it('finds a text/calendar part or an attached .ics', () => {
    expect(isCalendarPart({ contentType: 'text/calendar', filename: '' })).toBe(true)
    expect(isCalendarPart({ contentType: 'application/ics', filename: '' })).toBe(true)
    expect(
      isCalendarPart({ contentType: 'application/octet-stream', filename: 'invite.ICS' })
    ).toBe(true)
    expect(isCalendarPart({ contentType: 'text/plain', filename: 'notes.txt' })).toBe(false)
  })

  it('prefers the iMIP part over an attached copy', () => {
    const attached = part({ partId: '3', filename: 'invite.ics' })
    const imip = part({ partId: '2', contentType: 'text/calendar' })
    expect(invitationPart([attached, imip])?.partId).toBe('2')
    expect(invitationPart([attached])?.partId).toBe('3')
    expect(invitationPart([part({ filename: 'offer.pdf' })])).toBeNull()
  })

  it('decodes UTF-8 and drops a byte order mark', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('BEGIN:Ü')])
    expect(calendarText(bytes)).toBe('BEGIN:Ü')
  })

  it('takes the subject as title when the event has none', () => {
    const invitation = read(calendar(['DTSTART:20270115T090000Z']))
    expect(withTitle(invitation, 'WG: Einladung: Abstimmung').title).toBe('Einladung: Abstimmung')
    expect(withTitle({ ...invitation, title: 'Eigener' }, 'Betreff').title).toBe('Eigener')
  })
})

describe('taking an invitation over twice', () => {
  const service = () => container.resolve(AppointmentService)
  const times = {
    startDate: '2027-01-15',
    startTime: '10:00',
    endDate: '2027-01-15',
    endTime: '11:00'
  }

  it('remembers the UID, finds it again and refuses a duplicate', () => {
    const own = service().create(CreateAppointmentInput.parse({ title: 'Eigener', ...times }))
    expect(own.icalUid).toBeNull()

    const taken = service().create(
      CreateAppointmentInput.parse({ title: 'Abstimmung', ...times, icalUid: 'twice@example.test' })
    )
    expect(taken.icalUid).toBe('twice@example.test')
    expect(service().getByIcalUid('twice@example.test')?.id).toBe(taken.id)
    expect(service().getByIcalUid('unknown@example.test')).toBeNull()

    expect(() =>
      service().create(
        CreateAppointmentInput.parse({ title: 'Nochmal', ...times, icalUid: 'twice@example.test' })
      )
    ).toThrow('schon als Termin')

    // The update path the dialog takes keeps the UID
    service().update({
      id: taken.id,
      title: 'Abstimmung (verschoben)',
      startTime: '12:00',
      endTime: '13:00'
    })
    expect(service().getByIcalUid('twice@example.test')).toMatchObject({
      id: taken.id,
      title: 'Abstimmung (verschoben)',
      startTime: '12:00'
    })
  })
})
