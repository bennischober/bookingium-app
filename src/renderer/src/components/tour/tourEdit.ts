import type { TourCandidateDto } from '../../../../main/api/schemas/tour_import.schema'

// "Tour bearbeiten": which shows the dialog lists and how it starts. Pure, so vitest covers it.

export const ALL_BANDS = '__all__'

export interface TourShowFilter {
  search: string
  band: string
  showPast: boolean
  onlyFree: boolean
  today: string
}

/** Every word of the search is found in the show's band, club, city or name */
export function matchesSearch(show: TourCandidateDto, search: string): boolean {
  const haystack = `${show.bandName} ${show.venueName} ${show.city} ${show.name}`.toLowerCase()
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/** The listed shows: ticked ones always (a filter never hides them), others by the filters */
export function visibleShows(
  shows: TourCandidateDto[],
  selected: ReadonlySet<number>,
  filter: TourShowFilter
): TourCandidateDto[] {
  return shows.filter(
    (show) =>
      selected.has(show.id) ||
      ((filter.band === ALL_BANDS || String(show.bandId) === filter.band) &&
        (filter.showPast || show.date >= filter.today) &&
        (!filter.onlyFree || show.tour === '') &&
        matchesSearch(show, filter.search))
  )
}

/** How the dialog opens: the tour's shows ticked, its band preset when it has exactly one */
export function initialTourState(shows: TourCandidateDto[], tour: string, today: string) {
  const members = tour === '' ? [] : shows.filter((show) => show.tour === tour)
  const bandIds = new Set(members.map((show) => show.bandId))
  return {
    selected: new Set(members.map((show) => show.id)),
    band: bandIds.size === 1 ? String([...bandIds][0]) : ALL_BANDS,
    showPast: members.some((show) => show.date < today)
  }
}

/** Ticks the shows of the tour being merged into, so merging keeps them */
export function withTourShows(
  selected: ReadonlySet<number>,
  shows: TourCandidateDto[],
  tour: string
): Set<number> {
  const next = new Set(selected)
  for (const show of shows) if (show.tour === tour) next.add(show.id)
  return next
}
