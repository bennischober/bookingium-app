import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Map as MapIcon, Navigation } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  CLUB_RING_METRES,
  FESTIVAL_RING_METRES,
  MARKER_COLORS,
  ringLabel
} from '@/components/map/mapDisplay'
import type { MapKindFilter } from '../../../main/api/schemas/map.schema'

const SHOW_ALL = 'alle'

/** The map, or a note while "Karte (experimentell)" is off (the menu then has no entry) */
export default function MapPage() {
  const navigate = useNavigate()
  const settings = trpcReact.settings.get.useQuery()
  if (!settings.data) return null
  if (settings.data.mapPreview) return <MapPreview />
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">Karte</h1>
      <p className="text-sm text-muted-foreground">Die Karte ist ausgeschaltet.</p>
      <Button onClick={() => void navigate({ to: '/settings' })}>Zu den Einstellungen</Button>
    </div>
  )
}

function MapPreview() {
  const bands = trpcReact.band.getListItems.useQuery()
  const [kinds, setKinds] = useState<MapKindFilter[]>([])
  const [bandId, setBandId] = useState<number | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [focusVenueId, setFocusVenueId] = useState<number | null>(null)
  const [showRings, setShowRings] = useState(true)

  const filter = useMemo(
    () => ({
      kinds: kinds.length > 0 ? kinds : undefined,
      bandId: bandId ?? undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined
    }),
    [kinds, bandId, dateFrom, dateTo]
  )

  const map = trpcReact.map.getData.useQuery(filter, { keepPreviousData: true })

  const located = useMemo(
    () => (map.data?.markers ?? []).filter((marker) => marker.located),
    [map.data]
  )
  const venues = useMemo(() => located.filter((marker) => marker.type === 'venue'), [located])
  const eventCount = located.filter((marker) => marker.type === 'event').length

  return (
    <div className="flex h-full min-h-0 w-full flex-col p-6">
      <div className="mb-4">
        <h1 className="mb-2 text-2xl font-bold">Karte</h1>
        <p className="text-sm text-muted-foreground">
          Events, Clubs und Festivals mit Radius-Ringen (Gebietsschutz, Vorschlag) – zur Tourplanung
          und zum Prüfen der Ringe auf einen Blick.
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

      <div className="flex min-h-0 flex-1 gap-4">
        {/* The map: one fixed frame, no scrolling of its own content. `isolate`
            contains Leaflet's internal z-indexes (panes go up to 700) so the
            portaled dropdowns (body level, z-50) always paint above the map. */}
        <div className="relative isolate min-w-0 flex-1 overflow-hidden rounded-lg border">
          <LeafletMap markers={located} focusVenueId={focusVenueId} showRings={showRings} />
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
            <div className="flex items-center gap-2 pt-1">
              <span
                className="inline-block size-2 rounded-full border-2"
                style={{ borderColor: MARKER_COLORS.venue }}
              />
              Ring Club: {ringLabel(CLUB_RING_METRES)}
            </div>
            <div className="flex items-center gap-2">
              <span
                className="inline-block size-2 rounded-full border-2"
                style={{ borderColor: MARKER_COLORS.festival }}
              />
              Ring Festival: {ringLabel(FESTIVAL_RING_METRES)}
            </div>
            <label className="flex items-center gap-2 pt-1">
              <input
                type="checkbox"
                checked={showRings}
                onChange={(event) => setShowRings(event.target.checked)}
              />
              Ringe zeigen
            </label>
          </div>
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

        {/* Status beside the map on wide windows */}
        <div className="hidden w-72 shrink-0 flex-col gap-4 lg:flex">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auf der Karte</CardTitle>
              <CardDescription>
                {eventCount} {eventCount === 1 ? 'Event' : 'Events'} · {venues.length}{' '}
                {venues.length === 1 ? 'Club/Festival' : 'Clubs/Festivals'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                Ringe: {ringLabel(CLUB_RING_METRES)} um Events in Clubs,{' '}
                {ringLabel(FESTIVAL_RING_METRES)} um Events in Festivals (Vorschlag, noch zu
                bestätigen).
              </p>
              {(map.data?.unlocated.length ?? 0) > 0 && (
                <div>
                  <p className="font-medium">Nicht auf der Karte</p>
                  <p className="text-muted-foreground">
                    {map.data!.unlocated.length}{' '}
                    {map.data!.unlocated.length === 1 ? 'Eintrag' : 'Einträge'} ohne bekannte
                    Postleitzahl.
                  </p>
                </div>
              )}
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
