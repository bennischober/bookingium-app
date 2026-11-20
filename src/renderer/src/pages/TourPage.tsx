import { useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { cn, formatShortDate } from '@/lib/utils'
import { Pencil, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { ListPageHeader } from '@/components/ListPageHeader'
import { UtilizationBar } from '@/components/event-hub/TicketsTab'
import { TourEditDialog } from '@/components/tour/TourEditDialog'
import { soldOf } from '../../../main/advancing/advancing'
import {
  ADVANCING_STATUS_LABELS,
  type AdvancingStatus,
  type TourShowDto
} from '../../../main/api/schemas/advancing.schema'
import { t, uiLocale } from '../../../main/i18n/translate'

const STATUS_CLASS: Record<AdvancingStatus, string> = {
  open: 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  contacted: 'border-sky-300 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  in_progress:
    'border-violet-300 bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  done: 'border-green-300 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300'
}

const today = (): string => new Date().toISOString().slice(0, 10)
const count = (value: number): string => value.toLocaleString(uiLocale())

/** "Fr. 30.10." */
const dayLabel = (date: string): string =>
  new Date(`${date}T00:00:00`).toLocaleDateString(uiLocale(), {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })

/** Today's sales for one show, typed straight into the overview (Enter saves) */
function QuickReport({ show }: { show: TourShowDto }) {
  const utils = trpcReact.useUtils()
  const [value, setValue] = useState('')
  const save = trpcReact.advancing.saveReport.useMutation({
    onSuccess: () => {
      setValue('')
      void utils.advancing.invalidate()
      toast.success(t('Meldung für {{value}} gespeichert', { value: show.city || show.venueName }))
    },
    onError: (error) =>
      toast.error(t('Meldung konnte nicht gespeichert werden'), { description: error.message })
  })
  const sold = soldOf(value)
  return (
    <Input
      className="h-8 w-24"
      inputMode="numeric"
      placeholder="heute"
      aria-label={t('Verkauft heute {{value}}', { value: show.city || show.venueName })}
      value={value}
      disabled={save.isPending}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && sold !== null) {
          save.mutate({ eventId: show.eventId, reportDate: today(), sold, note: '' })
        }
      }}
    />
  )
}

/**
 * #232: a tour at a glance - every show with its advancing stage, the contact on site and the
 * ticket sales against the quota, like the tour sheet it replaces
 */
export default function TourPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { tour?: string }
  const tours = trpcReact.tourImport.tours.useQuery()
  const tourNames = tours.data ?? []
  const tour = search.tour && tourNames.includes(search.tour) ? search.tour : (tourNames[0] ?? '')
  // "Tour bearbeiten" edits the selected tour, "Neue Tour" starts from '' (null = closed)
  const [editing, setEditing] = useState<string | null>(null)
  const shows = trpcReact.advancing.tour.useQuery({ tour, bandId: null }, { enabled: tour !== '' })
  const list = shows.data ?? []
  const upcoming = list.filter((show) => show.eventStatus !== 'cancelled')
  const advanced = upcoming.filter((show) => show.status === 'done').length
  const quota = upcoming.reduce((sum, show) => sum + (show.quota ?? 0), 0)
  const sold = upcoming.reduce((sum, show) => sum + (show.sold ?? 0), 0)

  const open = (show: TourShowDto, tab: 'advancing' | 'tickets'): void =>
    void navigate({
      to: '/events/$eventId',
      params: { eventId: String(show.eventId) },
      search: { tab }
    })

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <ListPageHeader
        title={t('Touren')}
        description={t('Advancing und Ticketverkäufe aller Shows einer Tour auf einen Blick.')}
      >
        {tourNames.length > 0 && (
          <Select
            value={tour}
            onValueChange={(value) => void navigate({ to: '/tours', search: { tour: value } })}
          >
            <SelectTrigger className="w-64" aria-label={t('Tour')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tourNames.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {tour && (
          <Button variant="outline" size="sm" onClick={() => setEditing(tour)}>
            <Pencil className="h-4 w-4" />
            {t('Bearbeiten')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => setEditing('')}>
          <Plus className="h-4 w-4" />
          {t('Neue Tour')}
        </Button>
      </ListPageHeader>

      <TourEditDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        tour={editing ?? ''}
        onSaved={(name) => void navigate({ to: '/tours', search: { tour: name } })}
      />

      {tours.isLoading && <p className="text-sm text-muted-foreground">{t('Wird geladen…')}</p>}
      {!tours.isLoading && tourNames.length === 0 && (
        <p className="max-w-xl text-sm text-muted-foreground">
          {t(
            'Noch keine Tour. Mit „Neue Tour“ Shows zu einer Tour zusammenstellen – oder im Event unter „Tour“ bzw. beim Import der Tourdaten (oben rechts „Import“).'
          )}
        </p>
      )}

      {tour && list.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm" aria-label={t('Tour-Summe')}>
            <p>
              <span className="text-muted-foreground">{t('Shows')} </span>
              <span className="font-semibold">{upcoming.length}</span>
            </p>
            <p>
              <span className="text-muted-foreground">{t('Advancing abgeschlossen')} </span>
              <span className="font-semibold">
                {advanced} {t('von')} {upcoming.length}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">{t('Tickets verkauft')} </span>
              <span className="font-semibold tabular-nums">
                {count(sold)}
                {quota > 0 &&
                  t(' von {{quota}} ({{percent}} %)', {
                    quota: count(quota),
                    percent: Math.round((sold / quota) * 100)
                  })}
              </span>
            </p>
          </div>

          <div className="min-h-0 overflow-auto rounded-md border">
            <table className="w-full text-sm" aria-label={t('Shows der Tour')}>
              <thead className="sticky top-0 z-10 bg-muted text-left">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('Datum')}</th>
                  <th className="px-3 py-2 font-medium">{t('Stadt')}</th>
                  <th className="px-3 py-2 font-medium">{t('Club')}</th>
                  <th className="px-3 py-2 font-medium">{t('Advancing')}</th>
                  <th className="px-3 py-2 font-medium">{t('Kontakt vor Ort')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('Kontingent')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('Verkauft')}</th>
                  <th className="w-36 px-3 py-2 font-medium">{t('Auslastung')}</th>
                  <th className="px-3 py-2 font-medium">{t('Neue Meldung')}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((show) => {
                  const delta =
                    show.sold !== null && show.previousSold !== null
                      ? show.sold - show.previousSold
                      : null
                  return (
                    <tr
                      key={show.eventId}
                      className={cn(
                        'border-t hover:bg-muted/50',
                        show.eventStatus === 'cancelled' && 'text-muted-foreground line-through'
                      )}
                    >
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">
                        {dayLabel(show.date)}
                      </td>
                      <td className="px-3 py-2">{show.city || '–'}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          className="text-left font-medium hover:underline"
                          onClick={() => open(show, 'advancing')}
                        >
                          {show.venueName || show.bandName}
                        </button>
                        {show.promoterName && (
                          <span className="block text-xs text-muted-foreground">
                            {show.promoterName}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <button type="button" onClick={() => open(show, 'advancing')}>
                          <Badge variant="outline" className={STATUS_CLASS[show.status]}>
                            {ADVANCING_STATUS_LABELS[show.status]}
                          </Badge>
                        </button>
                        {show.statusDate && (
                          <span className="block text-xs text-muted-foreground">
                            {t('seit')} {formatShortDate(show.statusDate)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {show.localContact ? (
                          <>
                            {show.localContact.name}
                            {(show.localContact.phone || show.localContact.email) && (
                              <span className="block text-xs text-muted-foreground">
                                {show.localContact.phone || show.localContact.email}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {show.quota !== null ? (
                          count(show.quota)
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {show.quotaNote || '–'}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <button type="button" onClick={() => open(show, 'tickets')}>
                          {show.sold === null ? '–' : count(show.sold)}
                        </button>
                        {delta !== null && delta !== 0 && (
                          <span className="block text-xs text-muted-foreground">
                            {delta > 0 ? '+' : ''}
                            {count(delta)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {show.utilization !== null && (
                          <div className="flex items-center gap-2">
                            <UtilizationBar percent={show.utilization} />
                            <span className="w-10 text-right text-xs tabular-nums">
                              {show.utilization} %
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {show.eventStatus !== 'cancelled' && <QuickReport show={show} />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      {tour && shows.isSuccess && list.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('Keine Shows in dieser Tour.')}</p>
      )}
    </div>
  )
}
