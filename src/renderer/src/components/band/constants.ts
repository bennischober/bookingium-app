import {
  MarketingCategory,
  MarketingPriority,
  MarketingQuality,
  MarketingStatus
} from '../../../../main/api/schemas/marketing.schema'
import { MARKETING_SORTS, type MarketingSort } from './marketing/marketingFilters'

// Band page tabs; the active one is kept in the URL (?tab=...)
export const BAND_TABS = [
  'overview',
  'members',
  'events',
  'contracts',
  'invoices',
  'marketing',
  'releases',
  'documents',
  'mails'
] as const
export type BandTab = (typeof BAND_TABS)[number]

export function isBandTab(value: unknown): value is BandTab {
  return typeof value === 'string' && (BAND_TABS as readonly string[]).includes(value)
}

/** Former tabs, now a section of another one: Mitglieder on the overview, contracts with money */
export const BAND_TAB_ALIASES: Partial<Record<string, BandTab>> = {
  members: 'overview',
  contracts: 'invoices'
}

// The two views of the band's Marketing tab, kept in the URL (?tab=marketing&view=atlas);
// without `view` the measures show
export const MARKETING_VIEWS = ['actions', 'atlas'] as const
export type MarketingView = (typeof MARKETING_VIEWS)[number]

export function isMarketingView(value: unknown): value is MarketingView {
  return typeof value === 'string' && (MARKETING_VIEWS as readonly string[]).includes(value)
}

/**
 * The atlas view's filters and order in the URL (?tab=marketing&view=atlas&cat=radios&status=…),
 * so going back from a company page reopens the list as it was. Unknown values are dropped.
 */
export type MarketingSearch = {
  view?: MarketingView
  cat?: MarketingCategory
  status?: MarketingStatus
  q?: string
  prio?: MarketingPriority
  country?: string
  quality?: MarketingQuality
  contact?: 'with' | 'without'
  action?: 'with' | 'without'
  /** Only the ones to follow up */
  due?: true
  sort?: MarketingSort
  /** One list instead of groups (DACH, Europa …) */
  flat?: true
  /** The map above the list */
  map?: true
}

const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (options as readonly string[]).includes(value)
    ? (value as T)
    : undefined
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.slice(0, 200) : undefined
// TanStack reads ?due=true as the boolean true; a hand-written link may say "1"
const flag = (value: unknown): true | undefined =>
  value === true || value === 'true' || value === '1' || value === 1 ? true : undefined

export function marketingSearch(search: Record<string, unknown>): MarketingSearch {
  const view = isMarketingView(search.view) ? search.view : undefined
  if (view !== 'atlas') return { view }
  const sort = oneOf(MARKETING_SORTS, search.sort)
  return {
    view,
    cat: oneOf(MarketingCategory.options, search.cat),
    status: oneOf(MarketingStatus.options, search.status),
    q: text(search.q),
    prio: oneOf(MarketingPriority.options, search.prio),
    country: text(search.country),
    quality: oneOf(MarketingQuality.options, search.quality),
    contact: oneOf(['with', 'without'] as const, search.contact),
    action: oneOf(['with', 'without'] as const, search.action),
    due: flag(search.due),
    sort: sort === 'priority' ? undefined : sort,
    flat: flag(search.flat),
    map: flag(search.map)
  }
}
