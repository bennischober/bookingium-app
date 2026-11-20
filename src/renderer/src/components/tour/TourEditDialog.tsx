import { useMemo, useState } from 'react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { cn, formatShortDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { TourCandidateDto } from '../../../../main/api/schemas/tour_import.schema'
import { ALL_BANDS, initialTourState, visibleShows, withTourShows } from './tourEdit'
import { t, uiLocale } from '../../../../main/i18n/translate'

const today = (): string => new Date().toISOString().slice(0, 10)

/**
 * "Tour bearbeiten" / "Neue Tour": the tour's name and, ticked in one list, the shows that
 * belong to it. A tour is only the name its events share, so renaming changes it on every
 * event (and marketing measure); a name another tour has merges the two.
 */
export function TourEditDialog({
  open,
  onOpenChange,
  tour,
  onSaved
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** the tour being edited, '' for a new one */
  tour: string
  onSaved: (name: string) => void
}) {
  // fetched fresh on every opening: the form starts from this list and does not follow it
  const candidates = trpcReact.tourImport.candidates.useQuery(undefined, {
    enabled: open,
    refetchOnMount: 'always'
  })
  const tours = trpcReact.tourImport.tours.useQuery(undefined, { enabled: open })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{tour ? t('Tour bearbeiten') : t('Neue Tour')}</DialogTitle>
          <DialogDescription>
            {t('Namen ändern und per Häkchen festlegen, welche Shows zur Tour gehören.')}
          </DialogDescription>
        </DialogHeader>
        {open && candidates.isSuccess && tours.isSuccess && !candidates.isFetching ? (
          // mounted fresh per opening, so it starts from the tour as it is now
          <TourEditForm
            tour={tour}
            shows={candidates.data}
            tours={tours.data}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t('Wird geladen…')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function TourEditForm({
  tour,
  shows,
  tours,
  onClose,
  onSaved
}: {
  tour: string
  shows: TourCandidateDto[]
  tours: string[]
  onClose: () => void
  onSaved: (name: string) => void
}) {
  const utils = trpcReact.useUtils()
  const [initial] = useState(() => initialTourState(shows, tour, today()))
  const [name, setName] = useState(tour)
  const [selected, setSelected] = useState<Set<number>>(initial.selected)
  const [search, setSearch] = useState('')
  const [band, setBand] = useState(initial.band)
  const [showPast, setShowPast] = useState(initial.showPast)
  const [onlyFree, setOnlyFree] = useState(false)
  // the tour whose shows were ticked for a merge, so they are ticked once and can be unticked
  const [mergedWith, setMergedWith] = useState('')

  const mergeTarget = (value: string): string => {
    const trimmedValue = value.trim()
    return trimmedValue !== '' && trimmedValue !== tour && tours.includes(trimmedValue)
      ? trimmedValue
      : ''
  }
  const trimmed = name.trim()
  const merging = mergeTarget(name)

  const changeName = (value: string): void => {
    setName(value)
    const target = mergeTarget(value)
    if (target && target !== mergedWith) {
      setSelected((current) => withTourShows(current, shows, target))
      setMergedWith(target)
    }
  }

  const bands = useMemo(() => {
    const byId = new Map<number, string>()
    for (const show of shows) byId.set(show.bandId, show.bandName)
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1], uiLocale()))
  }, [shows])

  const visible = visibleShows(shows, selected, {
    search,
    band,
    showPast,
    onlyFree,
    today: today()
  })

  const toggle = (id: number, checked: boolean): void =>
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })

  const save = trpcReact.tourImport.save.useMutation({
    onSuccess: (result) => {
      void utils.invalidate()
      const parts = [
        result.added > 0 && t('{{count}} hinzugefügt', { count: result.added }),
        result.removed > 0 && t('{{count}} herausgenommen', { count: result.removed })
      ].filter(Boolean)
      toast.success(
        tour && tour !== result.name
          ? t('Tour „{{name}}“ gespeichert', { name: result.name })
          : t('Tour gespeichert'),
        parts.length > 0 ? { description: parts.join(', ') } : undefined
      )
      onSaved(result.name)
      onClose()
    },
    onError: (error) =>
      toast.error(t('Tour konnte nicht gespeichert werden'), { description: error.message })
  })

  const otherTourCount = shows.filter(
    (show) =>
      selected.has(show.id) && show.tour !== '' && show.tour !== tour && show.tour !== trimmed
  ).length
  const canSave = trimmed !== '' && (tour !== '' || selected.size > 0) && !save.isPending

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="tour-edit-name">{t('Name')}</Label>
        <Input
          id="tour-edit-name"
          value={name}
          placeholder={t('z. B. Frühjahr 2027')}
          onChange={(event) => changeName(event.target.value)}
        />
        {merging && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            {t('Die Tour „{{name}}“ gibt es schon – beide werden zu einer zusammengelegt.', {
              name: merging
            })}
          </p>
        )}
        {tour && trimmed && trimmed !== tour && !merging && (
          <p className="text-xs text-muted-foreground">
            {t(
              'Der neue Name gilt für alle Shows der Tour, auch archivierte, und ihre Marketing-Maßnahmen.'
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-56"
          placeholder={t('Suchen: Band, Club, Stadt…')}
          aria-label={t('Shows suchen')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select value={band} onValueChange={setBand}>
          <SelectTrigger className="h-8 w-48" aria-label={t('Band')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BANDS}>{t('Alle Bands')}</SelectItem>
            {bands.map(([id, bandName]) => (
              <SelectItem key={id} value={String(id)}>
                {bandName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={showPast}
            onChange={(event) => setShowPast(event.target.checked)}
          />
          {t('Vergangene')}
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={onlyFree}
            onChange={(event) => setOnlyFree(event.target.checked)}
          />
          {t('Nur ohne Tour')}
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
        {visible.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">{t('Keine passenden Shows.')}</p>
        )}
        <ul aria-label={t('Shows für die Tour')}>
          {visible.map((show) => {
            const inOther = show.tour !== '' && show.tour !== tour && show.tour !== merging
            return (
              <li key={show.id} className="border-b last:border-b-0">
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-muted/50',
                    show.status === 'cancelled' && 'text-muted-foreground line-through'
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-primary"
                    checked={selected.has(show.id)}
                    onChange={(event) => toggle(show.id, event.target.checked)}
                  />
                  <span className="w-20 shrink-0 tabular-nums">{formatShortDate(show.date)}</span>
                  <span className="w-40 shrink-0 truncate font-medium">{show.bandName}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {[show.venueName, show.city].filter(Boolean).join(' · ') || show.name}
                  </span>
                  {inOther && (
                    <Badge
                      variant="outline"
                      className="shrink-0 border-amber-300 text-amber-800 dark:text-amber-300"
                      title={t('Mit Häkchen wechselt die Show in diese Tour')}
                    >
                      {show.tour}
                    </Badge>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      <DialogFooter className="items-center gap-2 sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {selected.size === 1
            ? t('1 Show in der Tour')
            : t('{{count}} Shows in der Tour', { count: selected.size })}
          {otherTourCount === 1 && t(' · 1 wechselt aus einer anderen Tour')}
          {otherTourCount > 1 &&
            t(' · {{count}} wechseln aus einer anderen Tour', { count: otherTourCount })}
          {tour && selected.size === 0 && t(' · ohne Shows verschwindet die Tour')}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('Abbrechen')}
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => save.mutate({ previous: tour, name: trimmed, eventIds: [...selected] })}
          >
            {save.isPending ? t('Wird gespeichert…') : t('Speichern')}
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}
