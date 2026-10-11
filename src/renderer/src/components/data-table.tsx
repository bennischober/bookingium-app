import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type PaginationState,
  type OnChangeFn
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

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
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-3 text-left text-sm font-medium whitespace-nowrap"
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
                  className={cn('border-t hover:bg-muted/50', onRowClick && 'cursor-pointer')}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-sm">
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
      <div className="flex flex-wrap items-center justify-between gap-2 mt-4">
        <div className="text-sm text-muted-foreground">
          {total > 0 && (
            <>
              Zeige {pagination.pageIndex * pagination.pageSize + 1} bis{' '}
              {Math.min((pagination.pageIndex + 1) * pagination.pageSize, total)} von {total}{' '}
              Einträgen
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            &lt; Zurück
          </Button>
          <span className="text-sm">
            Seite {pagination.pageIndex + 1} von {pageCount || 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Weiter &gt;
          </Button>
        </div>
      </div>
    </div>
  )
}
