// Band page tabs; the active one is kept in the URL (?tab=...)
export const BAND_TABS = [
  'overview',
  'members',
  'events',
  'contracts',
  'documents',
  'mails'
] as const
export type BandTab = (typeof BAND_TABS)[number]

export function isBandTab(value: unknown): value is BandTab {
  return typeof value === 'string' && (BAND_TABS as readonly string[]).includes(value)
}
