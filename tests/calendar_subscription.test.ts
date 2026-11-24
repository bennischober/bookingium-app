// #53: subscribed calendars (reading ICS feeds with recurrences and time zones, the service
// that fetches and caches them) and the public address of the Bookingium calendar file.
import 'reflect-metadata'
import { describe, it, expect, beforeEach } from 'vitest'
import { container } from 'tsyringe'
import { db } from '../src/main/db/index'
import { schema } from '../src/main/db/schema'
import { entriesBetween, parseFeed, zonedToEpoch } from '../src/main/calendar/subscribed'
import {
  directDownloadUrl,
  feedFetchUrl,
  inspectFeedFile,
  parseFeedAddress
} from '../src/main/calendar/shareLink'
import { buildCalendar } from '../src/main/calendar/ics'
import { FeedFetcher } from '../src/main/services/FeedFetcher'
import { CalendarSubscriptionService } from '../src/main/services/CalendarSubscriptionService'
import { CalendarFeedService, isInCloudFolder } from '../src/main/services/CalendarFeedService'
import { SettingsService } from '../src/main/services/SettingsService'
import { LOCAL_TABLES } from '../src/main/sync/tables'
import { setupTestDb } from './helpers/setup'

setupTestDb()

const ics = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Example//Test//EN', ...lines, 'END:VCALENDAR'].join(
    '\r\n'
  )

const BERLIN_TZ = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
]

const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']

describe('reading a subscribed feed', () => {
  it('rejects text that is no calendar', () => {
    expect(() => parseFeed('<!doctype html><html>Sign in</html>')).toThrow(/kein Kalender/)
  })

  it('reads the name, a timed and an all-day entry', () => {
    const feed = parseFeed(
      ics(
        'X-WR-CALNAME:Team',
        ...BERLIN_TZ,
        ...vevent(
          'UID:a@example.test',
          'DTSTART;TZID=Europe/Berlin:20260611T190000',
          'DTEND;TZID=Europe/Berlin:20260611T203000',
          'SUMMARY:Probe',
          'LOCATION:Proberaum\\, Musterstraße 1'
        ),
        ...vevent(
          'UID:b@example.test',
          'DTSTART;VALUE=DATE:20260612',
          'DTEND;VALUE=DATE:20260614',
          'SUMMARY:Festival'
        )
      )
    )
    expect(feed.name).toBe('Team')
    expect(feed.eventCount).toBe(2)
    const entries = entriesBetween(feed, '2026-06-01', '2026-06-30', 'Europe/Berlin')
    expect(entries).toEqual([
      expect.objectContaining({
        title: 'Probe',
        location: 'Proberaum, Musterstraße 1',
        startDate: '2026-06-11',
        startTime: '19:00',
        endDate: '2026-06-11',
        endTime: '20:30',
        cancelled: false
      }),
      expect.objectContaining({
        title: 'Festival',
        startDate: '2026-06-12',
        endDate: '2026-06-13',
        startTime: null,
        endTime: null
      })
    ])
  })

  it('shows times in the given zone (UTC and VTIMEZONE alike)', () => {
    const feed = parseFeed(
      ics(
        ...BERLIN_TZ,
        ...vevent('UID:u@example.test', 'DTSTART:20260115T180000Z', 'SUMMARY:UTC'),
        ...vevent(
          'UID:b@example.test',
          'DTSTART;TZID=Europe/Berlin:20260115T190000',
          'SUMMARY:Berlin'
        )
      )
    )
    const london = entriesBetween(feed, '2026-01-15', '2026-01-15', 'Europe/London')
    expect(london.map((e) => [e.title, e.startTime])).toEqual([
      ['Berlin', '18:00'],
      ['UTC', '18:00']
    ])
    const berlin = entriesBetween(feed, '2026-01-15', '2026-01-15', 'Europe/Berlin')
    expect(berlin.map((e) => e.startTime)).toEqual(['19:00', '19:00'])
  })

  it('takes a TZID without VTIMEZONE as an IANA zone', () => {
    const feed = parseFeed(
      ics(
        ...vevent(
          'UID:n@example.test',
          'DTSTART;TZID=America/New_York:20260701T090000',
          'DTEND;TZID=America/New_York:20260701T100000',
          'SUMMARY:Call'
        )
      )
    )
    const [entry] = entriesBetween(feed, '2026-07-01', '2026-07-01', 'Europe/Berlin')
    expect([entry.startTime, entry.endTime]).toEqual(['15:00', '16:00'])
  })

  it('takes an Outlook (Windows) zone name without VTIMEZONE', () => {
    const feed = parseFeed(
      ics(
        ...vevent(
          'UID:w@example.test',
          'DTSTART;TZID=W. Europe Standard Time:20260115T190000',
          'SUMMARY:Outlook'
        )
      )
    )
    expect(entriesBetween(feed, '2026-01-15', '2026-01-15', 'UTC')[0].startTime).toBe('18:00')
  })

  it('keeps floating times as written', () => {
    const feed = parseFeed(
      ics(...vevent('UID:f@example.test', 'DTSTART:20260611T210000', 'SUMMARY:Show'))
    )
    expect(entriesBetween(feed, '2026-06-11', '2026-06-11', 'Asia/Tokyo')[0].startTime).toBe(
      '21:00'
    )
  })

  it('expands a weekly series with an excluded and a moved occurrence', () => {
    const feed = parseFeed(
      ics(
        ...BERLIN_TZ,
        ...vevent(
          'UID:s@example.test',
          'DTSTART;TZID=Europe/Berlin:20260302T100000',
          'DTEND;TZID=Europe/Berlin:20260302T110000',
          'RRULE:FREQ=WEEKLY;COUNT=6',
          'EXDATE;TZID=Europe/Berlin:20260316T100000',
          'SUMMARY:Jour fixe'
        ),
        ...vevent(
          'UID:s@example.test',
          'RECURRENCE-ID;TZID=Europe/Berlin:20260323T100000',
          'DTSTART;TZID=Europe/Berlin:20260324T140000',
          'DTEND;TZID=Europe/Berlin:20260324T150000',
          'SUMMARY:Jour fixe (verschoben)'
        )
      )
    )
    const entries = entriesBetween(feed, '2026-03-01', '2026-04-30', 'Europe/Berlin')
    expect(entries.map((e) => `${e.startDate} ${e.startTime} ${e.title}`)).toEqual([
      '2026-03-02 10:00 Jour fixe',
      '2026-03-09 10:00 Jour fixe',
      '2026-03-24 14:00 Jour fixe (verschoben)',
      // Summer time began on 29 March: still 10:00 on the wall clock
      '2026-03-30 10:00 Jour fixe',
      '2026-04-06 10:00 Jour fixe'
    ])
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length)
  })

  it('reaches today in an endless series started long ago, and only asks for the range', () => {
    const feed = parseFeed(
      ics(
        ...vevent(
          'UID:d@example.test',
          'DTSTART;VALUE=DATE:20000101',
          'RRULE:FREQ=DAILY',
          'SUMMARY:Täglich'
        )
      )
    )
    const entries = entriesBetween(feed, '2026-11-01', '2026-11-07', 'Europe/Berlin')
    expect(entries.map((e) => e.startDate)).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07'
    ])
  })

  it('marks cancelled entries and covers entries running into the range', () => {
    const feed = parseFeed(
      ics(
        ...vevent(
          'UID:c@example.test',
          'DTSTART;VALUE=DATE:20260528',
          'DTEND;VALUE=DATE:20260603',
          'STATUS:CANCELLED',
          'SUMMARY:Tour'
        )
      )
    )
    const [entry] = entriesBetween(feed, '2026-06-01', '2026-06-30', 'Europe/Berlin')
    expect(entry).toMatchObject({ startDate: '2026-05-28', endDate: '2026-06-02', cancelled: true })
  })

  it('computes wall-clock instants across DST', () => {
    const summer = zonedToEpoch(
      { year: 2026, month: 7, day: 1, hour: 12, minute: 0 },
      'Europe/Berlin'
    )
    expect(new Date(summer).toISOString()).toBe('2026-07-01T10:00:00.000Z')
  })
})

describe('subscription addresses', () => {
  it('turns webcal into https and refuses other schemes', () => {
    expect(feedFetchUrl('webcal://p01-calendars.icloud.example.test/published/2/abc')).toBe(
      'https://p01-calendars.icloud.example.test/published/2/abc'
    )
    expect(parseFeedAddress('file:///C:/Bookingium.ics')).toBeNull()
    expect(parseFeedAddress('kein link')).toBeNull()
  })

  it('makes direct download addresses from share links', () => {
    expect(
      directDownloadUrl('https://www.dropbox.com/scl/fi/abc/Bookingium.ics?rlkey=x&dl=0')
    ).toEqual({
      url: 'https://www.dropbox.com/scl/fi/abc/Bookingium.ics?rlkey=x&dl=1',
      provider: 'dropbox'
    })
    expect(directDownloadUrl('https://drive.google.com/file/d/FILE123/view?usp=sharing')).toEqual({
      url: 'https://drive.google.com/uc?export=download&id=FILE123',
      provider: 'googledrive'
    })
    expect(
      directDownloadUrl('https://contoso.sharepoint.com/:u:/g/personal/x/EAbc?e=Xy')?.url
    ).toBe('https://contoso.sharepoint.com/:u:/g/personal/x/EAbc?e=Xy&download=1')
    const onedrive = directDownloadUrl('https://1drv.ms/u/s!AbCdEf')
    expect(onedrive?.provider).toBe('onedrive')
    expect(onedrive?.url).toBe(
      `https://api.onedrive.com/v1.0/shares/u!${Buffer.from('https://1drv.ms/u/s!AbCdEf')
        .toString('base64')
        .replace(/=+$/, '')
        .replace(/\//g, '_')
        .replace(/\+/g, '-')}/root/content`
    )
    expect(directDownloadUrl('https://cloud.example.test/Bookingium.ics')).toEqual({
      url: 'https://cloud.example.test/Bookingium.ics',
      provider: 'other'
    })
  })

  it('recognises the Bookingium file and its write time', () => {
    const now = new Date('2026-11-24T09:30:00Z')
    const file = buildCalendar(
      [
        {
          id: 1,
          name: 'Show',
          date: '2026-12-01',
          performanceTime: '',
          performanceDuration: '',
          status: 'confirmed',
          bandName: null,
          venueName: null,
          venueAddress: null,
          hotelName: null,
          deal: '',
          notes: '',
          updatedAt: null
        }
      ],
      now
    )
    expect(inspectFeedFile(file)).toEqual({
      isBookingium: true,
      events: 1,
      writtenAt: '2026-11-24T09:30:00.000Z'
    })
    expect(inspectFeedFile(ics()).isBookingium).toBe(false)
  })

  it('knows whether a file lies in a cloud folder', () => {
    const roots = ['C:\\Users\\muster\\OneDrive', 'C:\\Users\\muster\\Dropbox']
    expect(isInCloudFolder('C:\\Users\\muster\\OneDrive\\Kalender\\Bookingium.ics', roots)).toBe(
      true
    )
    expect(isInCloudFolder('c:/users/muster/dropbox/Bookingium.ics', roots)).toBe(true)
    expect(isInCloudFolder('C:\\Users\\muster\\OneDriveAlt\\Bookingium.ics', roots)).toBe(false)
    expect(isInCloudFolder('C:\\Users\\muster\\Documents\\Bookingium.ics', roots)).toBe(false)
  })
})

describe('subscription service', () => {
  const fetcher = container.resolve(FeedFetcher)
  const service = container.resolve(CalendarSubscriptionService)
  let served: Record<string, { status: number; body: string }> = {}
  const requested: string[] = []

  beforeEach(() => {
    db.delete(schema.calendar_subscription).run()
    served = {}
    requested.length = 0
    fetcher.fetch = async (url) => {
      requested.push(url)
      const answer = served[url]
      if (!answer) throw new TypeError('fetch failed')
      return new Response(answer.body, { status: answer.status })
    }
  })

  const team = ics(
    'X-WR-CALNAME:Team',
    ...vevent('UID:t1@example.test', 'DTSTART;VALUE=DATE:20260611', 'SUMMARY:Probe')
  )

  it('keeps the cache machine-local', () => {
    expect(LOCAL_TABLES.has('calendar_subscription_cache')).toBe(true)
    expect(LOCAL_TABLES.has('calendar_subscription')).toBe(false)
  })

  it('subscribes by webcal address, named after the feed', async () => {
    served['https://cal.example.test/team.ics'] = { status: 200, body: team }
    const created = await service.create({ url: 'webcal://cal.example.test/team.ics' })
    expect(requested).toEqual(['https://cal.example.test/team.ics'])
    expect(created).toMatchObject({
      name: 'Team',
      url: 'webcal://cal.example.test/team.ics',
      enabled: true,
      error: '',
      eventCount: 1
    })
    expect(created.fetchedAt).not.toBeNull()
    const entries = service.entriesBetween('2026-06-01', '2026-06-30')
    expect(entries).toEqual([
      expect.objectContaining({
        title: 'Probe',
        subscriptionId: created.id,
        subscriptionName: 'Team',
        color: created.color,
        startDate: '2026-06-11'
      })
    ])
  })

  it('refuses an address without a calendar and saves nothing', async () => {
    served['https://cal.example.test/login'] = { status: 200, body: '<html>Login</html>' }
    await expect(service.create({ url: 'https://cal.example.test/login' })).rejects.toThrow(
      /kein Kalender/
    )
    served['https://cal.example.test/private.ics'] = { status: 403, body: '' }
    await expect(service.create({ url: 'https://cal.example.test/private.ics' })).rejects.toThrow(
      /Kein Zugriff/
    )
    await expect(service.create({ url: 'ftp://cal.example.test/x.ics' })).rejects.toThrow(
      /Keine gültige Adresse/
    )
    expect(service.list()).toEqual([])
  })

  it('keeps the last good feed when a refresh fails, and takes a new one when it works', async () => {
    const url = 'https://cal.example.test/team.ics'
    served[url] = { status: 200, body: team }
    const { id } = await service.create({ url, name: 'Mein Team' })

    served[url] = { status: 500, body: '' }
    const [failed] = await service.refresh()
    expect(failed.error).toMatch(/HTTP 500/)
    expect(service.entriesBetween('2026-06-01', '2026-06-30')).toHaveLength(1)

    served[url] = {
      status: 200,
      body: ics(...vevent('UID:t2@example.test', 'DTSTART;VALUE=DATE:20260620', 'SUMMARY:Gig'))
    }
    const [ok] = await service.refresh(id)
    expect(ok).toMatchObject({ name: 'Mein Team', error: '' })
    expect(service.entriesBetween('2026-06-01', '2026-06-30').map((e) => e.title)).toEqual(['Gig'])
  })

  it('leaves switched-off subscriptions out, and deleting drops the cache', async () => {
    const url = 'https://cal.example.test/team.ics'
    served[url] = { status: 200, body: team }
    const { id } = await service.create({ url })
    service.update({ id, enabled: false, color: '#123456' })
    expect(service.entriesBetween('2026-06-01', '2026-06-30')).toEqual([])
    expect(service.list()[0]).toMatchObject({ enabled: false, color: '#123456' })

    expect(service.remove(id)).toBe(true)
    expect(db.select().from(schema.calendar_subscription_cache).all()).toEqual([])
    expect(service.update({ id, name: 'weg' })).toBeNull()
  })

  it('fetches a subscription that arrived through sync when the calendar asks', async () => {
    const url = 'https://cal.example.test/team.ics'
    served[url] = { status: 200, body: team }
    db.insert(schema.calendar_subscription).values({ name: 'Vom Laptop', url }).run()
    expect(service.entriesBetween('2026-06-01', '2026-06-30')).toEqual([])
    await service.refresh()
    expect(service.entriesBetween('2026-06-01', '2026-06-30')).toHaveLength(1)
  })
})

describe('share link check', () => {
  const fetcher = container.resolve(FeedFetcher)
  const feed = container.resolve(CalendarFeedService)
  const settings = container.resolve(SettingsService)

  it('confirms the Bookingium file behind a Dropbox link and keeps the link', async () => {
    const body = buildCalendar([], new Date())
    fetcher.fetch = async (url) =>
      url === 'https://www.dropbox.com/s/abc/Bookingium.ics?dl=1'
        ? new Response(body, { status: 200 })
        : new Response('', { status: 404 })
    const result = await feed.checkShareLink('https://www.dropbox.com/s/abc/Bookingium.ics?dl=0')
    expect(result).toMatchObject({
      ok: true,
      provider: 'dropbox',
      subscribeUrl: 'https://www.dropbox.com/s/abc/Bookingium.ics?dl=1',
      error: ''
    })
    expect(settings.get().calendarFeedShareUrl).toBe(
      'https://www.dropbox.com/s/abc/Bookingium.ics?dl=0'
    )
    expect(feed.status()).toMatchObject({
      shareUrl: 'https://www.dropbox.com/s/abc/Bookingium.ics?dl=0',
      subscribeUrl: 'https://www.dropbox.com/s/abc/Bookingium.ics?dl=1'
    })
    expect(feed.clearShareLink()).toMatchObject({ shareUrl: '', subscribeUrl: '' })
  })

  it('says when the link serves a page instead of the file', async () => {
    fetcher.fetch = async () => new Response('<html>Preview</html>', { status: 200 })
    const result = await feed.checkShareLink('https://cloud.example.test/s/Bookingium')
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/nicht die Bookingium-Kalender-Datei/)
  })
})
