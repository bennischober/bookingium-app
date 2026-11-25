import { useState } from 'react'
import { Download, Map as MapIcon, SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  MARKETING_QUALITY_LABELS,
  MARKETING_STATUS_LABELS,
  MarketingPriority,
  MarketingQuality,
  MarketingStatus
} from '../../../../../main/api/schemas/marketing.schema'
import { MARKETING_SORT_LABELS, MARKETING_SORTS, type MarketingSort } from './marketingFilters'
import type { MarketingSearch } from '../constants'
import { t } from '../../../../../main/i18n/translate'

const ALL = 'all'

/** A select whose first option ("Jede …") clears the filter */
function FilterSelect<T extends string>({
  label,
  allLabel,
  value,
  options,
  onChange,
  className = 'w-40'
}: {
  label: string
  allLabel: string
  value: T | undefined
  options: Array<[T, string]>
  onChange: (value: T | undefined) => void
  className?: string
}) {
  return (
    <Select
      value={value ?? ALL}
      onValueChange={(next) => onChange(next === ALL ? undefined : (next as T))}
    >
      <SelectTrigger className={cn('h-9', className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map(([option, text]) => (
          <SelectItem key={option} value={option}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Filters of the atlas list: status, search, follow-up, the further filters (priority, country,
 * quality, contact, measure) behind "Filter", order, grouping, map and CSV export
 */
export function AtlasFilterBar({
  search,
  setSearch,
  query,
  setQuery,
  countries,
  extraFilters,
  dropped,
  showDropped,
  setShowDropped,
  shownCount,
  exporting,
  onExport
}: {
  search: MarketingSearch
  setSearch: (patch: Partial<MarketingSearch>) => void
  query: string
  setQuery: (query: string) => void
  countries: string[]
  /** How many of the further filters are set */
  extraFilters: number
  dropped: number
  showDropped: boolean
  setShowDropped: (show: boolean) => void
  shownCount: number
  exporting: boolean
  onExport: () => void
}) {
  const [more, setMore] = useState(extraFilters > 0)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label={t('Status filtern')}
          allLabel={t('Jeder Status')}
          className="w-44"
          value={search.status}
          options={MarketingStatus.options.map((option) => [
            option,
            MARKETING_STATUS_LABELS[option]
          ])}
          onChange={(status) => setSearch({ status })}
        />
        <Input
          className="h-9 w-64"
          type="search"
          placeholder={t('Suche über alle Reiter')}
          aria-label={t('Suche im Marketing-Atlas')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={!!search.due}
            onChange={(event) => setSearch({ due: event.target.checked ? true : undefined })}
          />
          {t('Nur zum Nachfassen')}
        </label>
        <Button
          variant={more || extraFilters > 0 ? 'secondary' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          aria-expanded={more}
          onClick={() => setMore((value) => !value)}
        >
          <SlidersHorizontal className="h-4 w-4" />
          {extraFilters > 0 ? t('Filter ({{count}})', { count: extraFilters }) : t('Filter')}
        </Button>
        {dropped > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={showDropped}
              onChange={(event) => setShowDropped(event.target.checked)}
            />
            {dropped} {t('nicht mehr im Atlas zeigen')}
          </label>
        )}
        <span className="ml-auto text-sm text-muted-foreground">
          {t('{{count}} angezeigt', { count: shownCount })}
        </span>
      </div>

      {more && (
        <div className="flex flex-wrap items-center gap-3">
          <FilterSelect
            label={t('Priorität filtern')}
            allLabel={t('Jede Priorität')}
            className="w-36"
            value={search.prio}
            options={MarketingPriority.options.map((option) => [
              option,
              t('Priorität {{priority}}', { priority: option })
            ])}
            onChange={(prio) => setSearch({ prio })}
          />
          <FilterSelect
            label={t('Land filtern')}
            allLabel={t('Jedes Land')}
            className="w-32"
            value={search.country}
            options={countries.map((country) => [country, country])}
            onChange={(country) => setSearch({ country })}
          />
          <FilterSelect
            label={t('Qualität filtern')}
            allLabel={t('Jede Qualität')}
            className="w-36"
            value={search.quality}
            options={MarketingQuality.options.map((option) => [
              option,
              MARKETING_QUALITY_LABELS[option]
            ])}
            onChange={(quality) => setSearch({ quality })}
          />
          <FilterSelect
            label={t('Nach Kontakt filtern')}
            allLabel={t('Mit und ohne Kontakt')}
            className="w-52"
            value={search.contact}
            options={[
              ['with', t('Im Adressbuch')],
              ['without', t('Nicht im Adressbuch')]
            ]}
            onChange={(contact) => setSearch({ contact })}
          />
          <FilterSelect
            label={t('Nach Maßnahme filtern')}
            allLabel={t('Mit und ohne Maßnahme')}
            className="w-56"
            value={search.action}
            options={[
              ['with', t('Mit Maßnahme')],
              ['without', t('Ohne Maßnahme')]
            ]}
            onChange={(action) => setSearch({ action })}
          />
          {extraFilters > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() =>
                setSearch({
                  prio: undefined,
                  country: undefined,
                  quality: undefined,
                  contact: undefined,
                  action: undefined
                })
              }
            >
              {t('Filter zurücksetzen')}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={search.sort ?? 'priority'}
          onValueChange={(value) =>
            setSearch({ sort: value === 'priority' ? undefined : (value as MarketingSort) })
          }
        >
          <SelectTrigger className="h-8 w-52" aria-label={t('Sortierung')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARKETING_SORTS.map((option) => (
              <SelectItem key={option} value={option}>
                {t('Sortiert nach {{sort}}', { sort: MARKETING_SORT_LABELS[option] })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={!search.flat}
            onChange={(event) => setSearch({ flat: event.target.checked ? undefined : true })}
          />
          {t('Nach Gruppe ordnen')}
        </label>
        <Button
          variant={search.map ? 'secondary' : 'outline'}
          size="sm"
          className="h-8 gap-1.5"
          aria-pressed={!!search.map}
          onClick={() => setSearch({ map: search.map ? undefined : true })}
        >
          <MapIcon className="h-4 w-4" />
          {t('Karte')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          disabled={exporting || shownCount === 0}
          onClick={onExport}
        >
          <Download className="h-4 w-4" />
          {t('Als CSV exportieren…')}
        </Button>
      </div>
    </div>
  )
}
