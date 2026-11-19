// Marketing tab: which entries the filters show, in which order
import { describe, it, expect } from 'vitest'
import {
  countByCategory,
  filterItems,
  groupItems
} from '../src/renderer/src/components/band/marketing/marketingFilters'
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
  level: 'all' as const,
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

  it('narrows by level and status, and shows dropped entries only on request', () => {
    expect(filterItems(items, { ...base, level: 'A' })).toHaveLength(2)
    expect(filterItems(items, { ...base, level: 'AB' })).toHaveLength(3)
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
