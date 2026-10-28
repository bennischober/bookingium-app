import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { mailApi } from '@/lib/mailApi'
import { PAGE_SIZE } from '@/components/mail/paging'
import type { SearchFilters } from '../../../main/mailclient/core/types'

// Shorter queries match too much to be useful (FTS prefix search)
const MIN_QUERY_LENGTH = 3

type ExtraFilters = { from: string; after: string; before: string; hasAttachment: boolean }
const NO_FILTERS: ExtraFilters = { from: '', after: '', before: '', hasAttachment: false }

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** R4: the mail page's search - query, filters, debounce, results, snippets and the facet folder */
export function useMailSearch({ accountId, ready }: { accountId: string; ready: boolean }) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<ExtraFilters>(NO_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [facetFolderId, setFacetFolderId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Search replaces the folder list while a query or filter is set
  const searchInput = useDebounced({ query: query.trim(), ...filters }, 180)
  const hasFilter = Boolean(
    searchInput.from || searchInput.after || searchInput.before || searchInput.hasAttachment
  )
  const searching = searchInput.query.length >= MIN_QUERY_LENGTH || hasFilter
  const searchFilters: SearchFilters = {
    query: searchInput.query.length >= MIN_QUERY_LENGTH ? searchInput.query : '',
    from: searchInput.from || undefined,
    after: searchInput.after || undefined,
    before: searchInput.before || undefined,
    hasAttachment: searchInput.hasAttachment || undefined,
    folderId: facetFolderId ?? undefined,
    sortBy: searchInput.query.length >= MIN_QUERY_LENGTH ? 'relevance' : 'date'
  }
  const results = useInfiniteQuery({
    queryKey: ['mail', accountId, 'search', searchFilters],
    queryFn: ({ pageParam = 0 }) =>
      mailApi.search(
        {
          ...searchFilters,
          limit: PAGE_SIZE,
          offset: pageParam as number,
          wantFacets: pageParam === 0,
          wantSnippets: true
        },
        accountId
      ),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0)
      return last.items.length === PAGE_SIZE && loaded < last.total ? loaded : undefined
    },
    enabled: ready && searching,
    keepPreviousData: true
  })
  const snippets = useMemo(
    () => Object.assign({}, ...(results.data?.pages.map((p) => p.snippetMap) ?? [])),
    [results.data]
  ) as Record<number, string>
  const firstResult = results.data?.pages[0]
  const clearSearch = () => {
    setQuery('')
    setFilters(NO_FILTERS)
    setFacetFolderId(null)
  }

  return {
    query,
    setQuery,
    filters,
    setFilters,
    showFilters,
    setShowFilters,
    facetFolderId,
    setFacetFolderId,
    searchRef,
    hasFilter,
    searching,
    results,
    snippets,
    firstResult,
    clearSearch
  }
}
