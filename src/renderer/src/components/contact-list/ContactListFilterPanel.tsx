import { Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MultiSelect } from '@/components/ui/multi-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { countryLabel, parseCapacity } from '@/components/contact-list/contactListState'
import {
  LIST_KIND_LABELS,
  ListKind,
  RECIPIENT_TYPE_LABELS,
  RecipientType,
  type BookedFilter,
  type ContactListFilterOptionsDto,
  type ContactListFilters
} from '../../../../main/api/schemas/contactList.schema'
import { t } from '../../../../main/i18n/translate'

/** The filters of a filter-based mailing list, beside the table */
export function ContactListFilterPanel({
  filters,
  onChange,
  options,
  changed,
  hasSaved,
  onReset
}: {
  filters: ContactListFilters
  onChange: (patch: Partial<ContactListFilters>) => void
  options: ContactListFilterOptionsDto | undefined
  /** The filters differ from the saved list (or from none) */
  changed: boolean
  /** A saved list is open, so a reset discards changes instead of clearing */
  hasSaved: boolean
  onReset: () => void
}) {
  return (
    <aside
      className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto pr-1"
      aria-label={t('Filter')}
    >
      <div className="space-y-2">
        <Label>{t('Art')}</Label>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          className="flex-wrap justify-start"
          value={filters.kinds}
          onValueChange={(value) => onChange({ kinds: value as ListKind[] })}
        >
          {ListKind.options.map((kind) => (
            <ToggleGroupItem key={kind} value={kind}>
              {LIST_KIND_LABELS[kind]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {t('Radio/Medien sind Firmen mit der Art „Radio/Medien“.')}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t('Empfänger')}</Label>
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          className="flex-wrap justify-start"
          value={filters.recipientTypes}
          onValueChange={(value) => onChange({ recipientTypes: value as RecipientType[] })}
        >
          {RecipientType.options.map((type) => (
            <ToggleGroupItem key={type} value={type}>
              {RECIPIENT_TYPE_LABELS[type]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">
          {t(
            'Keine Auswahl: alle. Hauptadresse ist die E-Mail des Clubs, Festivals oder Senders; LoPros sind die der Events dort.'
          )}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-list-country">{t('Land')}</Label>
        <MultiSelect
          id="contact-list-country"
          value={filters.countryCodes}
          onChange={(value) => onChange({ countryCodes: value })}
          options={(options?.countryCodes ?? []).map((code) => ({
            value: code,
            label: countryLabel(code)
          }))}
          placeholder={t('Alle Länder')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-list-state">{t('Bundesland / Region')}</Label>
        <MultiSelect
          id="contact-list-state"
          value={filters.states}
          onChange={(value) => onChange({ states: value })}
          options={(options?.states ?? []).map((state) => ({
            value: state,
            label: state
          }))}
          placeholder={t('Alle Regionen')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-list-zip">{t('PLZ beginnt mit')}</Label>
        <Input
          id="contact-list-zip"
          value={filters.zipPrefixes}
          onChange={(event) => onChange({ zipPrefixes: event.target.value })}
          placeholder="z. B. 7, 80"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-list-capacity-min">{t('Kapazität')}</Label>
        <div className="flex items-center gap-2">
          <Input
            id="contact-list-capacity-min"
            inputMode="numeric"
            aria-label={t('Kapazität ab')}
            placeholder="ab"
            value={filters.capacityMin ?? ''}
            onChange={(event) => onChange({ capacityMin: parseCapacity(event.target.value) })}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            inputMode="numeric"
            aria-label={t('Kapazität bis')}
            placeholder="bis"
            value={filters.capacityMax ?? ''}
            onChange={(event) => onChange({ capacityMax: parseCapacity(event.target.value) })}
          />
        </div>
        <p className="text-xs text-muted-foreground">{t('Nur Clubs und Festivals.')}</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-list-genre">{t('Genre')}</Label>
        <MultiSelect
          id="contact-list-genre"
          value={filters.genres}
          onChange={(value) => onChange({ genres: value })}
          options={(options?.genres ?? []).map((genre) => ({
            value: genre,
            label: genre
          }))}
          placeholder={t('Alle Genres')}
          emptyText={t('Keine Genres. Bei Clubs, Festivals, Radio/Medien und Bands eintragen.')}
        />
        <p className="text-xs text-muted-foreground">
          {t('Genres des Clubs, Festivals oder Senders und der Bands, die dort gespielt haben.')}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="contact-list-booked">{t('Buchungen')}</Label>
        <Select
          value={filters.booked}
          onValueChange={(value) => onChange({ booked: value as BookedFilter })}
        >
          <SelectTrigger id="contact-list-booked">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('Alle')}</SelectItem>
            <SelectItem value="booked">{t('Schon gebucht')}</SelectItem>
            <SelectItem value="never">{t('Noch nie gebucht')}</SelectItem>
          </SelectContent>
        </Select>
        {filters.booked !== 'all' && (
          <SearchableSelect
            aria-label={t('Band')}
            value={filters.bandId}
            onChange={(value) => onChange({ bandId: value })}
            options={(options?.bands ?? []).map((band) => ({
              value: band.id,
              label: band.name
            }))}
            noneLabel={t('Alle Bands')}
            searchPlaceholder={t('Band suchen…')}
          />
        )}
        {filters.booked !== 'all' && (
          <p className="text-xs text-muted-foreground">{t('Nur Clubs und Festivals.')}</p>
        )}
      </div>

      {changed && (
        <Button variant="ghost" size="sm" className="self-start" onClick={onReset}>
          <Undo2 className="h-4 w-4" />
          {hasSaved ? t('Änderungen verwerfen') : t('Filter zurücksetzen')}
        </Button>
      )}

      <p className="mt-auto border-t pt-4 text-xs text-muted-foreground">
        {t(
          'Werbe-E-Mails nur an Empfänger, die eingewilligt haben oder mit denen Sie schon zusammenarbeiten (§ 7 UWG). Wer widerspricht, wird als „Keine Werbung“ markiert.'
        )}
      </p>
    </aside>
  )
}
