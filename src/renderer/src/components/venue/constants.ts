import type { VenueKind } from '../../../../main/api/schemas/venue.schema'

// Venue page tabs; the active one is kept in the URL (?tab=...)
export const VENUE_TABS = ['overview', 'contacts', 'events', 'documents', 'mails'] as const
export type VenueTab = (typeof VENUE_TABS)[number]

export function isVenueTab(value: unknown): value is VenueTab {
  return typeof value === 'string' && (VENUE_TABS as readonly string[]).includes(value)
}

/**
 * Clubs and festivals are both venues in the database, but two lists in the app. German copy
 * per kind: the plural is the list, `article` and `newOne` decline the singular.
 */
export const VENUE_KIND_COPY: Record<
  VenueKind,
  { singular: string; plural: string; article: string; newOne: string }
> = {
  venue: { singular: 'Club', plural: 'Clubs', article: 'Der Club', newOne: 'Neuen Club' },
  festival: {
    singular: 'Festival',
    plural: 'Festivals',
    article: 'Das Festival',
    newOne: 'Neues Festival'
  }
}

/** The list a venue belongs to; its detail page lives below it */
export function venueListPath(kind: VenueKind): '/clubs' | '/festivals' {
  return kind === 'festival' ? '/festivals' : '/clubs'
}

export function venueDetailPath(kind: VenueKind): '/clubs/$venueId' | '/festivals/$venueId' {
  return kind === 'festival' ? '/festivals/$venueId' : '/clubs/$venueId'
}

const VENUE_PATH = /^\/(clubs|festivals|venues)\/([^/]+)$/

/**
 * Whether the shown path is this venue's page, but not below the list of its kind (a link that
 * did not know the kind, an older /venues link, a kind changed in the sheet). Any other path is
 * left alone: while the router moves to another page or venue, this one is still mounted with
 * the previous venue for a moment.
 */
export function isMisplacedVenuePath(
  pathname: string,
  venue: { id: number; kind: VenueKind }
): boolean {
  const match = VENUE_PATH.exec(pathname)
  if (!match || match[2] !== String(venue.id)) return false
  return `/${match[1]}` !== venueListPath(venue.kind)
}
