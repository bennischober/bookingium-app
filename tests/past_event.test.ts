// The event lists: past shows look lighter, and each row says where the show is
import { describe, expect, it } from 'vitest'
import { eventPlace, isPastEvent } from '../src/renderer/src/components/event-list/pastEvent'

describe('past events', () => {
  it('counts a show as over once its day has passed', () => {
    expect(isPastEvent('2026-11-18', '2026-11-19')).toBe(true)
    expect(isPastEvent('2026-11-19', '2026-11-19')).toBe(false)
    expect(isPastEvent('2027-01-02', '2026-11-19')).toBe(false)
    // a date with a time still compares by day
    expect(isPastEvent('2026-11-19T20:00:00', '2026-11-19')).toBe(false)
    expect(isPastEvent('', '2026-11-19')).toBe(false)
    expect(isPastEvent(null, '2026-11-19')).toBe(false)
  })
})

describe('event place', () => {
  it('joins club and city, leaving out what is unknown', () => {
    expect(eventPlace({ venueName: 'Club X', venueCity: 'Leipzig' })).toBe('Club X, Leipzig')
    expect(eventPlace({ venueName: 'Club X', venueCity: null })).toBe('Club X')
    expect(eventPlace({ venueName: null, venueCity: 'Leipzig' })).toBe('Leipzig')
    expect(eventPlace({ venueName: 'Club X', venueCity: '  ' })).toBe('Club X')
    expect(eventPlace({ venueName: null })).toBe('–')
  })
})
