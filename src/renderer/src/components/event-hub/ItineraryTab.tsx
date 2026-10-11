import { useState, useEffect, useRef } from 'react'
import { trpcReact } from '@/main'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Hotel, Users, Music2, ListOrdered, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { type InlineComboboxItem } from '@/components/ui/inline-combobox'
import type { DealMemoDetailDto } from 'src/main/api/schemas/deal_memo.schema'
import type { ItineraryDto } from 'src/main/api/schemas/itinerary.schema'
import { SwappableEntityCard } from './SwappableEntityCard'
import { ReadOnlyField } from './ReadOnlyField'

// ─── Local helpers ────────────────────────────────────────────────────────────

/** Labeled time input row used in the day-schedule edit form. */
function TimeRow({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-3">
      <Label className="text-right text-muted-foreground text-sm">{label}</Label>
      <Input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-32"
      />
    </div>
  )
}

/** Read-only counterpart — used in the day-schedule view. */
function ReadOnlyTimeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[200px_1fr] items-center gap-3">
      <span className="text-right text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-mono">
        {value || <span className="text-muted-foreground italic">—</span>}
      </span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface ItineraryTabProps {
  event: DealMemoDetailDto
  isEditing: boolean
  saveSignal: number
  cancelSignal: number
}

export function ItineraryTab({ event, isEditing, saveSignal, cancelSignal }: ItineraryTabProps) {
  const utils = trpcReact.useUtils()
  const lastSaveSignal = useRef(saveSignal)

  // ── Hotel / accommodation state (saved to deal_memo) ──
  const hotels = trpcReact.hotel.getListItems.useQuery()
  const hotelItems: InlineComboboxItem[] = (hotels.data ?? []).map((h) => ({
    id: h.id,
    label: h.name
  }))

  const [amountOfPeople, setAmountOfPeople] = useState(event.amountOfPeople?.toString() ?? '')
  const [roomInformation, setRoomInformation] = useState(event.roomInformation ?? '')
  const isAccommoDirty =
    (parseInt(amountOfPeople) || null) !== event.amountOfPeople ||
    roomInformation !== (event.roomInformation ?? '')

  // ── Performance terms state (saved to deal_memo) ──
  const [performanceTime, setPerformanceTime] = useState(event.performanceTime ?? '')
  const [performanceDuration, setPerformanceDuration] = useState(event.performanceDuration ?? '')
  const [performanceInformation, setPerformanceInformation] = useState(
    event.performanceInformation ?? ''
  )
  const isPerfDirty =
    performanceTime !== (event.performanceTime ?? '') ||
    performanceDuration !== (event.performanceDuration ?? '') ||
    performanceInformation !== (event.performanceInformation ?? '')

  useEffect(() => {
    setAmountOfPeople(event.amountOfPeople?.toString() ?? '')
    setRoomInformation(event.roomInformation ?? '')
    setPerformanceTime(event.performanceTime ?? '')
    setPerformanceDuration(event.performanceDuration ?? '')
    setPerformanceInformation(event.performanceInformation ?? '')
  }, [
    event.amountOfPeople,
    event.roomInformation,
    event.performanceTime,
    event.performanceDuration,
    event.performanceInformation
  ])

  // Reset to server values when cancel is triggered
  useEffect(() => {
    if (cancelSignal > 0) {
      setAmountOfPeople(event.amountOfPeople?.toString() ?? '')
      setRoomInformation(event.roomInformation ?? '')
      setPerformanceTime(event.performanceTime ?? '')
      setPerformanceDuration(event.performanceDuration ?? '')
      setPerformanceInformation(event.performanceInformation ?? '')
      if (itinerary) {
        setSchedule({
          getIn: itinerary.getIn,
          loadIn: itinerary.loadIn,
          soundCheckMainAct: itinerary.soundCheckMainAct,
          soundCheckSupport: itinerary.soundCheckSupport,
          dinner: itinerary.dinner,
          doors: itinerary.doors,
          showTimeMainAct: itinerary.showTimeMainAct,
          showTimeSupport: itinerary.showTimeSupport,
          curfewStage: itinerary.curfewStage,
          curfewVenue: itinerary.curfewVenue,
          showLength: itinerary.showLength,
          notes: itinerary.notes
        })
      } else {
        setSchedule(emptySchedule)
      }
    }
  }, [cancelSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save when the page-level "Save All" fires
  useEffect(() => {
    if (saveSignal === lastSaveSignal.current) return
    lastSaveSignal.current = saveSignal
    if (isAccommoDirty) handleSaveAccommo()
    if (isPerfDirty) handleSavePerf()
    if (itinerary) handleSaveSchedule()
  }, [saveSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Day schedule (itinerary table) ──
  const { data: itinerary, isLoading: itineraryLoading } =
    trpcReact.itinerary.getByDealMemoId.useQuery(event.id)

  type ScheduleState = Omit<ItineraryDto, 'id' | 'dealMemoId' | 'createdAt' | 'updatedAt'>
  const emptySchedule: ScheduleState = {
    getIn: '',
    loadIn: '',
    soundCheckMainAct: '',
    soundCheckSupport: '',
    dinner: '',
    doors: '',
    showTimeMainAct: '',
    showTimeSupport: '',
    curfewStage: '',
    curfewVenue: '',
    showLength: '',
    notes: ''
  }
  const [schedule, setSchedule] = useState<ScheduleState>(emptySchedule)

  useEffect(() => {
    if (itinerary) {
      setSchedule({
        getIn: itinerary.getIn,
        loadIn: itinerary.loadIn,
        soundCheckMainAct: itinerary.soundCheckMainAct,
        soundCheckSupport: itinerary.soundCheckSupport,
        dinner: itinerary.dinner,
        doors: itinerary.doors,
        showTimeMainAct: itinerary.showTimeMainAct,
        showTimeSupport: itinerary.showTimeSupport,
        curfewStage: itinerary.curfewStage,
        curfewVenue: itinerary.curfewVenue,
        showLength: itinerary.showLength,
        notes: itinerary.notes
      })
    }
  }, [itinerary])

  const set = (key: keyof ScheduleState) => (value: string) =>
    setSchedule((prev) => ({ ...prev, [key]: value }))

  // ── Mutations ──
  const dealMemoMutation = trpcReact.dealMemo.update.useMutation({
    onSuccess: () => {
      utils.dealMemo.getById.invalidate(event.id)
      toast.success('Gespeichert')
    },
    onError: (e) => toast.error('Speichern fehlgeschlagen', { description: e.message })
  })

  const itineraryMutation = trpcReact.itinerary.upsert.useMutation({
    onSuccess: () => {
      utils.itinerary.getByDealMemoId.invalidate(event.id)
      toast.success('Tagesablauf gespeichert')
    },
    onError: (e) =>
      toast.error('Tagesablauf konnte nicht gespeichert werden', { description: e.message })
  })

  const handleSwapHotel = (hotelId: number | null) => {
    dealMemoMutation.mutate({ id: event.id, hotelId })
  }

  const handleSaveAccommo = () => {
    dealMemoMutation.mutate({
      id: event.id,
      amountOfPeople: amountOfPeople ? parseInt(amountOfPeople) : null,
      roomInformation: roomInformation || null
    })
  }

  const handleSavePerf = () => {
    dealMemoMutation.mutate({
      id: event.id,
      performanceTime: performanceTime || null,
      performanceDuration: performanceDuration || null,
      performanceInformation: performanceInformation || null
    })
  }

  const handleSaveSchedule = () => {
    itineraryMutation.mutate({
      dealMemoId: event.id,
      ...schedule
    })
  }

  return (
    <div className="space-y-6">
      {/* ── Accommodation & Performance Terms (2-column on larger screens) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Hotel / Accommodation ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <Hotel className="h-4 w-4" />
            Unterkunft
          </h3>
          <div className="space-y-4">
            <div>
              <SwappableEntityCard
                icon={<Hotel className="h-3.5 w-3.5" />}
                title="Hotel"
                currentName={event.hotel?.name ?? null}
                currentId={event.hotelId}
                items={hotelItems}
                itemsLoading={hotels.isLoading}
                onSwap={handleSwapHotel}
                isSaving={dealMemoMutation.isPending}
                nullable={true}
                empty="Kein Hotel zugewiesen"
              />
            </div>

            {isEditing ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="amountOfPeople" className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    Anzahl der Personen
                  </Label>
                  <Input
                    id="amountOfPeople"
                    type="number"
                    min="0"
                    placeholder="0"
                    value={amountOfPeople}
                    onChange={(e) => setAmountOfPeople(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Gesamte Personen, die eine Unterkunft benötigen
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="roomInfo">Zimmeraufteilung</Label>
                  <Textarea
                    id="roomInfo"
                    rows={3}
                    placeholder="z. B. 1× Einzelzimmer, 2× Doppelzimmer, 1× Dreibettzimmer…"
                    value={roomInformation}
                    onChange={(e) => setRoomInformation(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <ReadOnlyField
                  label="Anzahl der Personen"
                  value={amountOfPeople || null}
                  placeholder="Nicht angegeben"
                />
                <ReadOnlyField
                  label="Zimmeraufteilung"
                  value={roomInformation || null}
                  placeholder="Nicht angegeben"
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Performance Terms ── */}
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
            <Music2 className="h-4 w-4" />
            Auftrittsdaten
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Vereinbarte Deal-Konditionen — der bestätigte Tagesablauf wird unten verwaltet.
          </p>
          {isEditing ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="perfTime">Show-Zeit</Label>
                  <Input
                    id="perfTime"
                    type="time"
                    value={performanceTime}
                    onChange={(e) => setPerformanceTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="perfDuration">Dauer</Label>
                  <Input
                    id="perfDuration"
                    placeholder="z. B. 90 min"
                    value={performanceDuration}
                    onChange={(e) => setPerformanceDuration(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="perfInfo">Anmerkungen zum Auftritt</Label>
                <Textarea
                  id="perfInfo"
                  rows={3}
                  placeholder="z. B. Pyrotechnik, besondere Anforderungen…"
                  value={performanceInformation}
                  onChange={(e) => setPerformanceInformation(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <ReadOnlyField
                  label="Show-Zeit"
                  value={performanceTime || null}
                  placeholder="Nicht festgelegt"
                />
                <ReadOnlyField
                  label="Dauer"
                  value={performanceDuration || null}
                  placeholder="Nicht festgelegt"
                />
              </div>
              <ReadOnlyField
                label="Anmerkungen zum Auftritt"
                value={performanceInformation || null}
                placeholder="Keine Anmerkungen"
              />
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* ── Day Schedule ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <ListOrdered className="h-4 w-4" />
          Tagesablauf
        </h3>

        {itineraryLoading ? (
          <p className="text-sm text-muted-foreground">Lädt…</p>
        ) : !itinerary ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              Noch kein Tagesablauf vorhanden. Legen Sie einen an, um Aufbauzeiten, Soundchecks und
              Show-Zeiten zu erfassen.
            </p>
            {isEditing && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleSaveSchedule}
                disabled={itineraryMutation.isPending}
              >
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                Tagesablauf anlegen
              </Button>
            )}
          </div>
        ) : isEditing ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Ablauf</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <TimeRow label="Aufbau (Get-in)" value={schedule.getIn} onChange={set('getIn')} />
                <TimeRow label="Laden (Load-in)" value={schedule.loadIn} onChange={set('loadIn')} />
                <Separator className="my-1" />
                <TimeRow
                  label="Soundcheck (Main Act)"
                  value={schedule.soundCheckMainAct}
                  onChange={set('soundCheckMainAct')}
                />
                <TimeRow
                  label="Soundcheck (Support)"
                  value={schedule.soundCheckSupport}
                  onChange={set('soundCheckSupport')}
                />
                <Separator className="my-1" />
                <TimeRow label="Abendessen" value={schedule.dinner} onChange={set('dinner')} />
                <TimeRow label="Einlass" value={schedule.doors} onChange={set('doors')} />
                <Separator className="my-1" />
                <TimeRow
                  label="Vorgruppe"
                  value={schedule.showTimeSupport}
                  onChange={set('showTimeSupport')}
                />
                <TimeRow
                  label="Hauptact"
                  value={schedule.showTimeMainAct}
                  onChange={set('showTimeMainAct')}
                />
                <div className="grid grid-cols-[200px_1fr] items-center gap-3">
                  <Label className="text-right text-muted-foreground text-sm">Showlänge</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder="z. B. 90"
                      value={schedule.showLength}
                      onChange={(e) => set('showLength')(e.target.value)}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                </div>
                <Separator className="my-1" />
                <TimeRow
                  label="Sperrzeit (Bühne)"
                  value={schedule.curfewStage}
                  onChange={set('curfewStage')}
                />
                <TimeRow
                  label="Sperrzeit (Venue)"
                  value={schedule.curfewVenue}
                  onChange={set('curfewVenue')}
                />
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label>Tagesablauf-Anmerkungen</Label>
              <Textarea
                rows={12}
                value={schedule.notes}
                onChange={(e) => set('notes')(e.target.value)}
                placeholder="Weitere Infos für diesen Tag…"
              />
            </div>
          </div>
        ) : (
          /* Read-only schedule view */
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium">Ablauf</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ReadOnlyTimeRow label="Aufbau (Get-in)" value={schedule.getIn} />
              <ReadOnlyTimeRow label="Laden (Load-in)" value={schedule.loadIn} />
              <Separator className="my-1" />
              <ReadOnlyTimeRow label="Soundcheck (Main Act)" value={schedule.soundCheckMainAct} />
              <ReadOnlyTimeRow label="Soundcheck (Support)" value={schedule.soundCheckSupport} />
              <Separator className="my-1" />
              <ReadOnlyTimeRow label="Abendessen" value={schedule.dinner} />
              <ReadOnlyTimeRow label="Einlass" value={schedule.doors} />
              <Separator className="my-1" />
              <ReadOnlyTimeRow label="Vorgruppe" value={schedule.showTimeSupport} />
              <ReadOnlyTimeRow label="Hauptact" value={schedule.showTimeMainAct} />
              <div className="grid grid-cols-[200px_1fr] items-center gap-3">
                <span className="text-right text-sm text-muted-foreground">Showlänge</span>
                <span className="text-sm font-mono">
                  {schedule.showLength ? (
                    `${schedule.showLength} min`
                  ) : (
                    <span className="text-muted-foreground italic">—</span>
                  )}
                </span>
              </div>
              <Separator className="my-1" />
              <ReadOnlyTimeRow label="Sperrzeit (Bühne)" value={schedule.curfewStage} />
              <ReadOnlyTimeRow label="Sperrzeit (Venue)" value={schedule.curfewVenue} />
              {schedule.notes && (
                <>
                  <Separator className="my-1" />
                  <div className="pt-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                      Anmerkungen
                    </p>
                    <p className="text-sm">{schedule.notes}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
