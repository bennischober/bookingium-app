import { useEffect, useRef } from 'react'
import { trpcReact } from '@/lib/trpc'
import { useSyncedState } from '@/hooks/useSyncedState'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Music2, MapPin, User, Building2 } from 'lucide-react'
import { toast } from '@/lib/toast'
import { type InlineComboboxItem } from '@/components/ui/inline-combobox'
import type { DealMemoDetailDto } from 'src/main/api/schemas/deal_memo.schema'
import { useFollowUpNudge } from '@/hooks/useFollowUpNudge'
import { useMapPreview } from '@/hooks/useMapPreview'
import { RadiusFields } from '@/components/map/RadiusFields'
import {
  defaultClause,
  formatClause,
  hasOverride,
  inheritClause,
  parseOverrideDraft
} from '@/components/map/radiusDisplay'
import { SwappableEntityCard } from './SwappableEntityCard'
import { EventStatusLine } from './EventStatusLine'
import { Tip } from '@/components/Tip'
import { ReadOnlyField } from './ReadOnlyField'
import { formatCapacity } from '../../../../main/api/schemas/capacity'
import { MarketingActions } from '@/components/band/marketing/MarketingActions'
import { t } from '../../../../main/i18n/translate'
export interface OverviewTabProps {
  event: DealMemoDetailDto
  isEditing: boolean
  saveSignal: number
  cancelSignal: number
  onSaved: () => void
}

export function OverviewTab({
  event,
  isEditing,
  saveSignal,
  cancelSignal,
  onSaved
}: OverviewTabProps) {
  const utils = trpcReact.useUtils()
  // Track the last signal value we responded to. Seeded with the current value so
  // that a re-mount (or React Strict Mode's double-invocation) never fires a stale save.
  const lastSaveSignal = useRef(saveSignal)
  const [name, setName] = useSyncedState(event.name)
  const [date, setDate] = useSyncedState(event.date)
  const [status, setStatus] = useSyncedState(event.status)
  const [notes, setNotes] = useSyncedState(event.notes)
  const [tour, setTour] = useSyncedState(event.tour)
  // Radius clause override: text drafts, '' = inherit from the venue or the default
  const [radiusKm, setRadiusKm] = useSyncedState(event.radiusKm?.toString() ?? '')
  const [weeksBefore, setWeeksBefore] = useSyncedState(event.radiusWeeksBefore?.toString() ?? '')
  const [weeksAfter, setWeeksAfter] = useSyncedState(event.radiusWeeksAfter?.toString() ?? '')
  const radiusDraft = { km: radiusKm, weeksBefore, weeksAfter }
  // Checked on every keystroke, so the field says what is wrong before a save is tried
  const radiusParsed = parseOverrideDraft(radiusDraft)
  const radiusDirty =
    radiusKm !== (event.radiusKm?.toString() ?? '') ||
    weeksBefore !== (event.radiusWeeksBefore?.toString() ?? '') ||
    weeksAfter !== (event.radiusWeeksAfter?.toString() ?? '')
  const isDirty =
    name !== event.name ||
    date !== event.date ||
    status !== event.status ||
    notes !== event.notes ||
    tour !== event.tour ||
    radiusDirty

  // What the event inherits: its venue's clause, else the default for the venue kind
  const mapPreview = useMapPreview()
  const inheritedRadius = mapPreview.defaults
    ? inheritClause(event.venue, defaultClause(mapPreview.defaults, event.venue?.kind ?? 'venue'))
    : null

  // Reset to server values when cancel is triggered
  useEffect(() => {
    if (cancelSignal > 0) {
      setName(event.name)
      setDate(event.date)
      setStatus(event.status)
      setNotes(event.notes)
      setTour(event.tour)
      setRadiusKm(event.radiusKm?.toString() ?? '')
      setWeeksBefore(event.radiusWeeksBefore?.toString() ?? '')
      setWeeksAfter(event.radiusWeeksAfter?.toString() ?? '')
    }
  }, [cancelSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Entity list queries for the swap comboboxes ──
  const bands = trpcReact.band.getListItems.useQuery()
  const venues = trpcReact.venue.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const companies = trpcReact.company.getListItems.useQuery()
  // the tours other events name, offered while typing
  const tours = trpcReact.tourImport.tours.useQuery(undefined, { enabled: isEditing })

  const bandItems: InlineComboboxItem[] = (bands.data ?? []).map((b) => ({
    id: b.id,
    label: b.name
  }))
  const venueItems: InlineComboboxItem[] = (venues.data ?? []).map((v) => ({
    id: v.id,
    label: v.name
  }))
  const personItems: InlineComboboxItem[] = (persons.data ?? []).map((p) => ({
    id: p.id,
    label: `${p.firstName} ${p.lastName}`
  }))
  const companyItems: InlineComboboxItem[] = (companies.data ?? []).map((c) => ({
    id: c.id,
    label: c.name
  }))

  // ── Shared update mutation ──
  const nudgeFollowUp = useFollowUpNudge()
  const updateMutation = trpcReact.dealMemo.update.useMutation({
    onSuccess: (updated) => {
      utils.dealMemo.getById.invalidate(event.id)
      utils.dealMemo.getAllPaginated.invalidate()
      void utils.tourImport.tours.invalidate()
      if (updated.status === 'pending') {
        void nudgeFollowUp(t('Event aktualisiert'), {
          record: { type: 'event', id: updated.id, name: updated.name },
          note: t('Zusage einholen')
        })
      } else {
        toast.success(t('Event aktualisiert'))
      }
      onSaved()
    },
    onError: (e) => toast.error(t('Speichern fehlgeschlagen'), { description: e.message })
  })

  const handleSave = () => {
    // One save for the whole tab: an invalid clause holds back the other fields too, and says so
    if (radiusDirty && !radiusParsed.ok) {
      toast.error(t('Übersicht nicht gespeichert'), {
        description: t('Gebietsschutz ungültig – {{error}}', { error: radiusParsed.error })
      })
      return
    }
    updateMutation.mutate({
      id: event.id,
      name,
      date,
      status,
      notes,
      tour: tour.trim(),
      ...(radiusDirty && radiusParsed.ok ? radiusParsed.value : {})
    })
  }

  // Save when the page-level "Save All" fires
  useEffect(() => {
    if (saveSignal === lastSaveSignal.current) return
    lastSaveSignal.current = saveSignal
    if (isDirty) handleSave()
  }, [saveSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwapBand = (bandId: number | null) => {
    if (bandId === null) return // band is required — disallow clearing
    updateMutation.mutate({ id: event.id, bandId })
  }

  const handleSwapVenue = (venueId: number | null) => {
    updateMutation.mutate({ id: event.id, venueId })
  }

  const handleSwapPerson = (loProPersonId: number | null) => {
    updateMutation.mutate({ id: event.id, loProPersonId })
  }

  const handleSwapCompany = (loProCompanyId: number | null) => {
    updateMutation.mutate({ id: event.id, loProCompanyId })
  }

  return (
    <div className="space-y-6">
      <Tip id="eventOverview" />
      <EventStatusLine event={event} />

      {/* ── Who takes part: one row each, changed in place ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          {t('Beteiligte')}
        </h3>
        <div className="divide-y rounded-lg border">
          <SwappableEntityCard
            compact
            icon={<Music2 className="h-3.5 w-3.5" />}
            title={t('Band')}
            currentName={event.bandName}
            currentDetail={event.band?.genre || null}
            currentId={event.bandId}
            items={bandItems}
            itemsLoading={bands.isLoading}
            onSwap={handleSwapBand}
            isSaving={updateMutation.isPending}
            nullable={false}
            href={`/band/${event.bandId}`}
            empty={t('Keine Band zugewiesen')}
          />
          <SwappableEntityCard
            compact
            icon={<MapPin className="h-3.5 w-3.5" />}
            title={t('Club / Festival')}
            currentName={event.venueName}
            currentDetail={
              event.venue?.capacity
                ? t('Kapazität: {{formatCapacity}}', {
                    formatCapacity: formatCapacity(event.venue.capacityMin, event.venue.capacity)
                  })
                : null
            }
            currentId={event.venueId}
            items={venueItems}
            itemsLoading={venues.isLoading}
            onSwap={handleSwapVenue}
            isSaving={updateMutation.isPending}
            nullable={true}
            href={event.venueId ? `/venues/${event.venueId}` : undefined}
            empty={t('Kein Club / Festival zugewiesen')}
          />
          <SwappableEntityCard
            compact
            icon={<User className="h-3.5 w-3.5" />}
            title="LoPro-Kontakt"
            currentName={
              event.loProPerson
                ? `${event.loProPerson.firstName} ${event.loProPerson.lastName}`
                : null
            }
            currentId={event.loProPersonId}
            items={personItems}
            itemsLoading={persons.isLoading}
            onSwap={handleSwapPerson}
            isSaving={updateMutation.isPending}
            nullable={true}
            href={event.loProPersonId ? `/persons/${event.loProPersonId}` : undefined}
            empty={t('Kein Kontakt zugewiesen')}
          />
          <SwappableEntityCard
            compact
            icon={<Building2 className="h-3.5 w-3.5" />}
            title="LoPro-Firma"
            currentName={event.loProCompany?.name ?? null}
            currentId={event.loProCompanyId}
            items={companyItems}
            itemsLoading={companies.isLoading}
            onSwap={handleSwapCompany}
            isSaving={updateMutation.isPending}
            nullable={true}
            href={event.loProCompanyId ? `/companies/${event.loProCompanyId}` : undefined}
            empty={t('Keine Firma zugewiesen')}
          />
        </div>
      </div>

      <Separator />

      {/* ── Event Details ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          {t('Eventdetails')}
        </h3>

        {isEditing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('Eventname')}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('Eventname…')}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="eventDate">{t('Datum')}</Label>
                <Input
                  id="eventDate"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>{t('Status')}</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">{t('Ausstehend')}</SelectItem>
                    <SelectItem value="confirmed">{t('Bestätigt')}</SelectItem>
                    <SelectItem value="cancelled">{t('Storniert')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="eventTour">{t('Tour')}</Label>
                <Input
                  id="eventTour"
                  list="event-tours"
                  value={tour}
                  onChange={(e) => setTour(e.target.value)}
                  placeholder={t('z. B. Frühjahr 2027')}
                  maxLength={200}
                />
                <datalist id="event-tours">
                  {(tours.data ?? []).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>

              {mapPreview.enabled && inheritedRadius && (
                <div className="space-y-2">
                  <Label>{t('Gebietsschutz')}</Label>
                  <RadiusFields
                    id="event-radius"
                    value={radiusDraft}
                    onChange={(draft) => {
                      setRadiusKm(draft.km)
                      setWeeksBefore(draft.weeksBefore)
                      setWeeksAfter(draft.weeksAfter)
                    }}
                    inherited={inheritedRadius}
                    error={radiusParsed.ok ? undefined : radiusParsed.error}
                    inheritedFrom={
                      hasOverride(event.venue)
                        ? t('den Club bzw. das Festival')
                        : t('den Standard für {{value}}', {
                            value: event.venue?.kind === 'festival' ? t('Festivals') : t('Clubs')
                          })
                    }
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>{t('Anmerkungen')}</Label>
              <Textarea
                value={notes ?? ''}
                onChange={(e) => setNotes(e.target.value)}
                rows={6}
                placeholder={t('Zusätzliche Anmerkungen zu diesem Event…')}
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Name, date and status are in the page header; they are edited here */}
            <ReadOnlyField
              label={t('Anmerkungen')}
              value={notes}
              placeholder={t('Keine Anmerkungen')}
            />
            <ReadOnlyField
              label={t('Tour')}
              value={tour}
              placeholder={t('Keiner Tour zugeordnet')}
            />
            {mapPreview.enabled && inheritedRadius && (
              <ReadOnlyField
                label={t('Gebietsschutz')}
                value={`${formatClause(inheritClause(event, inheritedRadius))} (${
                  hasOverride(event)
                    ? t('für dieses Event angepasst')
                    : hasOverride(event.venue)
                      ? t('vom Club/Festival')
                      : t('Standard')
                })`}
              />
            )}
          </div>
        )}
      </div>

      <Separator />

      {/* Maßnahmen (radio spots, posters …) booked for this show */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          {t('Marketing')}
        </h3>
        <MarketingActions
          scope={{ dealMemoId: event.id }}
          bandId={event.bandId}
          preset={{ dealMemoId: event.id, tour: event.tour }}
          compact
        />
      </div>
    </div>
  )
}
