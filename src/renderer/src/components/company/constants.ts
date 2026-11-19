// Company page tabs; the active one is kept in the URL (?tab=...)
export const COMPANY_TABS = [
  'overview',
  'contacts',
  'bands',
  'venues',
  'events',
  'invoices',
  'documents',
  'mails'
] as const
export type CompanyTab = (typeof COMPANY_TABS)[number]

export function isCompanyTab(value: unknown): value is CompanyTab {
  return typeof value === 'string' && (COMPANY_TABS as readonly string[]).includes(value)
}

/** Former tabs, now part of the overview (contacts, bands, clubs and festivals) */
export const COMPANY_TAB_ALIASES: Partial<Record<string, CompanyTab>> = {
  contacts: 'overview',
  bands: 'overview',
  venues: 'overview'
}
