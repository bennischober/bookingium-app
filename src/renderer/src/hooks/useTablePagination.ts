import { useState } from 'react'
import type { OnChangeFn, PaginationState } from '@tanstack/react-table'

/** Page sizes offered below every grid (the API allows up to 100) */
export const PAGE_SIZES = [10, 25, 50, 100] as const

const storageKey = (tableKey: string) => `bookingium-page-size:${tableKey}`

function readPageSize(tableKey: string): number {
  try {
    const stored = Number(localStorage.getItem(storageKey(tableKey)))
    return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : PAGE_SIZES[0]
  } catch {
    return PAGE_SIZES[0]
  }
}

function storePageSize(tableKey: string, pageSize: number): void {
  try {
    localStorage.setItem(storageKey(tableKey), String(pageSize))
  } catch {
    // Storage unavailable: the size just isn't remembered
  }
}

/**
 * Pagination state for a grid; the chosen page size is remembered per grid
 * (`tableKey`). Drop-in for `useState<PaginationState>`.
 */
export function useTablePagination(
  tableKey: string
): [PaginationState, OnChangeFn<PaginationState>] {
  const [pagination, setPagination] = useState<PaginationState>(() => ({
    pageIndex: 0,
    pageSize: readPageSize(tableKey)
  }))

  const onPaginationChange: OnChangeFn<PaginationState> = (updater) =>
    setPagination((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater
      if (next.pageSize !== previous.pageSize) storePageSize(tableKey, next.pageSize)
      return next
    })

  return [pagination, onPaginationChange]
}
