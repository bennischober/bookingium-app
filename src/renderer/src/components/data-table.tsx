import { useEffect, useRef, useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type PaginationState,
  type OnChangeFn
} from '@tanstack/react-table'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useSyncedState } from '@/hooks/useSyncedState'
import { PAGE_SIZES } from '@/hooks/useTablePagination'
import { cn } from '@/lib/utils'

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

/** Whether the table is wider than its scroll frame (i.e. scrolls) */
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

/** "Seite [ 3 ] von 32": type a page number, Enter (or leaving the field) jumps */
function PageJump({
  page,
  pageCount,
  onJump
}: {
  page: number
  pageCount: number
  onJump: (page: number) => void
}) {
  const [input, setInput] = useSyncedState(String(page))
  const commit = () => {
    const target = Math.min(Math.max(Math.trunc(Number(input)) || page, 1), pageCount)
    setInput(String(target))
    if (target !== page) onJump(target)
  }
  return (
    <span className="flex items-center gap-1.5 px-1 text-sm">
      Seite
      <Input
        type="number"
        min={1}
        max={pageCount}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        className="h-8 w-16 px-2 text-center"
        aria-label="Seite"
      />
      von {pageCount}
    </span>
  )
}

interface DataTableProps<TData> {
  columns: ColumnDef<TData>[]
  data: TData[]
  pageCount: number
  pagination: PaginationState
  onPaginationChange: OnChangeFn<PaginationState>
  search?: string
  onSearchChange?: (search: string) => void
  searchPlaceholder?: string
  isLoading?: boolean
  total?: number
  actionButton?: React.ReactNode
  onRowClick?: (row: TData) => void
}

export function DataTable<TData>({
  columns,
  data,
  pageCount,
  pagination,
  onPaginationChange,
  search = '',
  onSearchChange,
  searchPlaceholder = 'Suchen...',
  isLoading = false,
  total = 0,
  actionButton,
  onRowClick
}: DataTableProps<TData>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount,
    state: {
      pagination
    },
    onPaginationChange
  })
  const { frameRef, overflowing } = useHorizontalOverflow()

  // Fewer pages than the current one (search, deletes, bigger pages): show
  // the last page instead of an empty one
  const lastPageIndex = Math.max(pageCount - 1, 0)
  useEffect(() => {
    if (!isLoading && pageCount > 0 && pagination.pageIndex > lastPageIndex) {
      onPaginationChange({ ...pagination, pageIndex: lastPageIndex })
    }
  }, [isLoading, pageCount, lastPageIndex, pagination, onPaginationChange])

  return (
    <div className="flex flex-col w-full">
      {/* Search and Action Button — wraps at narrow widths (150% zoom) */}
      {(onSearchChange || actionButton) && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          {onSearchChange ? (
            <Input
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              className="max-w-sm w-full sm:w-auto"
            />
          ) : (
            <div />
          )}
          {actionButton}
        </div>
      )}

      {/* Table — horizontal scroll instead of squeezing at high zoom
          (e.g. Windows 150% scaling on laptops) */}
      <div ref={frameRef} className="border rounded-lg overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className={cn(
                      'px-4 py-3 text-left text-sm font-medium whitespace-nowrap',
                      header.column.id === ACTIONS_COLUMN_ID && [
                        ACTIONS_CELL_CLASS,
                        ACTIONS_HEAD_BG,
                        overflowing && PINNED_SHADOW
                      ]
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
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
                  className={cn('group border-t hover:bg-muted/50', onRowClick && 'cursor-pointer')}
                  onClick={() => onRowClick?.(row.original)}
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
          </tbody>
        </table>
      </div>

      {/* Pagination — wraps gracefully at narrow widths */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span>
            {total > 0
              ? `${pagination.pageIndex * pagination.pageSize + 1}–${Math.min(
                  (pagination.pageIndex + 1) * pagination.pageSize,
                  total
                )} von ${total}`
              : '0 Einträge'}
          </span>
          <label className="flex items-center gap-2">
            Pro Seite
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(value) =>
                onPaginationChange({ pageIndex: 0, pageSize: Number(value) })
              }
            >
              <SelectTrigger className="h-8 w-[4.5rem]" aria-label="Einträge pro Seite">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.firstPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Erste Seite"
            title="Erste Seite"
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Vorherige Seite"
            title="Vorherige Seite"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <PageJump
            page={pagination.pageIndex + 1}
            pageCount={Math.max(pageCount, 1)}
            onJump={(page) => table.setPageIndex(page - 1)}
          />
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Nächste Seite"
            title="Nächste Seite"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => table.lastPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Letzte Seite"
            title="Letzte Seite"
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
