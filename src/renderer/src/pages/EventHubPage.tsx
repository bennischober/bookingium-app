import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { trpcReact } from '@/main'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  ArrowLeft,
  Music2,
  MapPin,
  User,
  Building2,
  ExternalLink,
  Calendar,
  Clock,
  Pencil,
  X,
  Hotel,
  Users,
  Euro,
  Plus,
  ListOrdered
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { InlineCombobox, type InlineComboboxItem } from '@/components/ui/inline-combobox'
import type { DealMemoDetailDto } from 'src/main/api/schemas/deal_memo.schema'
import type { ItineraryDto } from 'src/main/api/schemas/itinerary.schema'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 border-green-200',
  pending: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  cancelled: 'bg-red-100 text-red-800 border-red-200'
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  })
}

// ─── Swappable entity card ────────────────────────────────────────────────────
// Shows a read-only summary of the linked entity. A pencil button reveals an
// inline combobox so the *relationship* can be changed without touching the
// entity's own data.

interface SwappableEntityCardProps {
  icon: React.ReactNode
  title: string
  /** Primary display name of the currently linked entity */
  currentName: string | null | undefined
  /** Optional subtitle line (genre, capacity, …) */
  currentDetail?: string | null
  /** Combobox items for the swap picker */
  items: InlineComboboxItem[]
  itemsLoading?: boolean
  /** ID of the currently linked entity — used to pre-select in the picker */
  currentId?: number | null
  /** Called immediately when the user picks a new value */
  onSwap: (newId: number | null) => void
  isSaving?: boolean
  /** Whether this field can be cleared (nullable FK) */
  nullable?: boolean
  /** "View" navigation target — only shown when entity is set */
  href?: string
  empty?: string
}

function SwappableEntityCard({
  icon,
  title,
  currentName,
  currentDetail,
  currentId,
  items,
  itemsLoading,
  onSwap,
  isSaving,
  nullable = false,
  href,
  empty = 'Not assigned'
}: SwappableEntityCardProps) {
  const [editing, setEditing] = useState(false)
  const hasValue = !!currentName

  const handleSwap = (id: number | null) => {
    onSwap(id)
    setEditing(false)
  }

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
            {icon}
            {title}
          </div>
          <div className="flex items-center gap-1">
            {href && hasValue && !editing && (
              <Link to={href}>
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                  <ExternalLink className="h-3 w-3" />
                  View
                </Button>
              </Link>
            )}
            {editing ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                onClick={() => setEditing(false)}
              >
                <X className="h-3 w-3" />
                Cancel
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => setEditing(true)}
                disabled={isSaving}
              >
                <Pencil className="h-3 w-3" />
                {hasValue ? 'Change' : 'Assign'}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-2">
            <InlineCombobox
              items={items}
              value={currentId}
              onChange={handleSwap}
              placeholder={`Select ${title.toLowerCase()}…`}
              searchPlaceholder={`Search ${title.toLowerCase()}s…`}
              isLoading={itemsLoading}
            />
            {nullable && hasValue && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive w-full"
                onClick={() => handleSwap(null)}
              >
                <X className="h-3 w-3 mr-1" />
                Remove {title.toLowerCase()}
              </Button>
            )}
          </div>
        ) : !hasValue ? (
          <p className="text-sm text-muted-foreground italic">{empty}</p>
        ) : (
          <div className="space-y-0.5">
            <p className="font-semibold">{currentName}</p>
            {currentDetail && (
              <p className="text-sm text-muted-foreground">{currentDetail}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Placeholder tab (Documents only for now) ─────────────────────────────────

function PlaceholderTab({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Clock className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="font-semibold text-lg mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-xs">{description}</p>
    </div>
  )
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

interface OverviewTabProps {
  event: DealMemoDetailDto
  onSaved: () => void
}

function OverviewTab({ event, onSaved }: OverviewTabProps) {
  const utils = trpcReact.useUtils()
  const [name, setName] = useState(event.name)
  const [date, setDate] = useState(event.date)
  const [status, setStatus] = useState(event.status)
  const [notes, setNotes] = useState(event.notes)
  const isDirty =
    name !== event.name ||
    date !== event.date ||
    status !== event.status ||
    notes !== event.notes

  // Keep local state in sync when the server data refreshes
  useEffect(() => {
    setName(event.name)
    setDate(event.date)
    setStatus(event.status)
    setNotes(event.notes)
  }, [event.name, event.date, event.status, event.notes])

  // ── Entity list queries for the swap comboboxes ──
  const bands = trpcReact.band.getListItems.useQuery()
  const venues = trpcReact.venue.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const companies = trpcReact.company.getListItems.useQuery()

  const bandItems: InlineComboboxItem[] = (bands.data ?? []).map((b) => ({ id: b.id, label: b.name }))
  const venueItems: InlineComboboxItem[] = (venues.data ?? []).map((v) => ({ id: v.id, label: v.name }))
  const personItems: InlineComboboxItem[] = (persons.data ?? []).map((p) => ({
    id: p.id,
    label: `${p.firstName} ${p.lastName}`
  }))
  const companyItems: InlineComboboxItem[] = (companies.data ?? []).map((c) => ({ id: c.id, label: c.name }))

  // ── Shared update mutation ──
  const updateMutation = trpcReact.dealMemo.update.useMutation({
    onSuccess: () => {
      utils.dealMemo.getById.invalidate(event.id)
      utils.dealMemo.getAllPaginated.invalidate()
      toast.success('Event updated')
      onSaved()
    },
    onError: (e) => toast.error('Failed to save', { description: e.message })
  })

  const handleSave = () => {
    updateMutation.mutate({ id: event.id, name, date, status, notes })
  }

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
          href="/band"
          empty="No band assigned"
        />
        <SwappableEntityCard
          icon={<MapPin className="h-3.5 w-3.5" />}
          title="Venue"
          currentName={event.venueName}
          currentDetail={
            event.venue?.capacity ? `Capacity: ${event.venue.capacity.toLocaleString()}` : null
          }
          currentId={event.venueId}
          items={venueItems}
          itemsLoading={venues.isLoading}
          onSwap={handleSwapVenue}
          isSaving={updateMutation.isPending}
          nullable={true}
          empty="No venue assigned"
        />
      </div>

      {/* ── LoPro cards ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Local Promoter
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <SwappableEntityCard
            icon={<User className="h-3.5 w-3.5" />}
            title="Contact Person"
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
            href="/persons"
            empty="No contact assigned"
          />
          <SwappableEntityCard
            icon={<Building2 className="h-3.5 w-3.5" />}
            title="Company"
            currentName={event.loProCompany?.name ?? null}
            currentId={event.loProCompanyId}
            items={companyItems}
            itemsLoading={companies.isLoading}
            onSwap={handleSwapCompany}
            isSaving={updateMutation.isPending}
            nullable={true}
            href="/companies"
            empty="No company assigned"
          />
        </div>
      </div>

      <Separator />

      {/* ── Inline editable fields ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Event Details
        </h3>
        <div className="space-y-4 max-w-md">
          <div className="space-y-2">
            <Label htmlFor="name">Event Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Event name…"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="eventDate">Date</Label>
            <Input
              id="eventDate"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Additional notes about this event…"
            />
          </div>

          {isDirty && (
            <Button
              onClick={handleSave}
              disabled={updateMutation.isPending}
              size="sm"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Financials tab ───────────────────────────────────────────────────────────

interface FinancialsTabProps {
  event: DealMemoDetailDto
}

function FinancialsTab({ event }: FinancialsTabProps) {
  const utils = trpcReact.useUtils()

  const [deal, setDeal] = useState(event.deal ?? '')
  const [vvk, setVvk] = useState(event.ticketPriceVvk?.toString() ?? '')
  const [ak, setAk] = useState(event.ticketPriceAk?.toString() ?? '')
  const [posters, setPosters] = useState(event.posters ?? '')

  const isDealDirty = deal !== (event.deal ?? '')
  const isPricesDirty =
    (parseFloat(vvk) || null) !== event.ticketPriceVvk ||
    (parseFloat(ak) || null) !== event.ticketPriceAk
  const isPostersDirty = posters !== (event.posters ?? '')

  useEffect(() => {
    setDeal(event.deal ?? '')
    setVvk(event.ticketPriceVvk?.toString() ?? '')
    setAk(event.ticketPriceAk?.toString() ?? '')
    setPosters(event.posters ?? '')
  }, [event.deal, event.ticketPriceVvk, event.ticketPriceAk, event.posters])

  const updateMutation = trpcReact.dealMemo.update.useMutation({
    onSuccess: () => {
      utils.dealMemo.getById.invalidate(event.id)
      toast.success('Saved')
    },
    onError: (e) => toast.error('Failed to save', { description: e.message })
  })

  const handleSaveDeal = () => {
    updateMutation.mutate({ id: event.id, deal })
  }

  const handleSavePrices = () => {
    updateMutation.mutate({
      id: event.id,
      ticketPriceVvk: vvk ? parseFloat(vvk) : null,
      ticketPriceAk: ak ? parseFloat(ak) : null
    })
  }

  const handleSavePosters = () => {
    updateMutation.mutate({ id: event.id, posters })
  }

  return (
    <div className="space-y-8 max-w-lg">
      {/* ── Deal terms ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Deal
        </h3>
        <div className="space-y-2">
          <Label htmlFor="deal-terms">Deal Terms</Label>
          <Input
            id="deal-terms"
            placeholder="e.g. 70/30, flat fee €2 000, guarantee €1 500 + 80%…"
            value={deal}
            onChange={(e) => setDeal(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The financial split or fee arrangement for this show.
          </p>
        </div>
        {isDealDirty && (
          <Button className="mt-3" onClick={handleSaveDeal} disabled={updateMutation.isPending} size="sm">
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>

      <Separator />

      {/* ── Ticket prices ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Euro className="h-4 w-4" />
          Ticket Prices
        </h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="vvk">Advance Sale (VVK)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  €
                </span>
                <Input
                  id="vvk"
                  type="number"
                  step="0.01"
                  min="0"
                  className="pl-7"
                  placeholder="0.00"
                  value={vvk}
                  onChange={(e) => setVvk(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ak">Box Office (AK)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  €
                </span>
                <Input
                  id="ak"
                  type="number"
                  step="0.01"
                  min="0"
                  className="pl-7"
                  placeholder="0.00"
                  value={ak}
                  onChange={(e) => setAk(e.target.value)}
                />
              </div>
            </div>
          </div>
          {isPricesDirty && (
            <Button onClick={handleSavePrices} disabled={updateMutation.isPending} size="sm">
              {updateMutation.isPending ? 'Saving…' : 'Save Prices'}
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* ── Posters / marketing ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
          Marketing
        </h3>
        <div className="space-y-2">
          <Label htmlFor="posters">Posters</Label>
          <Input
            id="posters"
            placeholder="e.g. 50× A1, 100× A3 flyers…"
            value={posters}
            onChange={(e) => setPosters(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            What print materials need to be provided for this show?
          </p>
        </div>
        {isPostersDirty && (
          <Button
            className="mt-3"
            onClick={handleSavePosters}
            disabled={updateMutation.isPending}
            size="sm"
          >
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Itinerary tab ────────────────────────────────────────────────────────────

/** Labeled time row used in the day schedule form. */
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

interface ItineraryTabProps {
  event: DealMemoDetailDto
}

function ItineraryTab({ event }: ItineraryTabProps) {
  const utils = trpcReact.useUtils()

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

  // ── Day schedule (itinerary table) ──
  const { data: itinerary, isLoading: itineraryLoading } =
    trpcReact.itinerary.getByDealMemoId.useQuery(event.id)

  type ScheduleState = Omit<ItineraryDto, 'id' | 'dealMemoId' | 'createdAt' | 'updatedAt'>
  const emptySchedule: ScheduleState = {
    getIn: '', loadIn: '', soundCheckMainAct: '', soundCheckSupport: '',
    dinner: '', doors: '', showTimeMainAct: '', showTimeSupport: '',
    curfewStage: '', curfewVenue: '', showLength: '', notes: ''
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
      toast.success('Saved')
    },
    onError: (e) => toast.error('Failed to save', { description: e.message })
  })

  const itineraryMutation = trpcReact.itinerary.upsert.useMutation({
    onSuccess: () => {
      utils.itinerary.getByDealMemoId.invalidate(event.id)
      toast.success('Schedule saved')
    },
    onError: (e) => toast.error('Failed to save schedule', { description: e.message })
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
    <div className="space-y-8">
      {/* ── Hotel / Accommodation ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Hotel className="h-4 w-4" />
          Accommodation
        </h3>
        <div className="space-y-4">
          <div className="max-w-sm">
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
              empty="No hotel assigned"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
            <div className="space-y-2">
              <Label htmlFor="amountOfPeople" className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                Number of People
              </Label>
              <Input
                id="amountOfPeople"
                type="number"
                min="0"
                placeholder="0"
                value={amountOfPeople}
                onChange={(e) => setAmountOfPeople(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Total headcount requiring accommodation</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="roomInfo">Room Configuration</Label>
              <Textarea
                id="roomInfo"
                rows={3}
                placeholder="e.g. 1× single, 2× double, 1× triple…"
                value={roomInformation}
                onChange={(e) => setRoomInformation(e.target.value)}
              />
            </div>
          </div>

          {isAccommoDirty && (
            <Button onClick={handleSaveAccommo} disabled={dealMemoMutation.isPending} size="sm">
              {dealMemoMutation.isPending ? 'Saving…' : 'Save Accommodation'}
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* ── Performance Terms ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <Music2 className="h-4 w-4" />
          Performance Terms
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Agreed-upon deal terms — the confirmed day-of schedule is managed below.
        </p>
        <div className="space-y-4 max-w-md">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="perfTime">Show Time</Label>
              <Input
                id="perfTime"
                type="time"
                value={performanceTime}
                onChange={(e) => setPerformanceTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="perfDuration">Duration</Label>
              <Input
                id="perfDuration"
                placeholder="e.g. 90 min"
                value={performanceDuration}
                onChange={(e) => setPerformanceDuration(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="perfInfo">Performance Notes</Label>
            <Textarea
              id="perfInfo"
              rows={3}
              placeholder="e.g. pyrotechnics, special requirements…"
              value={performanceInformation}
              onChange={(e) => setPerformanceInformation(e.target.value)}
            />
          </div>
          {isPerfDirty && (
            <Button onClick={handleSavePerf} disabled={dealMemoMutation.isPending} size="sm">
              {dealMemoMutation.isPending ? 'Saving…' : 'Save Performance Terms'}
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* ── Day Schedule ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
          <ListOrdered className="h-4 w-4" />
          Day Schedule
        </h3>

        {itineraryLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !itinerary ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              No day schedule yet. Add one to track get-in times, soundchecks, and show times.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveSchedule}
              disabled={itineraryMutation.isPending}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create Schedule
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            <Card className="max-w-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium">Running Order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <TimeRow label="Get-in" value={schedule.getIn} onChange={set('getIn')} />
                <TimeRow label="Load-in" value={schedule.loadIn} onChange={set('loadIn')} />
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
                <TimeRow label="Dinner" value={schedule.dinner} onChange={set('dinner')} />
                <TimeRow label="Doors" value={schedule.doors} onChange={set('doors')} />
                <Separator className="my-1" />
                <TimeRow
                  label="Support Act"
                  value={schedule.showTimeSupport}
                  onChange={set('showTimeSupport')}
                />
                <TimeRow
                  label="Main Act"
                  value={schedule.showTimeMainAct}
                  onChange={set('showTimeMainAct')}
                />
                {/* Show Length — duration in minutes, not a clock time */}
                <div className="grid grid-cols-[200px_1fr] items-center gap-3">
                  <Label className="text-right text-muted-foreground text-sm">Show Length</Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min="0"
                      placeholder="e.g. 90"
                      value={schedule.showLength}
                      onChange={(e) => set('showLength')(e.target.value)}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">min</span>
                  </div>
                </div>
                <Separator className="my-1" />
                <TimeRow
                  label="Curfew (Stage)"
                  value={schedule.curfewStage}
                  onChange={set('curfewStage')}
                />
                <TimeRow
                  label="Curfew (Venue)"
                  value={schedule.curfewVenue}
                  onChange={set('curfewVenue')}
                />
              </CardContent>
            </Card>

            <div className="space-y-2 max-w-md">
              <Label>Schedule Notes</Label>
              <Textarea
                rows={3}
                value={schedule.notes}
                onChange={(e) => set('notes')(e.target.value)}
                placeholder="Any additional info for this day…"
              />
            </div>

            <Button onClick={handleSaveSchedule} disabled={itineraryMutation.isPending} size="sm">
              {itineraryMutation.isPending ? 'Saving…' : 'Save Schedule'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function EventHubPage() {
  const { eventId } = useParams({ strict: false }) as { eventId?: string }
  const navigate = useNavigate()

  const { data: event, isLoading, isError } = trpcReact.dealMemo.getById.useQuery(
    Number(eventId),
    { enabled: !!eventId }
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading event…</p>
      </div>
    )
  }

  if (isError || !event) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Event not found.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/events' })}>
          Back to Events
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-full h-full p-6">
      {/* ── Page header ── */}
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 gap-1.5 text-muted-foreground"
          onClick={() => navigate({ to: '/events' })}
        >
          <ArrowLeft className="h-4 w-4" />
          All Events
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{event.name}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {formatDate(event.date)}
              </span>
              {event.venueName && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {event.venueName}
                  </span>
                </>
              )}
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn('capitalize mt-1 shrink-0', STATUS_STYLES[event.status] ?? '')}
          >
            {event.status}
          </Badge>
        </div>
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="overview" className="flex-1">
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="itinerary">Itinerary</TabsTrigger>
          <TabsTrigger value="financials">Financials</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab event={event} onSaved={() => {}} />
        </TabsContent>

        <TabsContent value="itinerary">
          <ItineraryTab event={event} />
        </TabsContent>

        <TabsContent value="financials">
          <FinancialsTab event={event} />
        </TabsContent>

        <TabsContent value="documents">
          <PlaceholderTab
            title="Documents"
            description="Generate and manage Deal Memos, Contracts and Invoices from this tab."
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default EventHubPage
