// Marketing tab of a band: which entries the filters show. Pure, so it is tested.
import type {
  MarketingActionDto,
  MarketingCategory,
  MarketingItemDto,
  MarketingPriority,
  MarketingQuality,
  MarketingStatus
} from '../../../../../main/api/schemas/marketing.schema'
import { t } from '../../../../../main/i18n/translate'

export type MarketingFilters = {
  category: MarketingCategory | null
  status: MarketingStatus | null
  query: string
  /** Entries a newer atlas no longer lists */
  showDropped: boolean
  priority?: MarketingPriority | null
  country?: string | null
  quality?: MarketingQuality | null
  /** Linked to a company or venue in the address book, or not */
  contact?: 'with' | 'without' | null
  /** A measure booked for it, or not */
  action?: 'with' | 'without' | null
  /** Only the ones to follow up (see isOverdue) */
  overdue?: boolean
}

/** How the list is ordered */
export const MARKETING_SORTS = ['priority', 'status', 'changed', 'name'] as const
export type MarketingSort = (typeof MARKETING_SORTS)[number]

export const MARKETING_SORT_LABELS: Record<MarketingSort, string> = {
  priority: t('Priorität'),
  status: t('Status'),
  changed: t('Zuletzt geändert'),
  name: t('Name')
}

/** Asked and no answer for this many days: time to follow up */
export const FOLLOW_UP_DAYS = 14

const QUALITY_ORDER = { b: 0, w: 1, i: 2 } as const
// the work in progress first, the closed ones last
const STATUS_ORDER: Record<MarketingStatus, number> = {
  talking: 0,
  contacted: 1,
  positive: 2,
  active: 3,
  open: 4,
  declined: 5
}

/** Whole days from an ISO date (YYYY-MM-DD) to today; null without a date */
export function daysSince(date: string | null, today: Date = new Date()): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  const from = Date.UTC(y, m - 1, d)
  const to = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.max(0, Math.round((to - from) / 86_400_000))
}

/** Asked (Angefragt) at least FOLLOW_UP_DAYS ago and nothing since */
export function isOverdue(item: MarketingItemDto, today: Date = new Date()): boolean {
  if (item.status !== 'contacted') return false
  const days = daysSince(item.statusDate, today)
  return days !== null && days >= FOLLOW_UP_DAYS
}

/** Priority first, backed entries before unchecked ones, then by name (or the chosen order) */
export function sortItems(
  items: MarketingItemDto[],
  sort: MarketingSort = 'priority'
): MarketingItemDto[] {
  const byPriority = (a: MarketingItemDto, b: MarketingItemDto) =>
    a.priority.localeCompare(b.priority) ||
    QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality] ||
    a.name.localeCompare(b.name, 'de')
  const compare: Record<MarketingSort, (a: MarketingItemDto, b: MarketingItemDto) => number> = {
    priority: byPriority,
    status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byPriority(a, b),
    // newest status first; never touched last
    changed: (a, b) => (b.statusDate ?? '').localeCompare(a.statusDate ?? '') || byPriority(a, b),
    name: (a, b) => a.name.localeCompare(b.name, 'de')
  }
  return [...items].sort(compare[sort])
}

/** The countries of the entries, most frequent first, for the country filter */
export function countriesOf(items: MarketingItemDto[]): string[] {
  const counts = new Map<string, number>()
  for (const item of items)
    if (item.country) counts.set(item.country, (counts.get(item.country) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([country]) => country)
}

export function filterItems(
  items: MarketingItemDto[],
  filters: MarketingFilters,
  sort: MarketingSort = 'priority',
  today: Date = new Date()
): MarketingItemDto[] {
  const needle = filters.query.trim().toLowerCase()
  return sortItems(
    items.filter((item) => {
      if (!filters.showDropped && !item.inAtlas) return false
      // a search looks through every tab
      if (!needle && filters.category && item.category !== filters.category) return false
      if (filters.status && item.status !== filters.status) return false
      if (filters.priority && item.priority !== filters.priority) return false
      if (filters.country && item.country !== filters.country) return false
      if (filters.quality && item.quality !== filters.quality) return false
      const linked = item.companyId !== null || item.venueId !== null
      if (filters.contact === 'with' && !linked) return false
      if (filters.contact === 'without' && linked) return false
      if (filters.action === 'with' && item.actionStatus === null) return false
      if (filters.action === 'without' && item.actionStatus !== null) return false
      if (filters.overdue && !isOverdue(item, today)) return false
      if (!needle) return true
      return [
        item.name,
        item.statusNote,
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
    }),
    sort
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
    const key = item.group || t('Ohne Gruppe')
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
}

/**
 * Net cost of the measures that count (not cancelled), split by who pays: `own` is ours,
 * `external` what the band, the label (#289: everything from a label copy), a promoter or
 * someone else pays, so a label's budget never shows as our spending.
 */
export function costTotals(actions: MarketingActionDto[]): { own: number; external: number } {
  let own = 0
  let external = 0
  for (const action of actions) {
    if (action.status === 'cancelled' || !action.costCents) continue
    if (action.payer === 'us') own += action.costCents
    else external += action.costCents
  }
  return { own, external }
}
