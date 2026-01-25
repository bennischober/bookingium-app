import { trpcReact } from '@/main'
import { useState } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BandDto } from '../../../main/api/schemas/band.schema'

export default function BandPage() {
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10 })
  const [search, setSearch] = useState('')

  const bands = trpcReact.band.getAllPaginated.useQuery({
    page: pagination.page,
    pageSize: pagination.pageSize,
    search: search || undefined
  })

  const utils = trpcReact.useUtils()

  const createBand = trpcReact.band.create.useMutation({
    onSuccess: () => {
      utils.band.getAllPaginated.invalidate()
    }
  })

  // Define table columns
  const columns: ColumnDef<BandDto>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      cell: (info) => info.getValue()
    },
    {
      accessorKey: 'genre',
      header: 'Genre',
      cell: (info) => info.getValue()
    },
    {
      accessorKey: 'founded',
      header: 'Founded',
      cell: (info) => info.getValue() || '-'
    },
    {
      accessorKey: 'notes',
      header: 'Notes',
      cell: (info) => {
        const value = info.getValue() as string
        return value ? (value.length > 50 ? value.substring(0, 50) + '...' : value) : '-'
      }
    }
  ]

  const table = useReactTable({
    data: bands.data?.items ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: bands.data?.totalPages ?? 0,
    state: {
      pagination: {
        pageIndex: pagination.page - 1,
        pageSize: pagination.pageSize
      }
    },
    onPaginationChange: (updater) => {
      const newPagination =
        typeof updater === 'function'
          ? updater({ pageIndex: pagination.page - 1, pageSize: pagination.pageSize })
          : updater
      setPagination({
        page: newPagination.pageIndex + 1,
        pageSize: newPagination.pageSize
      })
    }
  })

  return (
    <div className="flex flex-col w-full h-full p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Bands</h1>
        <p className="text-sm text-muted-foreground">Manage your artists and contacts.</p>
      </div>

      {/* Filter and Add Button */}
      <div className="flex items-center justify-between mb-4">
        <Input
          placeholder="Filter names..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPagination((prev) => ({ ...prev, page: 1 }))
          }}
          className="max-w-sm"
        />
        <Button
          onClick={() =>
            createBand.mutate({
              name: 'New Band',
              genre: 'Rock',
              companyId: 1
            })
          }
        >
          + Add New Band
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} className="px-4 py-3 text-left text-sm font-medium">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {bands.isLoading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                  No bands found.
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-t hover:bg-muted/50">
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

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-muted-foreground">
          {bands.data && (
            <>
              Showing {(pagination.page - 1) * pagination.pageSize + 1} to{' '}
              {Math.min(pagination.page * pagination.pageSize, bands.data.total)} of {bands.data.total} results
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
            &lt; Previous
          </Button>
          <span className="text-sm">
            Page {pagination.page} of {bands.data?.totalPages ?? 1}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next &gt;
          </Button>
        </div>
      </div>
    </div>
  )
}
