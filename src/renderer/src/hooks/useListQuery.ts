import { useState } from 'react'
import type { ColumnSort, OnChangeFn, SortingState } from '@tanstack/react-table'

/** Rows per request while a list loads more as it scrolls (API maximum) */
export const LIST_CHUNK_SIZE = 100

const storageKey = (listKey: string) => `bookingium-list-sort:${listKey}`

function readSorting(listKey: string, fallback: ColumnSort): SortingState {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(listKey)) ?? 'null')
    if (stored && typeof stored.id === 'string' && typeof stored.desc === 'boolean') {
      return [stored]
    }
  } catch {
    // Storage unavailable or broken: use the default order
  }
  return [fallback]
}

/**
 * Sort order of a list (one column), remembered per list, plus the matching
 * API input (`sortBy`/`sortDir`)
 */
export function useListSorting(
  listKey: string,
  fallback: ColumnSort
): {
  sorting: SortingState
  setSorting: OnChangeFn<SortingState>
  sortInput: { sortBy?: string; sortDir?: 'asc' | 'desc' }
} {
  const [sorting, setSortingState] = useState<SortingState>(() => readSorting(listKey, fallback))

  const setSorting: OnChangeFn<SortingState> = (updater) =>
    setSortingState((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater
      try {
        if (next[0]) localStorage.setItem(storageKey(listKey), JSON.stringify(next[0]))
      } catch {
        // Not remembered, still applied
      }
      return next
    })

  const [first] = sorting
  return {
    sorting,
    setSorting,
    sortInput: first ? { sortBy: first.id, sortDir: first.desc ? 'desc' : 'asc' } : {}
  }
}

/**
 * State of a list page that should still be there after opening a record and coming back
 * (the search, the events view): kept per list until the app is closed. A new start shows
 * every list unfiltered again, so nothing stays hidden behind a search from last week.
 */
export function useListSessionState<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: string) => value is T = (value): value is T => typeof value === 'string'
): [T, (value: T) => void] {
  const storageKey = `bookingium-list-state:${key}`
  const [value, setValueState] = useState<T>(() => {
    try {
      const stored = sessionStorage.getItem(storageKey)
      return stored !== null && isValid(stored) ? stored : fallback
    } catch {
      return fallback
    }
  })
  const setValue = (next: T) => {
    setValueState(next)
    try {
      if (next === fallback) sessionStorage.removeItem(storageKey)
      else sessionStorage.setItem(storageKey, next)
    } catch {
      // Not remembered, still applied
    }
  }
  return [value, setValue]
}

/** The search box of a list, kept while the app is open (see `useListSessionState`) */
export function useListSearch(listKey: string): [string, (search: string) => void] {
  return useListSessionState<string>(`${listKey}:search`, '')
}

interface ListPage<T> {
  items: T[]
  total: number
  page: number
  totalPages: number
}

/** For `useInfiniteQuery` on a paginated list procedure */
export const infiniteListOptions = {
  getNextPageParam: (last: { page: number; totalPages: number }) =>
    last.page < last.totalPages ? last.page + 1 : undefined,
  // Typing in the search keeps the old rows until the new ones arrive
  keepPreviousData: true
}

/** All rows loaded so far */
export function listRows<T>(data: { pages: ListPage<T>[] } | undefined): T[] {
  return data?.pages.flatMap((page) => page.items) ?? []
}

/** Rows matching the search/filter in total */
export function listTotal(data: { pages: ListPage<unknown>[] } | undefined): number {
  return data?.pages[0]?.total ?? 0
}
