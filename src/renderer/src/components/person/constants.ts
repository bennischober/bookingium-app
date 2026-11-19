// Person page tabs; the active one is kept in the URL (?tab=...)
export const PERSON_TABS = [
  'overview',
  'bands',
  'companies',
  'venues',
  'events',
  'contracts',
  'invoices',
  'documents',
  'mails'
] as const
export type PersonTab = (typeof PERSON_TABS)[number]

export function isPersonTab(value: unknown): value is PersonTab {
  return typeof value === 'string' && (PERSON_TABS as readonly string[]).includes(value)
}

/**
 * Former tabs, now merged: bands, companies, clubs and festivals in "Zugehörigkeiten" (the
 * `bands` tab), contracts with the invoices
 */
export const PERSON_TAB_ALIASES: Partial<Record<string, PersonTab>> = {
  companies: 'bands',
  venues: 'bands',
  contracts: 'invoices'
}
