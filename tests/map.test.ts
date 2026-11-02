// Map preview (#102): postcode lookup and marker building (filters, unlocated
// rows). Pure helpers - no database. The postcode table is the real generated
// one; a handful of well-known codes anchor it (Berlin 10115, München 80331,
// Innsbruck 6020, Zürich 8001).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildMapData,
  eventInDateRange,
  formatAddressLabel,
  kindShown,
  locate,
  type MapEventRow,
  type MapVenueRow
} from '../src/main/map/markers'
import { lookupPostcode } from '../src/main/map/postcodeLookup'
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
  UNLOCATED_REASON_LABELS
} from '../src/renderer/src/components/map/mapDisplay'
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

describe('eventInDateRange', () => {
  it('keeps events inside the range, with open sides', () => {
    expect(eventInDateRange('2026-05-01', '2026-05-01', '2026-05-31')).toBe(true)
    expect(eventInDateRange('2026-05-15', '2026-05-01', '2026-05-31')).toBe(true)
    expect(eventInDateRange('2026-04-30', '2026-05-01')).toBe(false)
    expect(eventInDateRange('2026-06-01', undefined, '2026-05-31')).toBe(false)
    expect(eventInDateRange('2026-05-01')).toBe(true)
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

  it('applies the band filter and narrows venues to those the band played', () => {
    const otherBand = event({ id: 3, band_id: 2 })
    const data = buildMapData([event(), otherBand], [venue()], { bandId: 1 })
    expect(data.markers.map((marker) => marker.id)).toEqual([1, 10])
    const withFilter = buildMapData([event(), otherBand], [venue()], { bandId: 2 })
    // Only the other band's event, plus the venue it played at (bandIds then [2])
    expect(withFilter.markers.map((marker) => marker.id)).toEqual([3, 10])
    expect(withFilter.markers.find((marker) => marker.type === 'venue')!.bandIds).toEqual([2])
  })

  it('applies the date range', () => {
    const later = event({ id: 4, date: '2026-08-20' })
    const data = buildMapData([event(), later], [venue()], {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31'
    })
    expect(
      data.markers.filter((marker) => marker.type === 'event').map((marker) => marker.id)
    ).toEqual([4])
    // The venue keeps its marker, but only the shown band (1) played there
    const venueMarker = data.markers.find((marker) => marker.type === 'venue')!
    expect(venueMarker.bandIds).toEqual([1])
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

  it('ring sizes: clubs 100 km, festivals 300 km, venues none', () => {
    expect(ringMetres({ type: 'event', kind: 'venue' })).toBe(100_000)
    expect(ringMetres({ type: 'event', kind: 'festival' })).toBe(300_000)
    expect(ringMetres({ type: 'venue', kind: 'venue' })).toBeNull()
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
    const [point] = groupByPoint([
      dot({ type: 'event', id: 1 }),
      dot({ type: 'event', id: 2 }),
      dot({ type: 'event', id: 3, kind: 'festival' }),
      dot({ type: 'venue', id: 1 })
    ])
    expect(pointRings(point).map((ring) => ring.metres)).toEqual([100_000, 300_000])
    expect(pointRings(groupByPoint([dot({ type: 'venue', id: 1 })])[0])).toEqual([])
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
      'no_address',
      'no_venue',
      'unknown_postcode'
    ])
  })
})
