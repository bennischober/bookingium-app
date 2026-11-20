import { trpcReact } from '@/lib/trpc'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { EntityCombobox, type ComboboxItem } from '@/components/ui/entity-combobox'
import {
  isIsoDate,
  type SetWizardField,
  type WizardFormData
} from '@/components/event-wizard/wizardState'
import { t } from '../../../../main/i18n/translate'

/** Step 1: name, date, band and venue; warns when an agency booked the band that day */
export function EventBasicsStep({
  form,
  set,
  bandItems,
  bandsLoading,
  onCreateBand,
  venueItems,
  venuesLoading,
  onCreateVenue
}: {
  form: WizardFormData
  set: SetWizardField
  bandItems: ComboboxItem[]
  bandsLoading: boolean
  onCreateBand: (query: string) => void
  venueItems: ComboboxItem[]
  venuesLoading: boolean
  onCreateVenue: (query: string) => void
}) {
  // #103: another agency already booked the band that day. The step is only
  // mounted while the wizard is open.
  const agencyClash = trpcReact.externalBooking.listForBand.useQuery(
    { bandId: form.bandId ?? 0, from: form.date, to: form.date },
    { enabled: form.bandId !== null && isIsoDate(form.date) }
  )
  const agencyClashes = form.bandId !== null ? (agencyClash.data ?? []) : []

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="event-name">
          {t('Eventname')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="event-name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder={t('z. B. Sommertour 2027 – Hamburg')}
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="event-date">
          {t('Datum')} <span className="text-destructive">*</span>
        </Label>
        <Input
          id="event-date"
          type="date"
          value={form.date}
          onChange={(e) => set('date', e.target.value)}
        />
      </div>

      <Separator />

      <div className="space-y-2">
        <Label>
          {t('Band')} <span className="text-destructive">*</span>
        </Label>
        <EntityCombobox
          items={bandItems}
          value={form.bandId}
          onChange={(id) => set('bandId', id)}
          placeholder={t('Band auswählen…')}
          searchPlaceholder={t('Bands suchen…')}
          isLoading={bandsLoading}
          onCreateNew={onCreateBand}
          createNewLabel={t('Neue Band anlegen')}
        />
        {agencyClashes.length > 0 && (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
            {t('Agenturbuchung am selben Tag:')}{' '}
            {agencyClashes
              .map((booking) =>
                [booking.venueName || booking.city, booking.agency].filter(Boolean).join(' · ')
              )
              .join('; ')}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>
          {t('Club / Festival')} <span className="text-muted-foreground text-xs">(optional)</span>
        </Label>
        <EntityCombobox
          items={venueItems}
          value={form.venueId}
          onChange={(id) => set('venueId', id)}
          placeholder={t('Club / Festival auswählen…')}
          searchPlaceholder={t('Clubs und Festivals suchen…')}
          isLoading={venuesLoading}
          onCreateNew={onCreateVenue}
          createNewLabel={t('Neuen Club / Festival anlegen')}
        />
      </div>
    </div>
  )
}
