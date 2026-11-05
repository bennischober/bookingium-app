import { useMemo, useState } from 'react'
import { useMapPreview } from '@/hooks/useMapPreview'
import { useNavigate } from '@tanstack/react-router'
import { Map as MapIcon, MapPinOff, Navigation, X } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { localIsoDate } from '@/lib/followUps'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { MultiSelect } from '@/components/ui/multi-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { LeafletMap } from '@/components/map/LeafletMap'
import {
  CONFLICT_KIND_LABELS,
  germanDate,
  MARKER_COLORS,
  markerHref,
  ringWindowLabel,
  UNLOCATED_REASON_LABELS,
  venueAvailability
} from '@/components/map/mapDisplay'
import { formatClause, type RadiusDefaults } from '@/components/map/radiusDisplay'
import type { MapCandidateDto, MapKindFilter } from '../../../main/api/schemas/map.schema'

const SHOW_ALL = 'alle'

/** The map, or a note while "Karte (experimentell)" is off (the menu then has no entry) */
export default function MapPage() {
  const navigate = useNavigate()
  const { enabled, defaults } = useMapPreview()
  if (!defaults) return null
  if (enabled) return <MapPreview defaults={defaults} />
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">Karte</h1>
      <p className="text-sm text-muted-foreground">Die Karte ist ausgeschaltet.</p>
      <Button onClick={() => void navigate({ to: '/settings' })}>Zu den Einstellungen</Button>
    </div>
  )
}

function MapPreview({ defaults }: { defaults: RadiusDefaults }) {
  const bands = trpcReact.band.getListItems.useQuery()
  const allVenues = trpcReact.venue.getListItems.useQuery()
  const [kinds, setKinds] = useState<MapKindFilter[]>([])
  const [bandId, setBandId] = useState<number | null>(null)
  // From today on: past gigs drew rings for every year at once. Clearing the field shows them.
  const [dateFrom, setDateFrom] = useState(() => localIsoDate())
  const [dateTo, setDateTo] = useState('')
  const [focusVenueId, setFocusVenueId] = useState<number | null>(null)
  const [showRings, setShowRings] = useState(true)
  // What if: a venue and a date to check before booking it
  const [candidateVenueId, setCandidateVenueId] = useState<number | null>(null)
  const [candidateDate, setCandidateDate] = useState('')

  const filter = useMemo(
    () => ({
      kinds: kinds.length > 0 ? kinds : undefined,
      bandId: bandId ?? undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      candidate:
        candidateVenueId !== null && candidateDate
          ? { venueId: candidateVenueId, date: candidateDate }
          : undefined
    }),
    [kinds, bandId, dateFrom, dateTo, candidateVenueId, candidateDate]
  )

  const map = trpcReact.map.getData.useQuery(filter, { keepPreviousData: true })

  const located = useMemo(
    () => (map.data?.markers ?? []).filter((marker) => marker.located),
    [map.data]
  )
  const venues = useMemo(() => located.filter((marker) => marker.type === 'venue'), [located])
  const eventCount = located.filter((marker) => marker.type === 'event').length
  const unlocated = map.data?.unlocated ?? []
  const candidate = map.data?.candidate ?? null
  // With a band chosen: how many venues are free, at risk or blocked
  const availability = useMemo(() => {
    const counts = { free: 0, risk: 0, blocked: 0 }
    for (const venue of venues) {
      const state = venueAvailability(venue)
      if (state) counts[state]++
    }
    return counts
  }, [venues])

  return (
    // Scrolls as a whole on a low window, so the map keeps a usable height
    <div className="flex h-full min-h-0 w-full flex-col overflow-y-auto p-6">
      <div className="mb-4">
        <h1 className="mb-2 text-2xl font-bold">Karte</h1>
        <p className="text-sm text-muted-foreground">
          Events, Clubs und Festivals mit ihrem Gebietsschutz: Mit einer Band gewählt zeigt die
          Karte, wo sie noch frei ist. „Anfrage prüfen“ zeigt, was eine Buchung blockieren würde.
        </p>
      </div>

      {/* Filters above the map; the map takes the remaining height */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-1">
          <Label htmlFor="map-kind">Art</Label>
          <MultiSelect
            id="map-kind"
            value={kinds}
            onChange={(value) => setKinds(value as MapKindFilter[])}
            options={[
              { value: 'venue', label: 'Clubs' },
              { value: 'festival', label: 'Festivals' }
            ]}
            placeholder="Alle"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="map-band">Band</Label>
          <SearchableSelect
            id="map-band"
            value={bandId}
            onChange={setBandId}
            options={(bands.data ?? []).map((band) => ({ value: band.id, label: band.name }))}
            noneLabel="Alle Bands"
            searchPlaceholder="Band suchen…"
            emptyText="Keine Bands angelegt."
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="map-date-from">Von</Label>
          <Input
            id="map-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="map-date-to">Bis</Label>
          <Input
            id="map-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="map-venue">Zentrieren auf</Label>
          <Select
            value={focusVenueId === null ? SHOW_ALL : String(focusVenueId)}
            onValueChange={(value) => setFocusVenueId(value === SHOW_ALL ? null : Number(value))}
          >
            <SelectTrigger id="map-venue">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={SHOW_ALL}>Gesamte Karte</SelectItem>
              {venues.map((venue) => (
                <SelectItem key={venue.id} value={String(venue.id)}>
                  {venue.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* What if: the candidate booking */}
      <div className="mb-4 grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <div className="space-y-1">
          <Label htmlFor="map-candidate-venue">Anfrage prüfen: Club / Festival</Label>
          <SearchableSelect
            id="map-candidate-venue"
            value={candidateVenueId}
            onChange={setCandidateVenueId}
            options={(allVenues.data ?? []).map((venue) => ({
              value: venue.id,
              label: venue.name
            }))}
            noneLabel="Keine Anfrage"
            searchPlaceholder="Club / Festival suchen…"
            emptyText="Keine Clubs oder Festivals angelegt."
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="map-candidate-date">Datum der Anfrage</Label>
          <Input
            id="map-candidate-date"
            type="date"
            value={candidateDate}
            onChange={(event) => setCandidateDate(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setCandidateVenueId(null)
            setCandidateDate('')
          }}
          disabled={candidateVenueId === null && !candidateDate}
        >
          <X className="h-4 w-4" />
          Zurücksetzen
        </Button>
      </div>

      <div className="flex min-h-[360px] flex-1 flex-col gap-4 lg:flex-row">
        {/* The map: one fixed frame, no scrolling of its own content. `isolate`
            contains Leaflet's internal z-indexes (panes go up to 700) so the
            portaled dropdowns (body level, z-50) always paint above the map. */}
        <div className="relative isolate min-w-0 flex-1 overflow-hidden rounded-lg border">
          <LeafletMap
            markers={located}
            candidate={candidate}
            focusVenueId={focusVenueId}
            showRings={showRings}
          />
          {/* Legend and ring toggle on top of the tiles (above every Leaflet pane), in the corner
              Leaflet leaves free: zoom sits top left, attribution bottom right */}
          <div className="absolute top-2 right-2 z-[1000] space-y-1 rounded-md border bg-popover/95 p-3 text-xs shadow-sm">
            <div className="font-medium">Legende</div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: MARKER_COLORS.event }}
              />
              Event
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: MARKER_COLORS.venue }}
              />
              Club
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: MARKER_COLORS.festival }}
              />
              Festival
            </div>
            {bandId !== null && (
              <>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block size-2 rounded-full"
                    style={{ background: MARKER_COLORS.blocked }}
                  />
                  Blockiert
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block size-2 rounded-full border-2"
                    style={{ borderColor: MARKER_COLORS.risk }}
                  />
                  Risiko (ausstehend)
                </div>
              </>
            )}
            <div className="flex items-center gap-2 pt-1">
              <span
                className="inline-block size-2 rounded-full border-2"
                style={{ borderColor: MARKER_COLORS.venue }}
              />
              Gebietsschutz (Club)
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block size-2 rounded-full border-2"
                style={{ borderColor: MARKER_COLORS.festival }}
              />
              Gebietsschutz (Festival)
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 border-t-2 border-dashed border-muted-foreground" />
              ausstehend
            </div>
            {candidate && (
              <div className="flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: MARKER_COLORS.candidate }}
                />
                Anfrage
              </div>
            )}
            <label className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                checked={showRings}
                onChange={(event) => setShowRings(event.target.checked)}
              />
              Ringe zeigen
            </label>
          </div>
          {/* Entries without a location, bottom left (the free corner), at every window width:
              each says why and links to where it is fixed */}
          {unlocated.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute bottom-2 left-2 z-[1001] bg-popover/95 shadow-sm"
                >
                  <MapPinOff className="h-4 w-4" />
                  {unlocated.length} nicht auf der Karte
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="max-h-80 w-80 overflow-y-auto p-3 text-sm">
                <p className="mb-2 font-medium">Nicht auf der Karte</p>
                <ul className="space-y-1">
                  {unlocated.map((entry) => (
                    <li key={`${entry.type}-${entry.id}`} className="flex justify-between gap-2">
                      <a
                        href={markerHref(entry)}
                        className="truncate underline-offset-2 hover:underline"
                      >
                        {entry.name}
                      </a>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {UNLOCATED_REASON_LABELS[entry.reason]}
                      </span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
          {/* Loading and empty states overlaying the tiles */}
          {map.isLoading && (
            <div className="absolute inset-0 z-[1000] flex items-center justify-center bg-background/60 text-sm text-muted-foreground">
              Lädt…
            </div>
          )}
          {!map.isLoading && located.length === 0 && (
            <div className="absolute inset-0 z-[1000] flex flex-col items-center justify-center gap-2 bg-background/60 text-center text-sm text-muted-foreground">
              <MapIcon className="h-6 w-6" />
              Keine Treffer für die Filter.
            </div>
          )}
        </div>

        {/* Status beside the map on wide windows, below it on narrow ones */}
        <div className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
          {candidate ? (
            <CandidateCard candidate={candidate} bandChosen={bandId !== null} />
          ) : (
            candidateVenueId !== null &&
            !candidateDate && (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  Ein Datum für die Anfrage wählen.
                </CardContent>
              </Card>
            )
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auf der Karte</CardTitle>
              <CardDescription>
                {eventCount} {eventCount === 1 ? 'Event' : 'Events'} · {venues.length}{' '}
                {venues.length === 1 ? 'Club/Festival' : 'Clubs/Festivals'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {bandId !== null ? (
                <p>
                  Für die Band: {availability.free} frei · {availability.risk} mit Risiko ·{' '}
                  {availability.blocked} blockiert
                </p>
              ) : (
                <p className="text-muted-foreground">
                  Eine Band wählen, um zu sehen, wo sie frei ist und was blockiert.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Standard: Clubs {formatClause(defaults.club)}; Festivals{' '}
                {formatClause(defaults.festival)} (Einstellungen › Allgemein). Eigene Werte für
                einen Club oder ein Festival stehen in seinem Formular, für ein Event in dessen
                Übersicht. Ein Event erscheint, solange sein Gebietsschutz in den Zeitraum fällt.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Hinweise</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <p>
                Adressen werden nur offline über die Postleitzahl verortet; nichts verlässt den
                Rechner. Kartenbilder von OpenStreetMap – dabei sieht der Kartenanbieter, welcher
                Ausschnitt geladen wird.
              </p>
              <p>
                <Navigation className="mr-1 inline h-3 w-3" />
                Einen Club oder ein Festival auswählen, um die Karte darauf zu zentrieren.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

/** The what-if booking: its clause, the venues it would block, the band's events it collides with */
function CandidateCard({
  candidate,
  bandChosen
}: {
  candidate: MapCandidateDto
  bandChosen: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Anfrage: {candidate.name}</CardTitle>
        <CardDescription>Gebietsschutz {ringWindowLabel(candidate.ring)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!candidate.located && (
          <p className="text-muted-foreground">
            Ohne bekannte PLZ nicht auf der Karte; Entfernungen lassen sich nicht prüfen.
          </p>
        )}
        <div>
          <p className="mb-1 font-medium">
            Konflikte mit Events der Band
            {bandChosen && ` (${candidate.conflicts.length})`}
          </p>
          {!bandChosen ? (
            <p className="text-muted-foreground">Eine Band wählen, um ihre Events zu prüfen.</p>
          ) : candidate.conflicts.length === 0 ? (
            <p className="text-muted-foreground">Keine – die Band ist frei.</p>
          ) : (
            <ul className="space-y-1">
              {candidate.conflicts.map((conflict) => (
                <li key={conflict.eventId}>
                  <a
                    href={`#/events/${conflict.eventId}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {conflict.name} · {germanDate(conflict.date)}
                  </a>
                  {conflict.status === 'pending' && ' (ausstehend)'}
                  <span className="block text-xs text-muted-foreground">
                    {conflict.distanceKm !== null && `${conflict.distanceKm} km · `}
                    {CONFLICT_KIND_LABELS[conflict.kind]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-1 font-medium">Würde blockieren ({candidate.blocks.length})</p>
          {candidate.blocks.length === 0 ? (
            <p className="text-muted-foreground">Keine anderen Clubs oder Festivals im Radius.</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-y-auto">
              {candidate.blocks.map((block) => (
                <li key={block.id} className="flex justify-between gap-2">
                  <a
                    href={markerHref({ type: 'venue', kind: block.kind, id: block.id })}
                    className="truncate underline-offset-2 hover:underline"
                  >
                    {block.name}
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {block.distanceKm} km
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
