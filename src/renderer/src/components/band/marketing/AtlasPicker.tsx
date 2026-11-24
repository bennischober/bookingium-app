import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  MARKETING_CATEGORY_LABELS,
  MARKETING_QUALITY_LABELS,
  MarketingCategory,
  type MarketingPriority,
  type MarketingQuality
} from '../../../../../main/api/schemas/marketing.schema'
import { pickerShows, selectInTab, type PickerEntry } from './pickerFilters'
import { t } from '../../../../../main/i18n/translate'

export type { PickerEntry }

const PRIORITY_STYLES: Record<MarketingPriority, string> = {
  A: 'bg-primary text-primary-foreground border-primary',
  B: 'border-foreground',
  C: 'border-dashed text-muted-foreground'
}

/**
 * Choosing which atlas entries go on the band's working list: tabs with "picked/total", quick
 * picks per tab (A, A+B, all, none), search and a list with check boxes. Used by the import and
 * by "Auswahl bearbeiten" later on.
 */
export function AtlasPicker({
  entries,
  selected,
  onChange
}: {
  entries: PickerEntry[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const tabs = useMemo(() => {
    const counts = new Map<MarketingCategory, { total: number; picked: number }>()
    for (const entry of entries) {
      const count = counts.get(entry.category) ?? { total: 0, picked: 0 }
      count.total++
      if (selected.has(entry.key)) count.picked++
      counts.set(entry.category, count)
    }
    return MarketingCategory.options
      .filter((option) => counts.has(option))
      .map((option) => ({ category: option, ...counts.get(option)! }))
  }, [entries, selected])
  const [picked, setPicked] = useState<MarketingCategory | null>(null)
  const [query, setQuery] = useState('')
  const [onlyNew, setOnlyNew] = useState(false)
  const category = picked ?? tabs[0]?.category ?? null
  const newCount = entries.filter((entry) => entry.isNew).length
  const shown = useMemo(
    () => pickerShows(entries, { category, query, onlyNew }),
    [entries, category, query, onlyNew]
  )

  const toggle = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }
  const quick = (level: 'A' | 'AB' | 'all' | 'none') =>
    onChange(selectInTab(selected, shown, level))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('Reiter des Atlas')}>
        {tabs.map((tab) => (
          <button
            key={tab.category}
            type="button"
            role="tab"
            aria-selected={!query && category === tab.category}
            className={cn(
              'rounded-md border px-2.5 py-1 text-sm',
              !query && category === tab.category
                ? 'border-primary bg-primary text-primary-foreground'
                : 'hover:bg-muted'
            )}
            onClick={() => {
              setPicked(tab.category)
              setQuery('')
            }}
          >
            {MARKETING_CATEGORY_LABELS[tab.category]}
            <span className="ml-1.5 tabular-nums opacity-70">
              {tab.picked}/{tab.total}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-56"
          type="search"
          placeholder={t('Suche über alle Reiter')}
          aria-label={t('Atlas-Eintrag suchen…')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {query ? t('Treffer wählen:') : t('In diesem Reiter:')}
        </span>
        {(
          [
            ['A', t('Alle A')],
            ['AB', t('A + B')],
            ['all', t('Alle')],
            ['none', t('Keine')]
          ] as const
        ).map(([level, label]) => (
          <Button
            key={level}
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => quick(level)}
          >
            {label}
          </Button>
        ))}
        {newCount > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={onlyNew}
              onChange={(event) => setOnlyNew(event.target.checked)}
            />
            {t('Nur neue ({{count}})', { count: newCount })}
          </label>
        )}
      </div>

      <ul className="max-h-[45vh] overflow-y-auto rounded-md border" aria-label={t('Einträge')}>
        {shown.length === 0 && (
          <li className="p-3 text-sm text-muted-foreground">{t('Keine Treffer')}</li>
        )}
        {shown.map((entry) => (
          <li key={entry.key} className="border-b last:border-b-0">
            <label className="flex cursor-pointer items-start gap-2.5 px-2.5 py-2 hover:bg-muted/50">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 shrink-0 accent-primary"
                checked={selected.has(entry.key)}
                onChange={() => toggle(entry.key)}
              />
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded border text-xs font-semibold',
                  PRIORITY_STYLES[entry.priority]
                )}
                title={t('Priorität {{priority}}', { priority: entry.priority })}
              >
                {entry.priority}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                  <span className="break-words">{entry.name}</span>
                  {entry.isNew && (
                    <span className="rounded bg-green-600/15 px-1.5 text-xs font-medium text-green-700 dark:text-green-400">
                      {t('Neu')}
                    </span>
                  )}
                  {entry.note && (
                    <span className="text-xs font-normal text-amber-700 dark:text-amber-400">
                      {entry.note}
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  {query && <span>{MARKETING_CATEGORY_LABELS[entry.category]}</span>}
                  {entry.group && <span>{entry.group}</span>}
                  {entry.country && <span>{entry.country}</span>}
                  {entry.type && <span>{entry.type}</span>}
                  <span>{MARKETING_QUALITY_LABELS[entry.quality as MarketingQuality]}</span>
                </span>
                {entry.reason && (
                  <span className="line-clamp-1 block text-xs text-muted-foreground">
                    {entry.reason}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}
