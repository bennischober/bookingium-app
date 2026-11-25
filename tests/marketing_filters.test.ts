// Marketing tab: which entries the filters show, in which order
import { describe, it, expect } from 'vitest'
import {
  countByCategory,
  countriesOf,
  daysSince,
  filterItems,
  groupItems,
  isOverdue,
  sortItems
} from '../src/renderer/src/components/band/marketing/marketingFilters'
import { marketingSearch } from '../src/renderer/src/components/band/constants'
import type { MarketingItemDto } from '../src/main/api/schemas/marketing.schema'

let next = 1
const item = (over: Partial<MarketingItemDto>): MarketingItemDto => ({
  id: next++,
  bandId: 1,
  category: 'radios',
  group: 'DACH',
  name: 'Eintrag',
  country: 'DE',
  type: 'Rockradio',
  priority: 'A',
  reason: '',
  approach: '',
  timing: '',
  quality: 'b',
  sourceUrl: '',
  contactEmail: '',
  contactUrl: '',
  contactNote: '',
  activeNote: '',
  status: 'open',
  statusNote: '',
  statusDate: null,
  companyId: null,
  companyName: null,
  venueId: null,
  venueName: null,
  inAtlas: true,
  actionStatus: null,
  picked: true,
  candidates: [],
  location: null,
  ...over
})

const items = [
  item({ name: 'Zeta FM', priority: 'A', quality: 'w' }),
  item({ name: 'Alpha FM', priority: 'A' }),
  item({ name: 'Beta FM', priority: 'B', group: 'Europa' }),
  item({ name: 'Gamma FM', priority: 'C', status: 'contacted' }),
  item({ name: 'Festival X', category: 'festivals', reason: 'Hard Rock' }),
  item({ name: 'Alt FM', inAtlas: false })
]
const base = {
  category: 'radios' as const,
  status: null,
  query: '',
  showDropped: false
}

describe('marketing filters', () => {
  it('sorts by priority, then backed before unchecked, then by name', () => {
    expect(filterItems(items, base).map((i) => i.name)).toEqual([
      'Alpha FM',
      'Zeta FM',
      'Beta FM',
      'Gamma FM'
    ])
  })

  it('narrows by status, and shows dropped entries only on request', () => {
    expect(filterItems(items, { ...base, status: 'contacted' }).map((i) => i.name)).toEqual([
      'Gamma FM'
    ])
    expect(filterItems(items, { ...base, showDropped: true })).toHaveLength(5)
  })

  it('a search looks through every tab', () => {
    expect(filterItems(items, { ...base, query: 'hard rock' }).map((i) => i.name)).toEqual([
      'Festival X'
    ])
  })

  it('counts per tab without dropped entries and groups largest first', () => {
    expect(countByCategory(items).get('radios')).toBe(4)
    expect(groupItems(filterItems(items, base)).map(([g]) => g)).toEqual(['DACH', 'Europa'])
  })
})

describe('follow-up, further filters and order', () => {
  const today = new Date(2026, 10, 25)

  it('counts whole days and follows up on requests without an answer for two weeks', () => {
    expect(daysSince('2026-11-11', today)).toBe(14)
    expect(daysSince(null, today)).toBeNull()
    expect(isOverdue(item({ status: 'contacted', statusDate: '2026-11-11' }), today)).toBe(true)
    expect(isOverdue(item({ status: 'contacted', statusDate: '2026-11-12' }), today)).toBe(false)
    // in a conversation or without a date there is nothing to chase
    expect(isOverdue(item({ status: 'talking', statusDate: '2026-01-01' }), today)).toBe(false)
    expect(isOverdue(item({ status: 'contacted', statusDate: null }), today)).toBe(false)
  })

  it('filters by priority, country, quality, contact, measure and follow-up', () => {
    const list = [
      item({ name: 'Linked AT', country: 'AT', companyId: 7, priority: 'B' }),
      item({ name: 'Booked', actionStatus: 'booked', quality: 'i' }),
      item({ name: 'Chase', status: 'contacted', statusDate: '2026-10-01' }),
      item({ name: 'Plain' })
    ]
    const names = (filters: Partial<typeof base> & Record<string, unknown>) =>
      filterItems(list, { ...base, ...filters }, 'name', today).map((i) => i.name)
    expect(names({ priority: 'B' })).toEqual(['Linked AT'])
    expect(names({ country: 'AT' })).toEqual(['Linked AT'])
    expect(names({ quality: 'i' })).toEqual(['Booked'])
    expect(names({ contact: 'with' })).toEqual(['Linked AT'])
    expect(names({ contact: 'without' })).toEqual(['Booked', 'Chase', 'Plain'])
    expect(names({ action: 'with' })).toEqual(['Booked'])
    expect(names({ action: 'without' })).toEqual(['Chase', 'Linked AT', 'Plain'])
    expect(names({ overdue: true })).toEqual(['Chase'])
    expect(countriesOf(list)).toEqual(['DE', 'AT'])
  })

  it('sorts by status (work in progress first) and by the newest status', () => {
    const list = [
      item({ name: 'Open', status: 'open' }),
      item({ name: 'Declined', status: 'declined', statusDate: '2026-11-20' }),
      item({ name: 'Talking', status: 'talking', statusDate: '2026-11-01' }),
      item({ name: 'Asked', status: 'contacted', statusDate: '2026-11-10' })
    ]
    expect(sortItems(list, 'status').map((i) => i.name)).toEqual([
      'Talking',
      'Asked',
      'Open',
      'Declined'
    ])
    expect(sortItems(list, 'changed').map((i) => i.name)).toEqual([
      'Declined',
      'Asked',
      'Talking',
      'Open'
    ])
  })
})

describe('atlas filters in the URL', () => {
  it('keeps known values of the atlas view and drops the rest', () => {
    expect(
      marketingSearch({
        view: 'atlas',
        cat: 'radios',
        status: 'nope',
        prio: 'B',
        due: true,
        flat: '1',
        sort: 'priority',
        q: '  '
      })
    ).toEqual({
      view: 'atlas',
      cat: 'radios',
      status: undefined,
      q: undefined,
      prio: 'B',
      country: undefined,
      quality: undefined,
      contact: undefined,
      action: undefined,
      due: true,
      sort: undefined,
      flat: true,
      map: undefined
    })
  })

  it('the measures view carries no atlas filters', () => {
    expect(marketingSearch({ cat: 'radios', status: 'open' })).toEqual({ view: undefined })
  })
})
