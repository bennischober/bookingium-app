import type { Dispatch, SetStateAction } from 'react'
import { Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { useMailSearch } from '@/hooks/useMailSearch'
import { folderLabel, notDownloadedNote } from './format'
import type { FolderNode } from '../../../../main/mailclient/core/types'

/**
 * Above the mail list: the search field, the filters, the thread switch and, while searching, the
 * hit count and the hits per folder
 */
export function MailSearchBar({
  search,
  threads,
  setThreads,
  allFolders
}: {
  search: ReturnType<typeof useMailSearch>
  threads: boolean
  setThreads: Dispatch<SetStateAction<boolean>>
  allFolders: FolderNode[]
}) {
  const {
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
    firstResult,
    clearSearch
  } = search
  return (
    <>
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setFacetFolderId(null)
            }}
            onKeyDown={(e) => e.key === 'Escape' && clearSearch()}
            placeholder="Suchen (/)"
            aria-label="E-Mails durchsuchen"
            className="pl-8"
          />
        </div>
        <Button
          variant={showFilters || hasFilter ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
        >
          Filter
        </Button>
        {/* Groups the list into threads; off, the list is one row per mail */}
        {!searching && (
          <Button
            variant={threads ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setThreads((v) => !v)}
            aria-pressed={threads}
            title="Mails zu Unterhaltungen gruppieren"
          >
            Unterhaltungen
          </Button>
        )}
        {searching && (
          <Button variant="ghost" size="icon-sm" onClick={clearSearch} title="Suche beenden">
            <X />
          </Button>
        )}
      </div>
      {showFilters && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Input
            className="col-span-2"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            placeholder="Von (Name oder Adresse)"
            aria-label="Von"
          />
          <label className="flex flex-col gap-1">
            ab
            <Input
              type="date"
              value={filters.after}
              onChange={(e) => setFilters({ ...filters, after: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            bis
            <Input
              type="date"
              value={filters.before}
              onChange={(e) => setFilters({ ...filters, before: e.target.value })}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filters.unread}
              onChange={(e) => setFilters({ ...filters, unread: e.target.checked })}
            />
            Nur ungelesene
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={filters.flagged}
              onChange={(e) => setFilters({ ...filters, flagged: e.target.checked })}
            />
            Nur markierte
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={filters.hasAttachment}
              onChange={(e) => setFilters({ ...filters, hasAttachment: e.target.checked })}
            />
            Nur mit Anhang
          </label>
        </div>
      )}
      {searching && firstResult && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {firstResult.total.toLocaleString('de-DE')} Treffer · {firstResult.elapsedMs} ms
          </p>
          {/* #158: a folder synced only on open has no local mail until it is opened */}
          {(firstResult.notDownloadedFolders ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="mail-search-not-downloaded">
              {notDownloadedNote(firstResult.notDownloadedFolders ?? 0)}
            </p>
          )}
          {firstResult.facets && firstResult.facets.length > 1 && (
            <div className="flex flex-wrap gap-1" aria-label="Treffer nach Ordner">
              {firstResult.facets.slice(0, 8).map((facet) => {
                const f = allFolders.find((x) => x.id === facet.folderId)
                const active = facetFolderId === facet.folderId
                return (
                  <button
                    key={facet.folderId}
                    type="button"
                    onClick={() => setFacetFolderId(active ? null : facet.folderId)}
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-xs',
                      active ? 'border-primary bg-primary/10' : 'hover:bg-muted'
                    )}
                    aria-pressed={active}
                  >
                    {f ? folderLabel(f) : '?'} {facet.count}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </>
  )
}
