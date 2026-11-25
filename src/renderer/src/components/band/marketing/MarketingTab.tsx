import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { FileUp, ListChecks, ListX, Megaphone, Undo2 } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { confirmAction } from '@/lib/confirm'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
import { MarketingPickDialog } from './MarketingPickDialog'
import { MarketingItemRow } from './MarketingItemRow'
import { MarketingActions } from './MarketingActions'
import { AtlasFilterBar } from './AtlasFilterBar'
import { AtlasMap } from './AtlasMap'
import { Tip } from '@/components/Tip'
import {
  countByCategory,
  countByStatus,
  countriesOf,
  filterItems,
  groupItems,
  isOverdue,
  type MarketingFilters
} from './marketingFilters'
import { t } from '../../../../../main/i18n/translate'
import {
  isMarketingView,
  marketingSearch,
  type MarketingSearch,
  type MarketingView
} from '../constants'

/**
 * The band's marketing: "Maßnahmen" (what is booked: spots, posters, ads …) and the
 * "Atlas" (the research, imported from a file), switched at the top; the view is in the URL
 */
export function MarketingTab({ bandId, bandName }: { bandId: number; bandName: string }) {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { view?: string }
  // the measures first; the atlas is one click away (and linkable via ?view=atlas)
  const view: MarketingView = isMarketingView(search.view) ? search.view : 'actions'
  const pick = (value: MarketingView) =>
    navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        view: value === 'actions' ? undefined : value
      }),
      replace: true
    } as never)
  return (
    <div className="space-y-5">
      <Tip id="marketing" />
      <div
        className="inline-flex overflow-hidden rounded-md border"
        role="group"
        aria-label={t('Marketing')}
      >
        {(
          [
            ['actions', t('Maßnahmen')],
            ['atlas', t('Atlas')]
          ] as Array<[MarketingView, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={view === value}
            className={cn(
              'border-r px-4 py-1.5 text-sm font-medium last:border-r-0',
              view === value ? 'bg-foreground text-background' : 'hover:bg-muted'
            )}
            onClick={() => void pick(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'atlas' ? (
        <AtlasView bandId={bandId} bandName={bandName} />
      ) : (
        <MarketingActions scope={{ bandId }} bandId={bandId} />
      )}
    </div>
  )
}

/**
 * The band's Marketing-Atlas: head data, tabs, filters and the working list with its status.
 * Entries not picked wait in the pool ("Auswahl bearbeiten…"). Filters, order and the map are
 * kept in the URL; several entries can be selected for one status or to take them off the list.
 */
function AtlasView({ bandId, bandName }: { bandId: number; bandName: string }) {
  const utils = trpcReact.useUtils()
  const overview = trpcReact.marketing.overview.useQuery(bandId)
  const navigate = useNavigate()
  const search = marketingSearch(useSearch({ strict: false }) as Record<string, unknown>)
  const [importOpen, setImportOpen] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)
  const [showDropped, setShowDropped] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  // typing stays local; the URL follows without a navigation per key
  const [query, setQuery] = useState(search.q ?? '')

  const setSearch = (patch: Partial<MarketingSearch>) =>
    navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, ...patch, view: 'atlas' }),
      replace: true
    } as never)
  useEffect(() => {
    if ((search.q ?? '') === query) return
    const timer = setTimeout(() => void setSearch({ q: query.trim() ? query : undefined }), 300)
    return () => clearTimeout(timer)
    // only the typed text drives this
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const allItems = useMemo(() => overview.data?.items ?? [], [overview.data])
  const items = useMemo(() => allItems.filter((item) => item.picked), [allItems])
  const pool = allItems.filter((item) => !item.picked && item.inAtlas).length
  const categories = useMemo(() => countByCategory(items), [items])
  const statuses = useMemo(() => countByStatus(items), [items])
  const countries = useMemo(() => countriesOf(items), [items])
  const overdue = useMemo(
    () => items.filter((item) => item.inAtlas && isOverdue(item)).length,
    [items]
  )
  const sort = search.sort ?? 'priority'
  // the first tab with entries until one is picked
  const active =
    search.cat ?? MarketingCategory.options.find((option) => categories.has(option)) ?? null
  const filters: MarketingFilters = {
    category: active,
    status: search.status ?? null,
    query: search.q ?? '',
    showDropped,
    priority: search.prio ?? null,
    country: search.country ?? null,
    quality: search.quality ?? null,
    contact: search.contact ?? null,
    action: search.action ?? null,
    overdue: search.due ?? false
  }
  const shown = useMemo(
    () => filterItems(items, filters, sort),
    // filters is rebuilt each render from the URL; its fields are the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, sort, JSON.stringify(filters)]
  )
  const shownIds = useMemo(() => new Set(shown.map((item) => item.id)), [shown])
  // a selection only counts for what is shown
  const picked = [...selected].filter((id) => shownIds.has(id))
  const dropped = items.filter((item) => !item.inAtlas).length
  const atlas = overview.data?.atlas ?? null
  const undo = overview.data?.undo ?? null
  const extraFilters = [
    search.prio,
    search.country,
    search.quality,
    search.contact,
    search.action
  ].filter(Boolean).length

  const refresh = () => utils.marketing.overview.invalidate(bandId)
  const bulkStatus = trpcReact.marketing.updateMany.useMutation({
    onSuccess: async (result) => {
      await refresh()
      setSelected(new Set())
      toast.success(t('{{count}} Einträge aktualisiert', { count: result.changed }))
    },
    onError: (error) => toast.error(t('Nicht gespeichert'), { description: error.message })
  })
  const bulkUnpick = trpcReact.marketing.setPicked.useMutation({
    onSuccess: async (result) => {
      await refresh()
      setSelected(new Set())
      toast.success(t('{{count}} von der Liste genommen', { count: result.changed }))
    },
    onError: (error) => toast.error(t('Nicht gespeichert'), { description: error.message })
  })
  const exportCsv = trpcReact.marketing.exportList.useMutation({
    onSuccess: (result) => {
      if (!result.canceled)
        toast.success(t('{{count}} Einträge exportiert', { count: result.rows }))
    },
    onError: (error) => toast.error(t('Export fehlgeschlagen'), { description: error.message })
  })
  const undoImport = trpcReact.marketing.undoImport.useMutation({
    onSuccess: async (result) => {
      await utils.invalidate()
      toast.success(t('Letzter Import zurückgenommen'), {
        description: t('{{restored}} Einträge wiederhergestellt, {{removed}} entfernt', result)
      })
    },
    onError: (error) =>
      toast.error(t('Import nicht zurückgenommen'), { description: error.message })
  })
  const askUndo = async () => {
    const ok = await confirmAction({
      title: t('Letzten Import zurücknehmen?'),
      description: t(
        'Atlas und Einträge stehen danach wieder wie vor dem Import vom {{date}}. Was seitdem an Status und Notizen geändert wurde, geht verloren; neu hinzugekommene Einträge werden entfernt. Angelegte Kontakte und Verteiler bleiben.',
        { date: formatImportDate(undo?.importedAt ?? '') }
      ),
      confirmLabel: t('Zurücknehmen'),
      destructive: true
    })
    if (ok) undoImport.mutate(bandId)
  }

  const dialog = (
    <MarketingImportDialog
      bandId={bandId}
      bandName={bandName}
      open={importOpen}
      onOpenChange={setImportOpen}
    />
  )
  const pickButton = (
    <Button variant="outline" size="sm" className="gap-2" onClick={() => setPickOpen(true)}>
      <ListChecks className="h-4 w-4" />
      {t('Auswahl bearbeiten…')}
    </Button>
  )
  const pickDialog = pickOpen && (
    <MarketingPickDialog bandId={bandId} items={allItems} open onOpenChange={setPickOpen} />
  )

  if (overview.isLoading) return <p className="text-muted-foreground">{t('Wird geladen…')}</p>

  if (!atlas && allItems.length === 0) {
    return (
      <div className="max-w-xl space-y-3 rounded-lg border border-dashed p-6">
        <Megaphone className="h-6 w-6 text-muted-foreground" />
        <p className="font-medium">
          {t('Noch kein Marketing-Atlas für')} {bandName}
        </p>
        <p className="text-sm text-muted-foreground">
          {t(
            'Der Atlas sammelt Radios, Podcasts, Presse, Festivals, Clubs und weitere Kanäle mit Priorität, Begründung und Weg. Nach dem Import steht hier jeder Eintrag mit Status, und die Kontakte landen im Adressbuch.'
          )}
        </p>
        <Button className="gap-2" onClick={() => setImportOpen(true)}>
          <FileUp className="h-4 w-4" />
          {t('Marketing-Atlas importieren…')}
        </Button>
        {dialog}
      </div>
    )
  }

  const select = (id: number, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }
  const allShownSelected = shown.length > 0 && picked.length === shown.length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl space-y-1">
          <p className="text-sm text-muted-foreground">
            {[
              atlas?.stand && t('Stand {{stand}}', { stand: atlas.stand }),
              atlas?.run && t('Lauf {{run}}', { run: atlas.run }),
              t('{{value}} auf der Liste', { value: items.length - dropped }),
              pool > 0 && t('{{value}} weitere im Atlas', { value: pool })
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
            {overdue > 0 && (
              <button
                type="button"
                className="font-medium text-amber-700 hover:underline dark:text-amber-400"
                onClick={() => void setSearch({ due: search.due ? undefined : true })}
              >
                {t('{{count}} zum Nachfassen', { count: overdue })}
              </button>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pickButton}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setImportOpen(true)}>
            <FileUp className="h-4 w-4" />
            {t('Atlas aktualisieren…')}
          </Button>
          {undo && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-2"
              disabled={undoImport.isPending}
              onClick={() => void askUndo()}
            >
              <Undo2 className="h-4 w-4" />
              {t('Letzten Import zurücknehmen')}
            </Button>
          )}
        </div>
      </div>

      {atlas && <AtlasFacts atlas={atlas} />}

      {items.length === 0 && (
        <div className="max-w-xl space-y-3 rounded-lg border border-dashed p-6">
          <p className="font-medium">{t('Noch nichts auf der Arbeitsliste')}</p>
          <p className="text-sm text-muted-foreground">
            {t(
              'Wähle aus dem Atlas, womit ihr arbeiten wollt. Nur diese Einträge stehen hier mit Status, der Rest bleibt im Atlas.'
            )}
          </p>
          {pickButton}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('Reiter des Atlas')}>
        {MarketingCategory.options
          .filter((option) => categories.has(option))
          .map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={!filters.query && active === option}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm',
                !filters.query && active === option
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              )}
              onClick={() => {
                setQuery('')
                void setSearch({ cat: option, q: undefined })
              }}
            >
              {MARKETING_CATEGORY_LABELS[option]}
              <span className="ml-1.5 opacity-70">{categories.get(option)}</span>
            </button>
          ))}
      </div>

      {items.length > 0 && (
        <AtlasFilterBar
          search={search}
          setSearch={(patch) => void setSearch(patch)}
          query={query}
          setQuery={setQuery}
          countries={countries}
          extraFilters={extraFilters}
          dropped={dropped}
          showDropped={showDropped}
          setShowDropped={setShowDropped}
          shownCount={shown.length}
          exporting={exportCsv.isPending}
          onExport={() =>
            shown.length > 0 && exportCsv.mutate({ bandId, ids: shown.map((item) => item.id) })
          }
        />
      )}

      {search.map && items.length > 0 && <AtlasMap items={shown} />}

      {items.length > 0 && shown.length > 0 && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 text-sm',
            picked.length > 0 && 'bg-muted'
          )}
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={allShownSelected}
              onChange={(event) =>
                setSelected(event.target.checked ? new Set(shownIds) : new Set())
              }
            />
            {picked.length > 0
              ? t('{{count}} ausgewählt', { count: picked.length })
              : t('Alle angezeigten auswählen')}
          </label>
          {picked.length > 0 && (
            <>
              <Select
                value=""
                onValueChange={(value) =>
                  bulkStatus.mutate({ bandId, ids: picked, status: value as MarketingStatus })
                }
              >
                <SelectTrigger className="h-8 w-48" aria-label={t('Status für die Auswahl')}>
                  <SelectValue placeholder={t('Status setzen…')} />
                </SelectTrigger>
                <SelectContent>
                  {MarketingStatus.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {MARKETING_STATUS_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1"
                disabled={bulkUnpick.isPending}
                onClick={() => bulkUnpick.mutate({ bandId, ids: picked, picked: false })}
              >
                <ListX className="h-3.5 w-3.5" />
                {t('Von der Liste nehmen')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => setSelected(new Set())}
              >
                {t('Auswahl aufheben')}
              </Button>
            </>
          )}
        </div>
      )}

      {items.length === 0 ? null : shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('Keine Einträge mit diesen Filtern')}.</p>
      ) : search.flat ? (
        <ul className="border-t">
          {shown.map((item) => (
            <MarketingItemRow
              key={item.id}
              item={item}
              selected={selected.has(item.id)}
              onSelect={(on) => select(item.id, on)}
            />
          ))}
        </ul>
      ) : (
        groupItems(shown).map(([group, entries]) => (
          <section key={group} className="space-y-1">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {group} <span className="font-normal">({entries.length})</span>
            </h3>
            <ul className="border-t">
              {entries.map((item) => (
                <MarketingItemRow
                  key={item.id}
                  item={item}
                  selected={selected.has(item.id)}
                  onSelect={(on) => select(item.id, on)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
      {dialog}
      {pickDialog}
    </div>
  )
}

/** "2026-11-25 10:41:08" (SQLite, UTC) as the local date and time */
function formatImportDate(value: string): string {
  const date = new Date(value.replace(' ', 'T') + 'Z')
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Facts, references, run log and excluded entries of the atlas, folded away */
function AtlasFacts({ atlas }: { atlas: MarketingAtlasDto }) {
  if (atlas.facts.length + atlas.refs.length + atlas.runs.length + atlas.excluded.length === 0)
    return null
  return (
    <details className="rounded-md border px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium">{t('Fakten, Referenzen und Läufe')}</summary>
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
                  {run.run ? t('Lauf {{run}}', { run: run.run }) : t('Lauf')}
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
              {t('Ausgeschlossen (')}
              {atlas.excluded.length})
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
