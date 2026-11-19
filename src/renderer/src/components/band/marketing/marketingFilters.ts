// Marketing tab of a band: which entries the filters show. Pure, so it is tested.
import type {
  MarketingCategory,
  MarketingItemDto,
  MarketingStatus
} from '../../../../../main/api/schemas/marketing.schema'

/** A: the top picks; AB: A and B; all: everything */
export type MarketingLevel = 'A' | 'AB' | 'all'

export type MarketingFilters = {
  category: MarketingCategory | null
  level: MarketingLevel
  status: MarketingStatus | null
  query: string
  /** Entries a newer atlas no longer lists */
  showDropped: boolean
}

const QUALITY_ORDER = { b: 0, w: 1, i: 2 } as const

/** Priority first, backed entries before unchecked ones, then by name */
export function sortItems(items: MarketingItemDto[]): MarketingItemDto[] {
  return [...items].sort(
    (a, b) =>
      a.priority.localeCompare(b.priority) ||
      QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality] ||
      a.name.localeCompare(b.name, 'de')
  )
}

export function filterItems(
  items: MarketingItemDto[],
  filters: MarketingFilters
): MarketingItemDto[] {
  const needle = filters.query.trim().toLowerCase()
  return sortItems(
    items.filter((item) => {
      if (!filters.showDropped && !item.inAtlas) return false
      // a search looks through every tab
      if (!needle && filters.category && item.category !== filters.category) return false
      if (filters.level === 'A' && item.priority !== 'A') return false
      if (filters.level === 'AB' && item.priority === 'C') return false
      if (filters.status && item.status !== filters.status) return false
      if (!needle) return true
      return [
        item.name,
        item.country,
        item.type,
        item.reason,
        item.approach,
        item.timing,
        item.group
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
  )
}

/** Entries per tab (still in the atlas), for the tab chips */
export function countByCategory(items: MarketingItemDto[]): Map<MarketingCategory, number> {
  const counts = new Map<MarketingCategory, number>()
  for (const item of items) {
    if (!item.inAtlas) continue
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
  }
  return counts
}

/** Entries per status (still in the atlas), for the summary */
export function countByStatus(items: MarketingItemDto[]): Map<MarketingStatus, number> {
  const counts = new Map<MarketingStatus, number>()
  for (const item of items) {
    if (!item.inAtlas) continue
    counts.set(item.status, (counts.get(item.status) ?? 0) + 1)
  }
  return counts
}

/** Grouped by the atlas group (DACH, Europa …), largest group first */
export function groupItems(items: MarketingItemDto[]): Array<[string, MarketingItemDto[]]> {
  const groups = new Map<string, MarketingItemDto[]>()
  for (const item of items) {
    const key = item.group || 'Ohne Gruppe'
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
}
