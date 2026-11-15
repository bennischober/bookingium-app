import { describe, expect, it } from 'vitest'
import {
  EMPTY_FILTERS,
  activeFilterCount,
  addresses,
  countryLabel,
  filtersChanged,
  parseCapacity
} from '../src/renderer/src/components/contact-list/contactListState'

// #61: the mailing list page's filter rules, out of the page.

describe('activeFilterCount', () => {
  it('counts nothing for no filters', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0)
  })

  it('counts a capacity range once and ignores a blank PLZ', () => {
    expect(
      activeFilterCount({
        ...EMPTY_FILTERS,
        kinds: ['venue'],
        capacityMin: 100,
        capacityMax: 500,
        zipPrefixes: '  ',
        booked: 'never'
      })
    ).toBe(3)
  })
})

describe('filtersChanged', () => {
  const filters = { ...EMPTY_FILTERS, genres: ['Rock'] }

  it('compares a new list with no filters', () => {
    expect(filtersChanged(null, EMPTY_FILTERS)).toBe(false)
    expect(filtersChanged(null, filters)).toBe(true)
  })

  it('compares a saved list with its stored filters', () => {
    expect(filtersChanged({ kind: 'filter', filters }, filters)).toBe(false)
    expect(filtersChanged({ kind: 'filter', filters }, EMPTY_FILTERS)).toBe(true)
  })

  it('never reports a member list as changed', () => {
    expect(filtersChanged({ kind: 'members', filters: EMPTY_FILTERS }, filters)).toBe(false)
  })
})

describe('helpers', () => {
  it('reads only the digits of a capacity', () => {
    expect(parseCapacity('1.500')).toBe(1500)
    expect(parseCapacity('')).toBeNull()
    expect(parseCapacity('ab')).toBeNull()
  })

  it('names countries in German and keeps unknown codes', () => {
    expect(countryLabel('DE')).toBe('Deutschland')
    expect(countryLabel('not a code')).toBe('not a code')
  })

  it('counts addresses in German', () => {
    expect(addresses(1)).toBe('1 Adresse')
    expect(addresses(3)).toBe('3 Adressen')
  })
})
