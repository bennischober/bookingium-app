import { useEffect, useRef, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type OnChangeFn,
  type SortingState
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { CLICKABLE_ROW_FOCUS, clickableRowProps } from '@/lib/clickableRow'

// The 'actions' column hugs its buttons at the right edge of the table
// (w-px shrinks it to its content); any spare width goes to the data
// columns. It is pinned (sticky right) so the buttons stay reachable while a
// wide table scrolls horizontally in a narrow window; pinned cells need an
// opaque background, so body cells mirror the row hover color.
const ACTIONS_COLUMN_ID = 'actions'
const ACTIONS_CELL_CLASS = 'sticky right-0 w-px whitespace-nowrap text-right'
const ACTIONS_HEAD_BG = 'bg-muted'
const ACTIONS_BODY_BG =
  'bg-background group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--background))]'
// Separates the pinned column from content scrolled underneath it
const PINNED_SHADOW = 'shadow-[-6px_0_6px_-6px_rgb(0_0_0/0.25)]'

/** Whether the table is wider than its scroll frame (i.e. scrolls sideways) */
function useHorizontalOverflow() {
  const frameRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = () => setOverflowing(frame.scrollWidth > frame.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    if (frame.firstElementChild) observer.observe(frame.firstElementChild)
    return () => observer.disconnect()
  }, [])

  return { frameRef, overflowing }
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  /** The rows loaded so far */
  data: TData[]
  /** All rows matching the search/filter (shown in the status line) */
  total: number
  /** "311 Spielstätten" / "1 Spielstätte" */
  itemLabel: { singular: string; plural: string }
  isLoading?: boolean
  /** More rows can be loaded (they load when the end scrolls into view) */
  hasMore?: boolean
  isLoadingMore?: boolean
  onLoadMore?: () => void
  /** Server-side sorting by column id; omitted = headers not sortable */
  sorting?: SortingState
  onSortingChange?: OnChangeFn<SortingState>
  /** A search or filter narrows the list (status line says so) */
  filtered?: boolean
  search?: string
  onSearchChange?: (search: string) => void
  searchPlaceholder?: string
  actionButton?: React.ReactNode
  onRowClick?: (row: TData) => void
}

/**
 * A list as one continuous, scrolling table: toolbar on top, column headers
 * pinned while the rows scroll, more rows loaded near the end, a status line
 * at the bottom. Fills the height its parent gives it (flex column).
 */
export function DataTable<TData>({
  columns,
  data,
  total,
  itemLabel,
  isLoading = false,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  sorting,
  onSortingChange,
  filtered = false,
  search = '',
  onSearchChange,
  searchPlaceholder = 'Suchen...',
  actionButton,
  onRowClick
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    enableSorting: Boolean(onSortingChange),
    enableSortingRemoval: false,
    sortDescFirst: false,
    state: { sorting: sorting ?? [] },
    onSortingChange
  })
  const { frameRef, overflowing } = useHorizontalOverflow()

  // A new order or search starts at the top
  const sortKey = JSON.stringify(sorting ?? [])
  useEffect(() => {
    frameRef.current?.scrollTo({ top: 0 })
  }, [sortKey, search, frameRef])

  // Load the next rows once the end of the list comes near
  const sentinelRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    const sentinel = sentinelRef.current
    const frame = frameRef.current
    if (!sentinel || !frame || !hasMore || !onLoadMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isLoadingMore) onLoadMore()
      },
      { root: frame, rootMargin: '300px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, isLoadingMore, onLoadMore, frameRef, data.length])

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      {/* Search and actions — wrap at narrow widths */}
      {(onSearchChange || actionButton) && (
        <div className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-2">
          {onSearchChange ? (
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="w-full max-w-sm sm:w-auto"
            />
          ) : (
            <div />
          )}
          {actionButton}
        </div>
      )}

      {/* The only part that scrolls (both ways): headers stay pinned on top,
          the actions column on the right */}
      <div
        ref={frameRef}
        className="min-h-0 flex-1 overflow-auto rounded-lg border"
        data-testid="list-scroll"
      >
        <table className="w-full min-w-[640px]">
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isActions = header.column.id === ACTIONS_COLUMN_ID
                  const canSort = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()
                  const label = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())
                  return (
                    <th
                      key={header.id}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      className={cn(
                        'sticky top-0 z-10 bg-muted px-4 py-3 text-left text-sm font-medium whitespace-nowrap shadow-[inset_0_-1px_0_var(--border)]',
                        isActions && [
                          ACTIONS_CELL_CLASS,
                          ACTIONS_HEAD_BG,
                          'z-20',
                          overflowing && PINNED_SHADOW
                        ]
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
                          title="Sortieren"
                        >
                          {label}
                          {sorted === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="h-3.5 w-3.5" />
                          ) : (
                            <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                          )}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Lädt...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Keine Ergebnisse gefunden.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'group border-t hover:bg-muted/50',
                    onRowClick && ['cursor-pointer', CLICKABLE_ROW_FOCUS]
                  )}
                  {...(onRowClick && clickableRowProps(() => onRowClick(row.original)))}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn(
                        'px-4 py-3 text-sm',
                        cell.column.id === ACTIONS_COLUMN_ID && [
                          ACTIONS_CELL_CLASS,
                          ACTIONS_BODY_BG,
                          overflowing && PINNED_SHADOW
                        ]
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
            {hasMore && !isLoading && (
              <tr ref={sentinelRef}>
                <td
                  colSpan={columns.length}
                  className="px-4 py-3 text-center text-sm text-muted-foreground"
                >
                  {isLoadingMore ? 'Weitere werden geladen…' : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Status line */}
      <div className="mt-2 flex shrink-0 items-center justify-between gap-2 text-sm text-muted-foreground">
        <span role="status">
          {isLoading
            ? 'Lädt…'
            : `${total.toLocaleString('de-DE')} ${total === 1 ? itemLabel.singular : itemLabel.plural}${
                filtered ? ' gefunden' : ''
              }`}
        </span>
        {hasMore && (
          <span>{data.length.toLocaleString('de-DE')} geladen – weitere beim Scrollen</span>
        )}
      </div>
    </div>
  )
}
