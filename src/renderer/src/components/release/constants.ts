// Release page tabs (#289); the active one is kept in the URL (?tab=...)
export const RELEASE_TABS = [
  'overview',
  'tracks',
  'products',
  'rights',
  'marketing',
  'documents'
] as const
export type ReleaseTab = (typeof RELEASE_TABS)[number]

export function isReleaseTab(value: unknown): value is ReleaseTab {
  return typeof value === 'string' && (RELEASE_TABS as readonly string[]).includes(value)
}
