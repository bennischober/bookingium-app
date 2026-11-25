import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select'
import { trpcReact } from '@/lib/trpc'
import {
  EMPTY_CALENDAR_FILTER,
  isFiltered,
  subscriptionSource,
  type CalendarFilter
} from './calendarFilter'
import { t } from '../../../../main/i18n/translate'

/** The calendar page's filter row: calendars, bands, tours */
export function CalendarFilterBar({
  filter,
  onChange
}: {
  filter: CalendarFilter
  onChange: (next: CalendarFilter) => void
}) {
  const subscriptions = trpcReact.calendar.listSubscriptions.useQuery()
  const bands = trpcReact.band.getListItems.useQuery()
  const tours = trpcReact.dealMemo.listTours.useQuery()

  const sourceOptions: MultiSelectOption[] = [
    { value: 'events', label: t('Events') },
    { value: 'agency', label: t('Agenturbuchungen') },
    { value: 'appointments', label: t('Termine') },
    { value: 'followUps', label: t('Wiedervorlagen') },
    ...(subscriptions.data ?? [])
      .filter((subscription) => subscription.enabled)
      .map((subscription) => ({
        value: subscriptionSource(subscription.id),
        label: subscription.name
      }))
  ]
  const bandOptions = (bands.data ?? []).map((band) => ({
    value: String(band.id),
    label: band.name
  }))
  const tourOptions = (tours.data ?? []).map((tour) => ({ value: tour, label: tour }))
  const narrowed = filter.bands.length > 0 || filter.tours.length > 0

  return (
    <div className="space-y-2" data-testid="calendar-filter">
      <div className="flex flex-wrap items-center gap-2">
        <MultiSelect
          aria-label={t('Kalender anzeigen')}
          className="w-56"
          value={filter.sources}
          onChange={(sources) => onChange({ ...filter, sources })}
          options={sourceOptions}
          placeholder={t('Alle Kalender')}
          searchPlaceholder={t('Kalender suchen…')}
        />
        <MultiSelect
          aria-label={t('Bands anzeigen')}
          className="w-56"
          value={filter.bands}
          onChange={(selected) => onChange({ ...filter, bands: selected })}
          options={bandOptions}
          placeholder={t('Alle Bands')}
          searchPlaceholder={t('Band suchen…')}
        />
        <MultiSelect
          aria-label={t('Touren anzeigen')}
          className="w-56"
          value={filter.tours}
          onChange={(selected) => onChange({ ...filter, tours: selected })}
          options={tourOptions}
          placeholder={t('Alle Touren')}
          searchPlaceholder={t('Tour suchen…')}
          emptyText={t('Noch keine Tour bei einem Event eingetragen.')}
        />
        {isFiltered(filter) && (
          <Button variant="ghost" size="sm" onClick={() => onChange(EMPTY_CALENDAR_FILTER)}>
            <X className="h-4 w-4" />
            {t('Filter zurücksetzen')}
          </Button>
        )}
      </div>
      {narrowed && filter.sources.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {t(
            'Nur Events der Auswahl. Termine, Wiedervorlagen und abonnierte Kalender gehören zu keiner Band und keiner Tour – unter „Kalender“ lassen sie sich dazuwählen.'
          )}
        </p>
      )}
    </div>
  )
}
