import { useEffect, useMemo, useRef, useState } from 'react'
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
import { EmptyState, ErrorState, LoadingRow } from '@/components/load-states'
import type { QueryError } from '@/lib/queryErrors'
import { selectionLabel, selectionState, toggleAllRows, toggleRow } from '@/lib/rowSelection'
import { Button } from '@/components/ui/button'
import { t, uiLocale } from '../../../main/i18n/translate'

// The 'actions' column hugs its buttons at the right edge of the table
// (w-px shrinks it to its content); any spare width goes to the data
// columns. It is pinned (sticky right) so the buttons stay reachable while a
// wide table scrolls horizontally in a narrow window; pinned cells need an
// opaque background, so body cells mirror the row hover color.
const ACTIONS_COLUMN_ID = 'actions'
// #200: the checkbox column of a list whose rows can be picked
const SELECT_COLUMN_ID = 'select'
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
  /** "311 Clubs" / "1 Club" */
  itemLabel: { singular: string; plural: string }
  isLoading?: boolean
  /** Loading failed: shown instead of "Keine Ergebnisse" while no rows are loaded */
  error?: QueryError
  onRetry?: () => void
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
  /** Extra classes for a row, e.g. a lighter look for shows that are over */
  rowClassName?: (row: TData) => string | undefined
  /**
   * #200: rows can be picked (a checkbox column first). The page keeps the picked ids; while
   * rows are picked the toolbar shows how many, `actions` for them and "Auswahl aufheben"
   */
  selection?: RowSelection<TData>
}

export interface RowSelection<TData> {
  selected: ReadonlySet<number>
  onChange: (next: Set<number>) => void
  getId: (row: TData) => number
  actions: React.ReactNode
}

/** The header checkbox: shows "some picked" as indeterminate */
function SelectAllCheckbox({
  state,
  onToggle
}: {
  state: 'none' | 'some' | 'all'
  onToggle: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'some'
  }, [state])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-4 w-4 accent-primary"
      aria-label={t('Alle geladenen auswählen')}
      checked={state === 'all'}
      onChange={onToggle}
    />
  )
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
  error,
  onRetry,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  sorting,
  onSortingChange,
  filtered = false,
  search = '',
  onSearchChange,
  searchPlaceholder = t('Suchen…'),
  actionButton,
  onRowClick,
  rowClassName,
  selection
}: DataTableProps<TData>) {
  const loadedIds = useMemo(
    () => (selection ? data.map((row) => selection.getId(row)) : []),
    [data, selection]
  )
  const allColumns = useMemo<ColumnDef<TData>[]>(() => {
    if (!selection) return columns
    const select: ColumnDef<TData> = {
      id: SELECT_COLUMN_ID,
      enableSorting: false,
      header: () => (
        <SelectAllCheckbox
          state={selectionState(selection.selected, loadedIds)}
          onToggle={() => selection.onChange(toggleAllRows(selection.selected, loadedIds))}
        />
      ),
      cell: ({ row }) => {
        const id = selection.getId(row.original)
        return (
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            aria-label={t('Auswählen')}
            checked={selection.selected.has(id)}
            onChange={() => selection.onChange(toggleRow(selection.selected, id))}
          />
        )
      }
    }
    return [select, ...columns]
  }, [columns, selection, loadedIds])
  const picked = selection?.selected.size ?? 0

  const table = useReactTable({
    data,
    columns: allColumns,
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
      {selection && picked > 0 ? (
        <div
          className="mb-4 flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-1.5"
          role="toolbar"
          aria-label={t('Auswahl')}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium" role="status">
              {selectionLabel(picked, itemLabel)}
            </span>
            {selection.actions}
          </div>
          <Button variant="ghost" size="sm" onClick={() => selection.onChange(new Set())}>
            {t('Auswahl aufheben')}
          </Button>
        </div>
      ) : (
        (onSearchChange || actionButton) && (
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
        )
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
                        header.column.id === SELECT_COLUMN_ID && 'w-px pr-0',
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
                          title={t('Sortieren')}
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
                <td colSpan={allColumns.length} className="px-4 py-8 text-center">
                  <LoadingRow />
                </td>
              </tr>
            ) : error && data.length === 0 ? (
              <tr>
                <td colSpan={allColumns.length} className="px-4 py-8">
                  <ErrorState
                    error={error}
                    onRetry={() => onRetry?.()}
                    className="items-center text-center"
                  />
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={allColumns.length} className="px-4 py-8 text-center">
                  <EmptyState>{t('Keine Ergebnisse gefunden.')}</EmptyState>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'group border-t hover:bg-muted/50',
                    onRowClick && ['cursor-pointer', CLICKABLE_ROW_FOCUS],
                    rowClassName?.(row.original)
                  )}
                  {...(onRowClick && clickableRowProps(() => onRowClick(row.original)))}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      {...(cell.column.id === SELECT_COLUMN_ID && {
                        onClick: (event: React.MouseEvent) => event.stopPropagation(),
                        onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation()
                      })}
                      className={cn(
                        'px-4 py-3 text-sm',
                        cell.column.id === SELECT_COLUMN_ID && 'w-px pr-0',
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
                  colSpan={allColumns.length}
                  className="px-4 py-3 text-center text-sm text-muted-foreground"
                >
                  {isLoadingMore ? t('Weitere werden geladen…') : ''}
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
            ? t('Wird geladen…')
            : error && data.length === 0
              ? t('Nicht geladen')
              : t(filtered ? '{{count}} {{noun}} gefunden' : '{{count}} {{noun}}', {
                  count: total.toLocaleString(uiLocale()),
                  noun: total === 1 ? itemLabel.singular : itemLabel.plural
                })}
        </span>
        {hasMore && (
          <span>
            {t('{{count}} geladen – weitere beim Scrollen', {
              count: data.length.toLocaleString(uiLocale())
            })}
          </span>
        )}
      </div>
    </div>
  )
}
