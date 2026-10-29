// Map preview (#102): postcode lookup and marker building (filters, unlocated
// rows). Pure helpers - no database. The postcode table is the real generated
// one; a handful of well-known codes anchor it (Berlin 10115, München 80331,
// Innsbruck 6020, Zürich 8001).
import { describe, expect, it } from 'vitest'
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

const address = (
  parts: Partial<MapEventRow['address']> = {}
): NonNullable<MapEventRow['address']> => ({
  street: 'Hauptstraße',
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
    expect(formatAddressLabel(address())).toBe('Hauptstraße 1, 10115 Berlin')
    expect(formatAddressLabel(address({ street: '', street_number: '' }))).toBe('10115 Berlin')
    expect(formatAddressLabel(address({ zip_code: '', city: '' }))).toBe('Hauptstraße 1')
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
      addressLabel: 'Hauptstraße 1, 10115 Berlin'
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
      { type: 'event', id: 5, name: 'Show' },
      { type: 'event', id: 6, name: 'Show' },
      { type: 'venue', id: 30, name: 'Ohne PLZ' }
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
    expect(data.unlocated).toEqual([{ type: 'event', id: 1, name: 'Show' }])
  })
})

describe('locate', () => {
  it('needs both an address and a known postcode', () => {
    expect(locate(address())).toEqual({ lat: 52.5323, lng: 13.3846 })
    expect(locate(null)).toBeNull()
    expect(locate(address({ country_code: '' }))).toBeNull()
  })
})
