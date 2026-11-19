import { useMemo, useState } from 'react'
import { FileUp, Megaphone } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
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
  MARKETING_CATEGORY_LABELS,
  MARKETING_STATUS_LABELS,
  MarketingCategory,
  MarketingStatus,
  type MarketingAtlasDto
} from '../../../../../main/api/schemas/marketing.schema'
import { MarketingImportDialog } from './MarketingImportDialog'
import { MarketingItemRow } from './MarketingItemRow'
import {
  countByCategory,
  countByStatus,
  filterItems,
  groupItems,
  type MarketingLevel
} from './marketingFilters'

const LEVELS: Array<[MarketingLevel, string]> = [
  ['A', 'Top-Auswahl (A)'],
  ['AB', 'A und B'],
  ['all', 'Alle']
]

const ALL = 'all'

/** The band's Marketing-Atlas: head data, tabs, filters and the entries with their status */
export function MarketingTab({ bandId, bandName }: { bandId: number; bandName: string }) {
  const overview = trpcReact.marketing.overview.useQuery(bandId)
  const [importOpen, setImportOpen] = useState(false)
  const [category, setCategory] = useState<MarketingCategory | null>(null)
  const [level, setLevel] = useState<MarketingLevel>('A')
  const [status, setStatus] = useState<MarketingStatus | null>(null)
  const [query, setQuery] = useState('')
  const [showDropped, setShowDropped] = useState(false)

  const items = useMemo(() => overview.data?.items ?? [], [overview.data])
  const categories = useMemo(() => countByCategory(items), [items])
  const statuses = useMemo(() => countByStatus(items), [items])
  // the first tab with entries until one is picked
  const active =
    category ?? MarketingCategory.options.find((option) => categories.has(option)) ?? null
  const shown = useMemo(
    () => filterItems(items, { category: active, level, status, query, showDropped }),
    [items, active, level, status, query, showDropped]
  )
  const dropped = items.filter((item) => !item.inAtlas).length
  const atlas = overview.data?.atlas ?? null

  const dialog = (
    <MarketingImportDialog
      bandId={bandId}
      bandName={bandName}
      open={importOpen}
      onOpenChange={setImportOpen}
    />
  )

  if (overview.isLoading) return <p className="text-muted-foreground">Wird geladen…</p>

  if (!atlas && items.length === 0) {
    return (
      <div className="max-w-xl space-y-3 rounded-lg border border-dashed p-6">
        <Megaphone className="h-6 w-6 text-muted-foreground" />
        <p className="font-medium">Noch kein Marketing-Atlas für {bandName}</p>
        <p className="text-sm text-muted-foreground">
          Der Atlas sammelt Radios, Podcasts, Presse, Festivals, Clubs und weitere Kanäle mit
          Priorität, Begründung und Weg. Nach dem Import steht hier jeder Eintrag mit Status, und
          die Kontakte landen im Adressbuch.
        </p>
        <Button className="gap-2" onClick={() => setImportOpen(true)}>
          <FileUp className="h-4 w-4" />
          Marketing-Atlas importieren…
        </Button>
        {dialog}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl space-y-1">
          <p className="text-sm text-muted-foreground">
            {[
              atlas?.stand && `Stand ${atlas.stand}`,
              atlas?.run && `Lauf ${atlas.run}`,
              `${items.length - dropped} Einträge`
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {atlas?.lead && <p className="text-sm">{atlas.lead}</p>}
          <p className="flex flex-wrap gap-x-4 text-sm text-muted-foreground">
            {MarketingStatus.options
              .filter((option) => option !== 'open' && statuses.get(option))
              .map((option) => (
                <span key={option}>
                  {MARKETING_STATUS_LABELS[option]}: {statuses.get(option)}
                </span>
              ))}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setImportOpen(true)}>
          <FileUp className="h-4 w-4" />
          Atlas aktualisieren…
        </Button>
      </div>

      {atlas && <AtlasFacts atlas={atlas} />}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Reiter des Atlas">
        {MarketingCategory.options
          .filter((option) => categories.has(option))
          .map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={!query && active === option}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm',
                !query && active === option
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              )}
              onClick={() => {
                setCategory(option)
                setQuery('')
              }}
            >
              {MARKETING_CATEGORY_LABELS[option]}
              <span className="ml-1.5 opacity-70">{categories.get(option)}</span>
            </button>
          ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border" role="group">
          {LEVELS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={level === value}
              className={cn(
                'border-r px-3 py-1.5 text-sm last:border-r-0',
                level === value ? 'bg-foreground text-background' : 'hover:bg-muted'
              )}
              onClick={() => setLevel(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <Select
          value={status ?? ALL}
          onValueChange={(value) => setStatus(value === ALL ? null : (value as MarketingStatus))}
        >
          <SelectTrigger className="h-9 w-44" aria-label="Status filtern">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Jeder Status</SelectItem>
            {MarketingStatus.options.map((option) => (
              <SelectItem key={option} value={option}>
                {MARKETING_STATUS_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="h-9 w-64"
          type="search"
          placeholder="Suche über alle Reiter"
          aria-label="Suche im Marketing-Atlas"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {dropped > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={showDropped}
              onChange={(event) => setShowDropped(event.target.checked)}
            />
            {dropped} nicht mehr im Atlas zeigen
          </label>
        )}
        <span className="ml-auto text-sm text-muted-foreground">{shown.length} angezeigt</span>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Keine Einträge mit diesen Filtern
          {level !== 'all' ? ' – „Alle“ zeigt auch die übrigen Prioritäten.' : '.'}
        </p>
      ) : (
        groupItems(shown).map(([group, entries]) => (
          <section key={group} className="space-y-1">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {group} <span className="font-normal">({entries.length})</span>
            </h3>
            <ul className="border-t">
              {entries.map((item) => (
                <MarketingItemRow key={item.id} item={item} />
              ))}
            </ul>
          </section>
        ))
      )}
      {dialog}
    </div>
  )
}

/** Facts, references, run log and excluded entries of the atlas, folded away */
function AtlasFacts({ atlas }: { atlas: MarketingAtlasDto }) {
  if (atlas.facts.length + atlas.refs.length + atlas.runs.length + atlas.excluded.length === 0)
    return null
  return (
    <details className="rounded-md border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">Fakten, Referenzen und Läufe</summary>
      <div className="mt-3 space-y-4">
        {atlas.facts.length > 0 && (
          <dl className="grid max-w-4xl grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-1.5">
            {atlas.facts.map(([label, text]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        )}
        {atlas.refs.length > 0 && (
          <ul className="max-w-4xl list-inside list-disc space-y-1">
            {atlas.refs.map((ref) => (
              <li key={ref}>{ref}</li>
            ))}
          </ul>
        )}
        {atlas.runs.length > 0 && (
          <ul className="max-w-4xl space-y-1.5">
            {atlas.runs.map((run, index) => (
              <li key={index}>
                <span className="font-medium">
                  {run.run ? `Lauf ${run.run}` : 'Lauf'}
                  {run.date && ` (${run.date})`}:
                </span>{' '}
                <span className="text-muted-foreground">{run.text}</span>
              </li>
            ))}
          </ul>
        )}
        {atlas.excluded.length > 0 && (
          <details>
            <summary className="cursor-pointer text-muted-foreground">
              Ausgeschlossen ({atlas.excluded.length})
            </summary>
            <ul className="mt-2 max-w-4xl space-y-1">
              {atlas.excluded.map((entry, index) => (
                <li key={index}>
                  <span className="font-medium">{entry.name}</span>{' '}
                  <span className="text-muted-foreground">
                    {entry.category && `${entry.category}: `}
                    {entry.reason}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </details>
  )
}
