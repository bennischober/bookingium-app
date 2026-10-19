// Building blocks shared by the detail pages (band, company, venue)
import { useNavigate } from '@tanstack/react-router'
import { cn, formatShortDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { STATUS_LABELS, STATUS_STYLES } from '@/components/event-hub/constants'
import type { DealMemoListItemDto } from '../../../../main/api/schemas/deal_memo.schema'
import type { AddressDto } from '../../../../main/api/schemas/address.schema'

export function InfoCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  )
}

/** "–" for empty values */
export function Empty({ children = '–' }: { children?: React.ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>
}

/** Address as lines ("Street 1", "12345 City", "Country"), or nothing */
export function AddressLines({ address }: { address: AddressDto | null }) {
  const lines = address
    ? [
        [address.street, address.streetNumber].filter(Boolean).join(' '),
        address.addressSuffix,
        [address.zipCode, address.city].filter(Boolean).join(' '),
        address.country
      ].filter(Boolean)
    : []
  if (lines.length === 0) return <Empty />
  return (
    <>
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </>
  )
}

type EventColumn<T> = { header: string; cell: (event: T) => React.ReactNode }

/**
 * Events as a table, newest first as delivered; a click opens the event.
 * Date, name and status are always shown; `columns` adds more after the name.
 */
export function EventsTable<T extends DealMemoListItemDto>({
  label,
  events,
  isLoading,
  empty,
  columns
}: {
  label: string
  events: T[] | undefined
  isLoading: boolean
  empty: string
  columns: EventColumn<T>[]
}) {
  const navigate = useNavigate()

  if (isLoading) return <p className="text-sm text-muted-foreground">Events werden geladen…</p>
  if (!events?.length) return <p className="text-sm text-muted-foreground">{empty}</p>

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm" aria-label={label}>
        <thead className="bg-muted text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Datum</th>
            <th className="px-3 py-2 font-medium">Event</th>
            {columns.map((column) => (
              <th key={column.header} className="px-3 py-2 font-medium">
                {column.header}
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr
              key={event.id}
              className="cursor-pointer border-t hover:bg-muted/50"
              onClick={() =>
                navigate({ to: '/events/$eventId', params: { eventId: String(event.id) } })
              }
            >
              <td className="whitespace-nowrap px-3 py-2">{formatShortDate(event.date)}</td>
              <td className="px-3 py-2 font-medium">{event.name}</td>
              {columns.map((column) => (
                <td key={column.header} className="px-3 py-2">
                  {column.cell(event)}
                </td>
              ))}
              <td className="px-3 py-2">
                <Badge variant="outline" className={cn(STATUS_STYLES[event.status] ?? '')}>
                  {STATUS_LABELS[event.status] ?? event.status}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
