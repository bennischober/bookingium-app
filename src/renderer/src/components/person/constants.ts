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
