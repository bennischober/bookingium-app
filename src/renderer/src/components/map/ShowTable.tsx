import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MapMarkerDto } from '../../../../main/api/schemas/map.schema'
import { agencyLabel, germanDate } from './mapDisplay'
import { nextSort, showRows, sortShows, type ShowSort, type ShowSortKey } from './showTable'

const COLUMNS: Array<{ key: ShowSortKey; label: string; className?: string }> = [
  { key: 'date', label: 'Datum', className: 'w-28' },
  { key: 'name', label: 'Event' },
  { key: 'band', label: 'Band' },
  { key: 'kind', label: 'Art', className: 'w-24' },
  { key: 'tour', label: 'Tour' },
  { key: 'km', label: 'Gebietsschutz' },
  { key: 'conflicts', label: 'Überschneidungen' }
]

/**
 * The shows on the map (events and agency bookings, per the filters) as a sortable list: date,
 * band, club or festival, tour, the radius clause and which of the band's other shows lie in
 * each other's clause. A row selects its point on the map.
 */
export function ShowTable({
  markers,
  bandNames,
  onSelect
}: {
  markers: MapMarkerDto[]
  bandNames: Map<number, string>
  onSelect?: (marker: { type: 'event' | 'agency'; id: number }) => void
}) {
  const [sort, setSort] = useState<ShowSort>({ key: 'date', desc: false })
  const rows = useMemo(
    () => sortShows(showRows(markers, bandNames), sort),
    [markers, bandNames, sort]
  )
  if (rows.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left">
          <tr>
            {COLUMNS.map((column) => (
              <th key={column.key} className={cn('px-3 py-2 font-medium', column.className)}>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:underline"
                  onClick={() => setSort(nextSort(sort, column.key))}
                >
                  {column.label}
                  {sort.key === column.key &&
                    (sort.desc ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUp className="h-3 w-3" />
                    ))}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className={cn(
                'cursor-pointer border-t hover:bg-muted/50',
                row.conflicts.length > 0 && 'bg-amber-50 dark:bg-amber-950/30'
              )}
              onClick={() => onSelect?.({ type: row.type, id: row.id })}
            >
              <td className="whitespace-nowrap px-3 py-2 align-top">
                {row.date ? germanDate(row.date) : '–'}
              </td>
              <td className="px-3 py-2 align-top">
                {row.type === 'event' ? (
                  <a
                    href={`#/events/${row.id}`}
                    className="underline-offset-2 hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {row.name}
                  </a>
                ) : (
                  row.name
                )}
                {row.status === 'pending' && (
                  <span className="text-xs text-muted-foreground"> (ausstehend)</span>
                )}
                {row.agency !== null && (
                  <span className="block text-xs text-muted-foreground">
                    {agencyLabel(row.agency)}
                  </span>
                )}
                {!row.located && (
                  <span className="block text-xs text-muted-foreground">nicht auf der Karte</span>
                )}
              </td>
              <td className="px-3 py-2 align-top">{row.band || '–'}</td>
              <td className="px-3 py-2 align-top">
                {row.kind === 'festival' ? 'Festival' : 'Club'}
              </td>
              <td className="px-3 py-2 align-top">{row.tour || '–'}</td>
              <td className="whitespace-nowrap px-3 py-2 align-top">
                {row.km !== null ? `${row.km.toLocaleString('de-DE')} km` : '–'}
                {row.from && row.to && (
                  <span className="block text-xs text-muted-foreground">
                    {germanDate(row.from)} – {germanDate(row.to)}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 align-top">
                {row.conflicts.length === 0 ? (
                  <span className="text-muted-foreground">–</span>
                ) : (
                  <span className="flex items-start gap-1 text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {row.conflicts
                        .map((conflict) => `${conflict.name} (${germanDate(conflict.date)})`)
                        .join(', ')}
                    </span>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
