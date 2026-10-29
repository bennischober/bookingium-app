// Building blocks shared by the detail pages (band, company, venue)
import { useNavigate } from '@tanstack/react-router'
import { cn, formatShortDate } from '@/lib/utils'
import { CLICKABLE_ROW_FOCUS, clickableRowProps } from '@/lib/clickableRow'
import { Badge } from '@/components/ui/badge'
import { STATUS_LABELS, STATUS_STYLES } from '@/components/event-hub/constants'
import type { DealMemoListItemDto } from '../../../../main/api/schemas/deal_memo.schema'
import type { AddressDto } from '../../../../main/api/schemas/address.schema'
import { EmptyState, ErrorState, LoadingRow } from '@/components/load-states'
import type { QueryError } from '@/lib/queryErrors'

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

/** Muted row count after a tab's label; nothing while loading or at zero */
export function TabCount({ count }: { count: number | undefined }) {
  if (!count) return null
  return <span className="ml-1.5 text-xs tabular-nums text-muted-foreground">{count}</span>
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

/** Label/value rows inside an info card; empty values are left out */
export function Fields({ fields }: { fields: [string, string | null | undefined][] }) {
  const filled = fields.filter(([, value]) => value)
  if (filled.length === 0) return <Empty />
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      {filled.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** `className` applies to the header and the cells (e.g. text-right) */
export type Column<T> = { header: string; cell: (row: T) => React.ReactNode; className?: string }

/** The parts of a list query a table shows: rows, loading, error and retry */
export type ListQuery<T> = {
  data: T[] | undefined
  isLoading: boolean
  error: QueryError
  refetch: () => unknown
}

/** A list as a table; a click on a row, or Enter on a focused row, opens it */
export function RowTable<T extends { id: number }>({
  label,
  query,
  loading,
  empty,
  columns,
  onRowClick
}: {
  label: string
  query: ListQuery<T>
  loading: string
  empty: string
  columns: Column<T>[]
  onRowClick: (row: T) => void
}) {
  const rows = query.data
  if (query.isLoading) return <LoadingRow>{loading}</LoadingRow>
  if (query.error && !rows)
    return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  if (!rows?.length) return <EmptyState>{empty}</EmptyState>

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm" aria-label={label}>
        <thead className="bg-muted text-left">
          <tr>
            {columns.map((column) => (
              <th key={column.header} className={cn('px-3 py-2 font-medium', column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={cn('cursor-pointer border-t hover:bg-muted/50', CLICKABLE_ROW_FOCUS)}
              {...clickableRowProps(() => onRowClick(row))}
            >
              {columns.map((column) => (
                <td key={column.header} className={cn('px-3 py-2', column.className)}>
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Events as a table, newest first as delivered; a click opens the event.
 * Date, name and status are always shown; `columns` adds more after the name.
 */
export function EventsTable<T extends DealMemoListItemDto>({
  label,
  query,
  empty,
  columns
}: {
  label: string
  query: ListQuery<T>
  empty: string
  columns: Column<T>[]
}) {
  const navigate = useNavigate()
  return (
    <RowTable
      label={label}
      query={query}
      loading="Events werden geladen…"
      empty={empty}
      columns={[
        {
          header: 'Datum',
          cell: (event) => formatShortDate(event.date),
          className: 'whitespace-nowrap'
        },
        { header: 'Event', cell: (event) => event.name, className: 'font-medium' },
        ...columns,
        {
          header: 'Status',
          cell: (event) => (
            <Badge variant="outline" className={cn(STATUS_STYLES[event.status] ?? '')}>
              {STATUS_LABELS[event.status] ?? event.status}
            </Badge>
          )
        }
      ]}
      onRowClick={(event) =>
        navigate({ to: '/events/$eventId', params: { eventId: String(event.id) } })
      }
    />
  )
}
