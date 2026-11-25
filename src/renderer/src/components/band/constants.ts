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
