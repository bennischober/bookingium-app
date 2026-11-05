// Map preview (#102): postcode lookup, marker building (filters, unlocated
// rows) and the radius clauses (blocked venues, the what-if booking). Pure helpers - no database. The postcode table is the real generated
// one; a handful of well-known codes anchor it (Berlin 10115, München 80331,
// Innsbruck 6020, Zürich 8001).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildMapData,
  formatAddressLabel,
  kindShown,
  locate,
  type MapEventRow,
  type MapVenueRow
} from '../src/main/map/markers'
import { lookupPostcode } from '../src/main/map/postcodeLookup'
import {
  clauseWindow,
  distanceKm,
  effectiveClause,
  isIsoDate,
  shiftIsoDate,
  windowOverlaps
} from '../src/main/map/radius'
import {
  groupByPoint,
  markerColor,
  markerHref,
  pointPopupHtml,
  pointRings,
  pointTitle,
  POPUP_EVENT_LIMIT,
  ringColor,
  ringMetres,
  venueAvailability,
  UNLOCATED_REASON_LABELS
} from '../src/renderer/src/components/map/mapDisplay'
import {
  formatClause,
  inheritClause,
  parseClauseDraft,
  parseOverrideDraft
} from '../src/renderer/src/components/map/radiusDisplay'
import type { MapMarkerDto } from '../src/main/api/schemas/map.schema'
import { TILE_REQUEST_URLS, tileUserAgent } from '../src/main/map/tileRequests'
import { getGroupedRoutes, getRouteShortcut, ROUTES } from '../src/renderer/src/lib/routing'

const address = (
  parts: Partial<MapEventRow['address']> = {}
): NonNullable<MapEventRow['address']> => ({
  // An obviously invented street (the PII guard's rule: Muster|Beispiel)
  street: 'Musterstraße',
  street_number: '1',
  zip_code: '10115',
  city: 'Berlin',
  country: 'Deutschland',
  country_code: 'DE',
  ...parts
})

const event = (parts: Partial<MapEventRow> = {}): MapEventRow => ({
  id: 1,
  name: 'Show',
  date: '2026-05-01',
  status: 'confirmed',
  band_id: 1,
  venue_id: 10,
  venue_kind: 'venue',
  address: address(),
  ...parts
})

const venue = (parts: Partial<MapVenueRow> = {}): MapVenueRow => ({
  id: 10,
  name: 'Club Berlin',
  kind: 'venue',
  address: address(),
  ...parts
})

describe('lookupPostcode', () => {
  it('resolves known DE/AT/CH postcodes', () => {
    expect(lookupPostcode('DE', '10115')).toEqual({ lat: 52.5323, lng: 13.3846 })
    expect(lookupPostcode('de', '80331')).toEqual({ lat: 48.1345, lng: 11.571 })
    expect(lookupPostcode('AT', '6020')).toEqual({ lat: 47.2477, lng: 11.3978 })
    expect(lookupPostcode('CH', '8001')).toEqual({ lat: 47.3721, lng: 8.5417 })
  })

  it('rejects what it cannot resolve', () => {
    // Unknown postcode, unknown country, no country, no postcode
    expect(lookupPostcode('DE', '00000')).toBeNull()
    expect(lookupPostcode('FR', '75001')).toBeNull()
    expect(lookupPostcode('', '10115')).toBeNull()
    expect(lookupPostcode('DE', '')).toBeNull()
    expect(lookupPostcode('DE', '  ')).toBeNull()
  })
})

describe('formatAddressLabel', () => {
  it('joins street and place, leaving empty parts out', () => {
    expect(formatAddressLabel(address())).toBe('Musterstraße 1, 10115 Berlin')
    expect(formatAddressLabel(address({ street: '', street_number: '' }))).toBe('10115 Berlin')
    expect(formatAddressLabel(address({ zip_code: '', city: '' }))).toBe('Musterstraße 1')
    expect(
      formatAddressLabel(address({ street: '', street_number: '', zip_code: '', city: '' }))
    ).toBe('')
  })
})

describe('radius clauses', () => {
  const club = { km: 100, weeksBefore: 4, weeksAfter: 4 }
  const none = { radius_km: null, radius_weeks_before: null, radius_weeks_after: null }

  it('take the event, else the venue, else the default - per field', () => {
    expect(effectiveClause(null, null, club)).toEqual(club)
    expect(effectiveClause(none, { ...none, radius_km: 60 }, club)).toEqual({ ...club, km: 60 })
    expect(
      effectiveClause(
        { ...none, radius_weeks_after: 2 },
        { radius_km: 60, radius_weeks_before: 6, radius_weeks_after: 6 },
        club
      )
    ).toEqual({ km: 60, weeksBefore: 6, weeksAfter: 2 })
    // 0 weeks is a real value, not "inherit"
    expect(effectiveClause({ ...none, radius_weeks_before: 0 }, null, club).weeksBefore).toBe(0)
  })

  it('apply to a date as a window, across months and years', () => {
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftIsoDate('2026-12-30', 7)).toBe('2027-01-06')
    expect(clauseWindow('2026-05-01', club)).toEqual({
      km: 100,
      from: '2026-04-03',
      to: '2026-05-29'
    })
  })

  it('overlap a date range with open sides', () => {
    const window = { km: 100, from: '2026-04-03', to: '2026-05-29' }
    expect(windowOverlaps(window)).toBe(true)
    expect(windowOverlaps(window, '2026-05-29')).toBe(true)
    expect(windowOverlaps(window, '2026-05-30')).toBe(false)
    expect(windowOverlaps(window, undefined, '2026-04-02')).toBe(false)
    expect(windowOverlaps(window, '2026-01-01', '2026-04-03')).toBe(true)
  })

  it('measure great-circle distances', () => {
    // Berlin 10115 - München 80331: about 506 km as the crow flies
    const berlin = lookupPostcode('DE', '10115')!
    const munich = lookupPostcode('DE', '80331')!
    expect(Math.round(distanceKm(berlin, munich))).toBe(506)
    expect(distanceKm(berlin, berlin)).toBe(0)
  })
})

describe('kindShown', () => {
  it('shows everything without a filter, otherwise only the chosen kinds', () => {
    expect(kindShown(undefined, 'venue')).toBe(true)
    expect(kindShown([], 'festival')).toBe(true)
    expect(kindShown(['venue'], 'venue')).toBe(true)
    expect(kindShown(['venue'], 'festival')).toBe(false)
  })
})

describe('buildMapData', () => {
  it('builds one marker per event and per venue', () => {
    const data = buildMapData([event()], [venue()], {})
    expect(data.markers).toHaveLength(2)
    const eventMarker = data.markers.find((marker) => marker.type === 'event')!
    expect(eventMarker).toMatchObject({
      id: 1,
      kind: 'venue',
      name: 'Show',
      date: '2026-05-01',
      bandIds: [1],
      located: true,
      lat: 52.5323,
      lng: 13.3846,
      addressLabel: 'Musterstraße 1, 10115 Berlin'
    })
    const venueMarker = data.markers.find((marker) => marker.type === 'venue')!
    expect(venueMarker).toMatchObject({ type: 'venue', id: 10, kind: 'venue', bandIds: [1] })
    expect(data.unlocated).toEqual([])
  })

  it('leaves cancelled events out', () => {
    const data = buildMapData([event({ status: 'cancelled' })], [venue()], {})
    expect(data.markers.map((marker) => marker.type)).toEqual(['venue'])
  })

  it('applies the kind filter to events and venues', () => {
    const festivalEvent = event({
      id: 2,
      venue_kind: 'festival',
      address: address({ zip_code: '8001', country_code: 'CH' })
    })
    const festivalVenue = venue({
      id: 20,
      kind: 'festival',
      name: 'Open Air',
      address: address({ zip_code: '8001', country_code: 'CH' })
    })
    const data = buildMapData([event(), festivalEvent], [venue(), festivalVenue], {
      kinds: ['festival']
    })
    expect(data.markers.map((marker) => marker.id)).toEqual([2, 20])
  })

  it('applies the band filter to events and keeps every venue', () => {
    const otherBand = event({ id: 3, band_id: 2 })
    const elsewhere = venue({
      id: 11,
      name: 'Club München',
      address: address({ zip_code: '80331' })
    })
    const data = buildMapData([event(), otherBand], [venue(), elsewhere], { bandId: 1 })
    // The band's event, and every venue - free or blocked, the band could play there
    expect(data.markers.map((marker) => marker.id)).toEqual([1, 10, 11])
    expect(data.markers.find((marker) => marker.id === 10)!.bandIds).toEqual([1])
    expect(data.markers.find((marker) => marker.id === 11)!.bandIds).toEqual([])
  })

  it('shows an event while its clause window overlaps the date range', () => {
    // Club default: 4 weeks either side of 2026-05-01 -> 2026-04-03 .. 2026-05-29
    const later = event({ id: 4, date: '2026-08-20' })
    const inRange = buildMapData([event(), later], [venue()], {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31'
    })
    expect(
      inRange.markers.filter((marker) => marker.type === 'event').map((marker) => marker.id)
    ).toEqual([4])
    // After the show, but inside its window: it still blocks the start of the range
    const afterShow = buildMapData([event()], [venue()], { dateFrom: '2026-05-20' })
    expect(afterShow.markers.find((marker) => marker.type === 'event')).toMatchObject({
      id: 1,
      ring: { km: 100, from: '2026-04-03', to: '2026-05-29' }
    })
    expect(buildMapData([event()], [venue()], { dateFrom: '2026-05-30' }).markers).toHaveLength(1)
  })

  it('gives each event the ring of its clause: event, venue, then the kind default', () => {
    const defaults = {
      club: { km: 80, weeksBefore: 2, weeksAfter: 2 },
      festival: { km: 250, weeksBefore: 6, weeksAfter: 6 }
    }
    const none = { radius_km: null, radius_weeks_before: null, radius_weeks_after: null }
    const data = buildMapData(
      [
        event({ id: 1 }),
        event({ id: 2, venue_kind: 'festival' }),
        event({ id: 3, venue_radius: { ...none, radius_km: 50 } }),
        event({
          id: 4,
          radius: { ...none, radius_km: 30 },
          venue_radius: { ...none, radius_km: 50 }
        })
      ],
      [],
      {},
      defaults
    )
    expect(data.markers.map((marker) => [marker.id, marker.ring!.km])).toEqual([
      [1, 80],
      [2, 250],
      [3, 50],
      [4, 30]
    ])
    expect(data.markers[1].ring).toMatchObject({ from: '2026-03-20', to: '2026-06-12' })
  })

  it('lists events and venues without a known postcode as unlocated', () => {
    const unknownZip = event({ id: 5, address: address({ zip_code: '99999' }), venue_id: null })
    const noAddress = event({ id: 6, address: null, venue_id: null })
    const unlocatedVenue = venue({ id: 30, name: 'Ohne PLZ', address: address({ zip_code: '' }) })
    const data = buildMapData([unknownZip, noAddress], [unlocatedVenue], {})
    expect(data.markers.filter((marker) => !marker.located).map((marker) => marker.id)).toEqual([
      5, 6, 30
    ])
    expect(data.unlocated).toEqual([
      { type: 'event', id: 5, kind: 'venue', name: 'Show', reason: 'no_venue' },
      { type: 'event', id: 6, kind: 'venue', name: 'Show', reason: 'no_venue' },
      { type: 'venue', id: 30, kind: 'venue', name: 'Ohne PLZ', reason: 'unknown_postcode' }
    ])
  })

  it('collects the bands that played at a venue across events', () => {
    const secondBand = event({ id: 7, band_id: 2 })
    const data = buildMapData([event(), secondBand], [venue()], {})
    expect(data.markers.find((marker) => marker.type === 'venue')!.bandIds).toEqual([1, 2])
  })

  it('marks an event without an address (no venue) as unlocated', () => {
    const data = buildMapData([event({ venue_id: null, address: null })], [], {})
    expect(data.markers[0].located).toBe(false)
    expect(data.markers[0].addressLabel).toBe('')
    expect(data.unlocated).toEqual([
      { type: 'event', id: 1, kind: 'venue', name: 'Show', reason: 'no_venue' }
    ])
  })

  it('says why: a venue without an address, an unknown postcode', () => {
    const atVenue = { venue_id: 10, venue_kind: 'festival' }
    const data = buildMapData(
      [
        event({ id: 2, ...atVenue, address: null }),
        event({ id: 3, ...atVenue, address: address({ zip_code: '00000' }) })
      ],
      [],
      {}
    )
    expect(data.unlocated.map(({ id, kind, reason }) => [id, kind, reason])).toEqual([
      [2, 'festival', 'no_address'],
      [3, 'festival', 'unknown_postcode']
    ])
  })
})

describe('room for the band', () => {
  // Berlin 10115 and Potsdam 14467 are ~26 km apart; München 80331 ~506 km from Berlin
  const potsdam = venue({ id: 11, name: 'Club Potsdam', address: address({ zip_code: '14467' }) })
  const munich = venue({ id: 12, name: 'Club München', address: address({ zip_code: '80331' }) })
  const venueById = (data: ReturnType<typeof buildMapData>, id: number) =>
    data.markers.find((marker) => marker.type === 'venue' && marker.id === id)!

  it('blocks the venues inside a confirmed ring, leaves the rest free', () => {
    const data = buildMapData([event()], [venue(), potsdam, munich], { bandId: 1 })
    const block = { eventId: 1, name: 'Show', date: '2026-05-01' }
    expect(venueById(data, 10)).toMatchObject({ blockedBy: [block], riskBy: [] })
    expect(venueById(data, 11)).toMatchObject({ blockedBy: [block], riskBy: [] })
    expect(venueById(data, 12)).toMatchObject({ blockedBy: [], riskBy: [] })
  })

  it('counts open offers as a risk, not a block', () => {
    const data = buildMapData([event({ status: 'pending' })], [potsdam], { bandId: 1 })
    expect(venueById(data, 11)).toMatchObject({
      blockedBy: [],
      riskBy: [{ eventId: 1, name: 'Show', date: '2026-05-01' }]
    })
    expect(data.markers.find((marker) => marker.type === 'event')!.status).toBe('pending')
  })

  it('only blocks with a band chosen, and only by that band', () => {
    expect(venueById(buildMapData([event()], [potsdam], {}), 11).blockedBy).toBeUndefined()
    const otherBand = buildMapData([event({ band_id: 2 })], [potsdam], { bandId: 1 })
    expect(venueById(otherBand, 11).blockedBy).toEqual([])
  })

  it('stops blocking outside the window', () => {
    const data = buildMapData([event()], [potsdam], { bandId: 1, dateFrom: '2026-06-01' })
    expect(venueById(data, 11).blockedBy).toEqual([])
  })

  it('blocks clubs by a festival ring while the map shows only clubs', () => {
    const festival = event({ id: 2, name: 'Fest', venue_kind: 'festival' })
    const data = buildMapData([festival], [potsdam], { bandId: 1, kinds: ['venue'] })
    expect(data.markers.some((marker) => marker.type === 'event')).toBe(false)
    expect(venueById(data, 11).blockedBy).toEqual([
      { eventId: 2, name: 'Fest', date: '2026-05-01' }
    ])
  })
})

describe('what-if booking', () => {
  const potsdam = venue({ id: 11, name: 'Club Potsdam', address: address({ zip_code: '14467' }) })
  const munich = venue({ id: 12, name: 'Club München', address: address({ zip_code: '80331' }) })
  const festival = venue({
    id: 13,
    name: 'Open Air',
    kind: 'festival',
    address: address({ zip_code: '80331' })
  })

  it('draws the candidate ring and lists the venues it would block, nearest first', () => {
    const data = buildMapData([], [venue(), potsdam, munich], {
      candidate: { venueId: 11, date: '2026-07-01' }
    })
    expect(data.candidate).toMatchObject({
      venueId: 11,
      name: 'Club Potsdam',
      ring: { km: 100, from: '2026-06-03', to: '2026-07-29' },
      located: true,
      conflicts: []
    })
    expect(data.candidate!.blocks).toEqual([
      { id: 10, name: 'Club Berlin', kind: 'venue', distanceKm: 26 }
    ])
  })

  it('finds the band events it collides with, in both directions', () => {
    const events = [
      // Inside the candidate's 100 km / 4 weeks: the candidate would cover it
      event({ id: 1, date: '2026-07-10' }),
      // A festival 300 km / 8 weeks clause in München covers a München candidate
      event({
        id: 2,
        date: '2026-08-20',
        venue_id: 13,
        venue_kind: 'festival',
        address: address({ zip_code: '80331' })
      }),
      // Another band: never a conflict
      event({ id: 3, band_id: 2, date: '2026-07-02' }),
      // Far away and long after: none
      event({ id: 4, date: '2026-12-01' })
    ]
    const berlin = buildMapData(events, [venue(), potsdam, festival], {
      bandId: 1,
      candidate: { venueId: 11, date: '2026-07-01' }
    })
    expect(berlin.candidate!.conflicts).toEqual([
      {
        eventId: 1,
        name: 'Show',
        date: '2026-07-10',
        status: 'confirmed',
        distanceKm: 26,
        kind: 'both'
      }
    ])
    const munichCandidate = buildMapData(events, [venue(), munich, festival], {
      bandId: 1,
      candidate: { venueId: 12, date: '2026-07-15' }
    })
    expect(munichCandidate.candidate!.conflicts).toEqual([
      {
        eventId: 2,
        name: 'Show',
        date: '2026-08-20',
        status: 'confirmed',
        distanceKm: 0,
        kind: 'event_covers'
      }
    ])
  })

  it('flags a date collision without a location for a check by hand', () => {
    const noVenue = event({ id: 5, venue_id: null, address: null, date: '2026-07-03' })
    const data = buildMapData([noVenue], [potsdam], {
      bandId: 1,
      candidate: { venueId: 11, date: '2026-07-01' }
    })
    expect(data.candidate!.conflicts).toEqual([
      {
        eventId: 5,
        name: 'Show',
        date: '2026-07-03',
        status: 'confirmed',
        distanceKm: null,
        kind: 'unknown_location'
      }
    ])
  })

  it("uses the candidate venue's own clause, and knows no unknown venue", () => {
    const tight = venue({
      ...potsdam,
      radius: { radius_km: 10, radius_weeks_before: 1, radius_weeks_after: 0 }
    })
    const data = buildMapData([], [venue(), tight], {
      candidate: { venueId: 11, date: '2026-07-01' }
    })
    expect(data.candidate).toMatchObject({
      ring: { km: 10, from: '2026-06-24', to: '2026-07-01' },
      blocks: []
    })
    const unknown = buildMapData([], [], { candidate: { venueId: 99, date: '2026-07-01' } })
    expect(unknown.candidate).toBeNull()
    const badDate = buildMapData([], [venue()], { candidate: { venueId: 10, date: '1.7.2026' } })
    expect(badDate.candidate).toBeNull()
  })
})

describe('event dates that are not YYYY-MM-DD', () => {
  it('are told apart from real dates', () => {
    expect(isIsoDate('2026-05-01')).toBe(true)
    expect(isIsoDate('2026-5-1')).toBe(false)
    expect(isIsoDate('01.05.2026')).toBe(false)
    expect(isIsoDate('2027-02-30')).toBe(false)
    expect(isIsoDate('')).toBe(false)
  })

  it('list the event instead of failing the whole map', () => {
    const broken = event({ id: 2, name: 'Alt', date: '01.05.2026' })
    const data = buildMapData([event(), broken], [venue()], { bandId: 1 })
    expect(data.markers.filter((marker) => marker.type === 'event').map((m) => m.id)).toEqual([1])
    expect(data.unlocated).toEqual([
      { type: 'event', id: 2, kind: 'venue', name: 'Alt', reason: 'invalid_date' }
    ])
    // Other bands' broken rows stay out of a band's list
    expect(buildMapData([broken], [], { bandId: 2 }).unlocated).toEqual([])
  })
})

describe('locate', () => {
  it('needs both an address and a known postcode', () => {
    expect(locate(address())).toEqual({ lat: 52.5323, lng: 13.3846 })
    expect(locate(null)).toBeNull()
    // No code, but a country name: the name decides
    expect(locate(address({ country_code: '' }))).toEqual({ lat: 52.5323, lng: 13.3846 })
    expect(locate(address({ country_code: '', country: 'Österreich', zip_code: '6020' }))).toEqual({
      lat: 47.2477,
      lng: 11.3978
    })
    expect(locate(address({ country_code: '', country: 'Switzerland', zip_code: '8001' }))).toEqual(
      { lat: 47.3721, lng: 8.5417 }
    )
    // Neither: five digits read as German, four stay ambiguous (AT or CH)
    expect(locate(address({ country_code: '', country: '' }))).toEqual({
      lat: 52.5323,
      lng: 13.3846
    })
    expect(locate(address({ country_code: '', country: '', zip_code: '6020' }))).toBeNull()
    // A named foreign country never falls back to DE
    expect(
      locate(address({ country_code: '', country: 'Frankreich', zip_code: '75001' }))
    ).toBeNull()
  })
})

describe('ring and marker colours', () => {
  it('rings take the venue kind colour, only around events', () => {
    expect(ringColor({ type: 'event', kind: 'venue' })).toBe('#3b82f6')
    expect(ringColor({ type: 'event', kind: 'festival' })).toBe('#a855f7')
    expect(ringColor({ type: 'venue', kind: 'venue' })).toBeNull()
    expect(ringColor({ type: 'venue', kind: 'festival' })).toBeNull()
  })

  it('dots: events green, venues by kind', () => {
    expect(markerColor({ type: 'event', kind: 'venue' })).toBe('#22c55e')
    expect(markerColor({ type: 'venue', kind: 'venue' })).toBe('#3b82f6')
    expect(markerColor({ type: 'venue', kind: 'festival' })).toBe('#a855f7')
  })

  it('ring sizes: the clause of each event, venues none', () => {
    const ring = { km: 120, from: '2026-04-03', to: '2026-05-29' }
    expect(ringMetres({ type: 'event', ring })).toBe(120_000)
    expect(ringMetres({ type: 'event' })).toBeNull()
    expect(ringMetres({ type: 'venue', ring })).toBeNull()
  })

  it('venues: grey when blocked, free or at risk only with a band chosen', () => {
    const block = { eventId: 1, name: 'Show', date: '2026-05-01' }
    expect(markerColor({ type: 'venue', kind: 'venue', blockedBy: [block] })).toBe('#9ca3af')
    expect(venueAvailability({ type: 'venue' })).toBeNull()
    expect(venueAvailability({ type: 'venue', blockedBy: [], riskBy: [] })).toBe('free')
    expect(venueAvailability({ type: 'venue', blockedBy: [], riskBy: [block] })).toBe('risk')
    expect(venueAvailability({ type: 'venue', blockedBy: [block], riskBy: [block] })).toBe(
      'blocked'
    )
  })
})

describe('radius clause fields', () => {
  const club = { km: 100, weeksBefore: 4, weeksAfter: 4 }

  it('read empty inputs as inherit, and check the range', () => {
    expect(parseOverrideDraft({ km: '', weeksBefore: ' ', weeksAfter: '0' })).toEqual({
      ok: true,
      value: { radiusKm: null, radiusWeeksBefore: null, radiusWeeksAfter: 0 }
    })
    expect(parseOverrideDraft({ km: '0', weeksBefore: '', weeksAfter: '' }).ok).toBe(false)
    expect(parseOverrideDraft({ km: '', weeksBefore: '2.5', weeksAfter: '' }).ok).toBe(false)
    expect(parseOverrideDraft({ km: '', weeksBefore: '', weeksAfter: '105' }).ok).toBe(false)
  })

  it('require every default field', () => {
    expect(parseClauseDraft({ km: '80', weeksBefore: '2', weeksAfter: '3' })).toEqual({
      ok: true,
      value: { km: 80, weeksBefore: 2, weeksAfter: 3 }
    })
    expect(parseClauseDraft({ km: '80', weeksBefore: '', weeksAfter: '3' }).ok).toBe(false)
  })

  it('inherit per field and read as one line', () => {
    const venue = { radiusKm: 60, radiusWeeksBefore: null, radiusWeeksAfter: 1 }
    expect(inheritClause(venue, club)).toEqual({ km: 60, weeksBefore: 4, weeksAfter: 1 })
    expect(inheritClause(null, club)).toEqual(club)
    expect(formatClause({ km: 1200, weeksBefore: 1, weeksAfter: 2 })).toBe(
      '1.200 km · 1 Woche vorher, 2 nachher'
    )
  })
})

describe('tile requests', () => {
  it('name the app, not a browser: OSM blocks the packaged app otherwise', () => {
    expect(tileUserAgent('1.1.0')).toMatch(/^Bookingium\/1\.1\.0 \(\+https:\/\/github\.com\//)
    expect(TILE_REQUEST_URLS).toEqual(['https://tile.openstreetmap.org/*'])
  })
})

describe('the map route', () => {
  it('takes no Alt+number shortcut from the pages before it', () => {
    expect(getRouteShortcut(ROUTES.map.path)).toBeUndefined()
    expect(getRouteShortcut(ROUTES.invoices.path)).toBe('4')
    expect(getRouteShortcut(ROUTES.hotels.path)).toBe('0')
  })

  it('still sits in the Planung group of the menu', () => {
    const planung = getGroupedRoutes().find((group) => group.title === 'Planung')
    expect(planung?.items.map((route) => route.path)).toContain('/map')
  })
})

describe('radius rings', () => {
  it('stay under the dots and let the mouse through to them', () => {
    // A ring painted over a venue dot swallowed its tooltip. The Leaflet code cannot run in the
    // node test env, so the lines that fix it are pinned here.
    const src = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/map/LeafletMap.tsx'),
      'utf8'
    )
    expect(src).toContain("map.createPane(RING_PANE).style.zIndex = '350'")
    const ring = src.slice(src.indexOf('L.circle('), src.indexOf('L.circleMarker('))
    expect(ring).toContain('pane: RING_PANE')
    expect(ring).toContain('interactive: false')
  })
})

const dot = (marker: Partial<MapMarkerDto> & Pick<MapMarkerDto, 'type' | 'id'>): MapMarkerDto => ({
  kind: 'venue',
  name: `${marker.type} ${marker.id}`,
  bandIds: [],
  located: true,
  addressLabel: '',
  lat: 52.5,
  lng: 13.4,
  ...marker
})

describe('map points', () => {
  it('group everything at one spot: venues first, events by date', () => {
    const points = groupByPoint([
      dot({ type: 'event', id: 2, date: '2027-05-01' }),
      dot({ type: 'event', id: 1, date: '2027-03-01' }),
      dot({ type: 'venue', id: 1 }),
      dot({ type: 'venue', id: 2, lat: 48.1, lng: 11.6 }),
      dot({ type: 'event', id: 3, located: false, lat: undefined, lng: undefined })
    ])
    expect(points).toHaveLength(2)
    const [berlin, munich] = points
    expect(berlin.venues.map((venue) => venue.id)).toEqual([1])
    expect(berlin.events.map((event) => event.id)).toEqual([1, 2])
    expect(munich.events).toEqual([])
  })

  it('draw one ring per size, not one per event', () => {
    const window = { from: '2027-01-01', to: '2027-12-31' }
    const [point] = groupByPoint([
      dot({ type: 'event', id: 1, ring: { km: 100, ...window } }),
      dot({ type: 'event', id: 2, ring: { km: 100, ...window } }),
      dot({ type: 'event', id: 3, kind: 'festival', ring: { km: 300, ...window } }),
      dot({ type: 'venue', id: 1 })
    ])
    expect(pointRings(point).map((ring) => ring.metres)).toEqual([100_000, 300_000])
    expect(pointRings(groupByPoint([dot({ type: 'venue', id: 1 })])[0])).toEqual([])
  })

  it('dash the rings of open offers, unless a confirmed one draws the same size', () => {
    const ring = { km: 100, from: '2027-01-01', to: '2027-12-31' }
    const [pending] = groupByPoint([dot({ type: 'event', id: 1, ring, status: 'pending' })])
    expect(pointRings(pending)).toEqual([{ metres: 100_000, color: '#3b82f6', dashed: true }])
    const [mixed] = groupByPoint([
      dot({ type: 'event', id: 1, ring, status: 'pending' }),
      dot({ type: 'event', id: 2, ring, status: 'confirmed' })
    ])
    expect(pointRings(mixed)).toEqual([{ metres: 100_000, color: '#3b82f6', dashed: false }])
  })

  it('say in the popup what blocks a venue', () => {
    const [point] = groupByPoint([
      dot({
        type: 'venue',
        id: 4,
        name: 'Halle',
        blockedBy: [{ eventId: 7, name: 'A & B', date: '2027-03-01' }],
        riskBy: []
      })
    ])
    expect(pointPopupHtml(point)).toContain(
      'Blockiert durch: <a href="#/events/7">A &amp; B · 1.3.2027</a>'
    )
    const [free] = groupByPoint([dot({ type: 'venue', id: 5, blockedBy: [], riskBy: [] })])
    expect(pointPopupHtml(free)).toContain('Frei für die Band')
  })

  it('name the venue and count the events in the tooltip', () => {
    const [point] = groupByPoint([
      dot({ type: 'venue', id: 1, name: 'Halle' }),
      dot({ type: 'event', id: 1 }),
      dot({ type: 'event', id: 2 })
    ])
    expect(pointTitle(point)).toBe('Halle · 2 Events')
    const [lone] = groupByPoint([dot({ type: 'event', id: 1, name: 'Gig', date: '2027-03-01' })])
    expect(pointTitle(lone)).toBe('Gig · 1.3.2027')
  })

  it('link every entry in the popup and escape user data', () => {
    const [point] = groupByPoint([
      dot({
        type: 'venue',
        id: 4,
        kind: 'festival',
        name: '<b>Open</b> Air',
        addressLabel: 'Weg 1'
      }),
      dot({ type: 'event', id: 9, name: 'Gig & Co', date: '2027-03-01' })
    ])
    const html = pointPopupHtml(point)
    expect(html).toContain('<a href="#/festivals/4">&lt;b&gt;Open&lt;/b&gt; Air</a>')
    expect(html).toContain('<a href="#/events/9">Gig &amp; Co · 1.3.2027</a>')
    expect(html).not.toContain('<b>Open')
  })

  it('sum up the events beyond the popup limit', () => {
    const events = Array.from({ length: POPUP_EVENT_LIMIT + 3 }, (_, index) =>
      dot({ type: 'event', id: index + 1 })
    )
    const html = pointPopupHtml(groupByPoint(events)[0])
    expect(html.match(/#\/events\//g)).toHaveLength(POPUP_EVENT_LIMIT)
    expect(html).toContain('+ 3 weitere')
  })

  it('link venues to the list of their kind', () => {
    expect(markerHref({ type: 'event', kind: 'festival', id: 3 })).toBe('#/events/3')
    expect(markerHref({ type: 'venue', kind: 'venue', id: 3 })).toBe('#/clubs/3')
    expect(markerHref({ type: 'venue', kind: 'festival', id: 3 })).toBe('#/festivals/3')
  })

  it('label every reason an entry is not on the map', () => {
    expect(Object.keys(UNLOCATED_REASON_LABELS).sort()).toEqual([
      'invalid_date',
      'no_address',
      'no_venue',
      'unknown_postcode'
    ])
  })
})
