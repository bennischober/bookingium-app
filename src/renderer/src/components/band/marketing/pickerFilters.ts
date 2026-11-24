// Choosing atlas entries for the working list: which entries the picker shows and what the quick
// picks select. Pure, so it is tested.
import type {
  MarketingCategory,
  MarketingPriority,
  MarketingQuality
} from '../../../../../main/api/schemas/marketing.schema'

export type PickerEntry = {
  /** item key (import) or id (later) as text */
  key: string
  category: MarketingCategory
  group: string
  name: string
  country: string
  type: string
  priority: MarketingPriority
  quality: MarketingQuality
  reason: string
  isNew?: boolean
  /** Shown next to the name, e.g. the status the team set */
  note?: string
}

const QUALITY_ORDER = { b: 0, w: 1, i: 2 } as const

/** The tab's entries (a search looks through all tabs), priority first, then by name */
export function pickerShows(
  entries: PickerEntry[],
  filters: { category: MarketingCategory | null; query: string; onlyNew: boolean }
): PickerEntry[] {
  const needle = filters.query.trim().toLowerCase()
  return entries
    .filter((entry) => {
      if (filters.onlyNew && !entry.isNew) return false
      if (needle) {
        return [entry.name, entry.country, entry.type, entry.group, entry.reason]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      }
      return filters.category === null || entry.category === filters.category
    })
    .sort(
      (a, b) =>
        a.priority.localeCompare(b.priority) ||
        QUALITY_ORDER[a.quality] - QUALITY_ORDER[b.quality] ||
        a.name.localeCompare(b.name, 'de')
    )
}

/**
 * A quick pick over the shown entries: "A" selects exactly the A entries of them, "AB" A and B,
 * "all" every one, "none" none. Entries not shown keep their state.
 */
export function selectInTab(
  selected: Set<string>,
  shown: PickerEntry[],
  level: 'A' | 'AB' | 'all' | 'none'
): Set<string> {
  const next = new Set(selected)
  for (const entry of shown) {
    const want =
      level === 'all' ||
      (level === 'A' && entry.priority === 'A') ||
      (level === 'AB' && entry.priority !== 'C')
    if (want) next.add(entry.key)
    else next.delete(entry.key)
  }
  return next
}
