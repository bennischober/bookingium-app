// The map page's list of shows (events and agency bookings) with their radius clause: the rows
// and their sorting. Pure, unit-tested; the component only renders it.
import type { MapMarkerDto } from '../../../../main/api/schemas/map.schema'

export type ShowSortKey = 'date' | 'name' | 'band' | 'kind' | 'tour' | 'km' | 'conflicts'
export type ShowSort = { key: ShowSortKey; desc: boolean }

export type ShowRow = {
  key: string
  type: 'event' | 'agency'
  id: number
  date: string
  name: string
  band: string
  kind: 'venue' | 'festival'
  tour: string
  km: number | null
  /** "1.3.2027 – 29.3.2027": the clause window */
  from: string | null
  to: string | null
  status: 'confirmed' | 'pending'
  agency: string | null
  conflicts: NonNullable<MapMarkerDto['conflicts']>
  located: boolean
}

/** The shows among the markers as table rows; `bandNames` names the bands by id */
export function showRows(markers: MapMarkerDto[], bandNames: Map<number, string>): ShowRow[] {
  return markers
    .filter((marker) => marker.type !== 'venue')
    .map((marker) => ({
      key: `${marker.type}-${marker.id}`,
      type: marker.type as 'event' | 'agency',
      id: marker.id,
      date: marker.date ?? '',
      name: marker.name,
      band: marker.bandIds.map((id) => bandNames.get(id) ?? '').join(', '),
      kind: marker.kind,
      tour: marker.tour ?? '',
      km: marker.ring?.km ?? null,
      from: marker.ring?.from ?? null,
      to: marker.ring?.to ?? null,
      status: marker.status ?? 'pending',
      agency: marker.agency ?? null,
      conflicts: marker.conflicts ?? [],
      located: marker.located
    }))
}

const collator = new Intl.Collator('de-DE', { sensitivity: 'base', numeric: true })

/**
 * The rows in the chosen order. Ties fall back to date, then name, so the list stays stable;
 * an empty tour sorts last in either direction.
 */
export function sortShows(rows: ShowRow[], sort: ShowSort): ShowRow[] {
  const direction = sort.desc ? -1 : 1
  const compare = (a: ShowRow, b: ShowRow): number => {
    switch (sort.key) {
      case 'date':
        return a.date.localeCompare(b.date)
      case 'name':
        return collator.compare(a.name, b.name)
      case 'band':
        return collator.compare(a.band, b.band)
      case 'kind':
        return a.kind.localeCompare(b.kind)
      case 'tour':
        return collator.compare(a.tour, b.tour)
      case 'km':
        return (a.km ?? -1) - (b.km ?? -1)
      case 'conflicts':
        return a.conflicts.length - b.conflicts.length
    }
  }
  return [...rows].sort((a, b) => {
    if (sort.key === 'tour' && !a.tour !== !b.tour) return a.tour ? -1 : 1
    return (
      direction * compare(a, b) || a.date.localeCompare(b.date) || collator.compare(a.name, b.name)
    )
  })
}

/** Clicking a column: the same one flips the direction, another starts ascending */
export function nextSort(current: ShowSort, key: ShowSortKey): ShowSort {
  return current.key === key ? { key, desc: !current.desc } : { key, desc: false }
}
