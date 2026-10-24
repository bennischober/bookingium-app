// Venue page tabs; the active one is kept in the URL (?tab=...)
export const VENUE_TABS = ['overview', 'contacts', 'events', 'documents', 'mails'] as const
export type VenueTab = (typeof VENUE_TABS)[number]

export function isVenueTab(value: unknown): value is VenueTab {
  return typeof value === 'string' && (VENUE_TABS as readonly string[]).includes(value)
}
