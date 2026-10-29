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
import { toast } from 'sonner'
import { type InlineComboboxItem } from '@/components/ui/inline-combobox'
import type { DealMemoDetailDto } from 'src/main/api/schemas/deal_memo.schema'
import { useFollowUpNudge } from '@/hooks/useFollowUpNudge'
import { SwappableEntityCard } from './SwappableEntityCard'
import { ReadOnlyField } from './ReadOnlyField'
import { formatDate } from './constants'

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Bestätigt',
  pending: 'Ausstehend',
  cancelled: 'Storniert'
}

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
  const isDirty =
    name !== event.name || date !== event.date || status !== event.status || notes !== event.notes

  // Reset to server values when cancel is triggered
  useEffect(() => {
    if (cancelSignal > 0) {
      setName(event.name)
      setDate(event.date)
      setStatus(event.status)
      setNotes(event.notes)
    }
  }, [cancelSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Entity list queries for the swap comboboxes ──
  const bands = trpcReact.band.getListItems.useQuery()
  const venues = trpcReact.venue.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const companies = trpcReact.company.getListItems.useQuery()

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
      if (updated.status === 'pending') {
        void nudgeFollowUp('Event aktualisiert', {
          record: { type: 'event', id: updated.id, name: updated.name },
          note: 'Zusage einholen'
        })
      } else {
        toast.success('Event aktualisiert')
      }
      onSaved()
    },
    onError: (e) => toast.error('Speichern fehlgeschlagen', { description: e.message })
  })

  const handleSave = () => {
    updateMutation.mutate({ id: event.id, name, date, status, notes })
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
      {/* ── Entity cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SwappableEntityCard
          icon={<Music2 className="h-3.5 w-3.5" />}
          title="Band"
          currentName={event.bandName}
          currentDetail={event.band?.genre || null}
          currentId={event.bandId}
          items={bandItems}
          itemsLoading={bands.isLoading}
          onSwap={handleSwapBand}
          isSaving={updateMutation.isPending}
          nullable={false}
          href={`/band/${event.bandId}`}
          empty="Keine Band zugewiesen"
        />
        <SwappableEntityCard
          icon={<MapPin className="h-3.5 w-3.5" />}
          title="Club / Festival"
          currentName={event.venueName}
          currentDetail={
            event.venue?.capacity ? `Kapazität: ${event.venue.capacity.toLocaleString()}` : null
          }
          currentId={event.venueId}
          items={venueItems}
          itemsLoading={venues.isLoading}
          onSwap={handleSwapVenue}
          isSaving={updateMutation.isPending}
          nullable={true}
          href={event.venueId ? `/venues/${event.venueId}` : undefined}
          empty="Kein Club / Festival zugewiesen"
        />
      </div>

      {/* ── LoPro cards ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Lokale Veranstalter (Local Promoter)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SwappableEntityCard
            icon={<User className="h-3.5 w-3.5" />}
            title="Kontaktperson"
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
            empty="Kein Kontakt zugewiesen"
          />
          <SwappableEntityCard
            icon={<Building2 className="h-3.5 w-3.5" />}
            title="Firma"
            currentName={event.loProCompany?.name ?? null}
            currentId={event.loProCompanyId}
            items={companyItems}
            itemsLoading={companies.isLoading}
            onSwap={handleSwapCompany}
            isSaving={updateMutation.isPending}
            nullable={true}
            href={event.loProCompanyId ? `/companies/${event.loProCompanyId}` : undefined}
            empty="Keine Firma zugewiesen"
          />
        </div>
      </div>

      <Separator />

      {/* ── Event Details ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Eventdetails
        </h3>

        {isEditing ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Eventname</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Eventname…"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="eventDate">Datum</Label>
                <Input
                  id="eventDate"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Ausstehend</SelectItem>
                    <SelectItem value="confirmed">Bestätigt</SelectItem>
                    <SelectItem value="cancelled">Storniert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Anmerkungen</Label>
              <Textarea
                value={notes ?? ''}
                onChange={(e) => setNotes(e.target.value)}
                rows={6}
                placeholder="Zusätzliche Anmerkungen zu diesem Event…"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <ReadOnlyField label="Eventname" value={name} />
              <ReadOnlyField label="Datum" value={date ? formatDate(date) : null} />
              <ReadOnlyField
                label="Status"
                value={status ? (STATUS_LABELS[status] ?? status) : null}
              />
            </div>

            <div className="space-y-4">
              <ReadOnlyField label="Anmerkungen" value={notes} placeholder="Keine Anmerkungen" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
