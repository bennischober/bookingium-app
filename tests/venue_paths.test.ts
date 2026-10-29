// Clubs and festivals are one venue table shown as two lists; a venue's page lives below the
// list of its kind, and kind-unaware links move there once the venue is loaded.
import { describe, expect, it } from 'vitest'
import {
  isMisplacedVenuePath,
  venueDetailPath,
  venueListPath
} from '../src/renderer/src/components/venue/constants'

describe('venue paths', () => {
  it('puts each kind below its own list', () => {
    expect(venueListPath('venue')).toBe('/clubs')
    expect(venueListPath('festival')).toBe('/festivals')
    expect(venueDetailPath('venue')).toBe('/clubs/$venueId')
    expect(venueDetailPath('festival')).toBe('/festivals/$venueId')
  })

  it('moves a venue page that is not below its list', () => {
    const club = { id: 7, kind: 'venue' as const }
    const festival = { id: 7, kind: 'festival' as const }
    expect(isMisplacedVenuePath('/venues/7', club)).toBe(true)
    expect(isMisplacedVenuePath('/festivals/7', club)).toBe(true)
    expect(isMisplacedVenuePath('/clubs/7', festival)).toBe(true)
    expect(isMisplacedVenuePath('/clubs/7', club)).toBe(false)
    expect(isMisplacedVenuePath('/festivals/7', festival)).toBe(false)
  })

  it('leaves other pages and other venues alone', () => {
    const club = { id: 7, kind: 'venue' as const }
    // On the way from this venue to another one or to another page
    expect(isMisplacedVenuePath('/venues/8', club)).toBe(false)
    expect(isMisplacedVenuePath('/companies/7', club)).toBe(false)
    expect(isMisplacedVenuePath('/clubs', club)).toBe(false)
    expect(isMisplacedVenuePath('/venues/7/print', club)).toBe(false)
  })
})
