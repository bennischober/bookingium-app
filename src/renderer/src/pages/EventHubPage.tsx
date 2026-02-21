import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { trpcReact } from '@/main'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { ArrowLeft, Music2, MapPin, User, Building2, ExternalLink, Calendar, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { DealMemoDetailDto } from 'src/main/api/schemas/deal_memo.schema'

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

// ─── Entity summary card ──────────────────────────────────────────────────────

interface EntityCardProps {
  icon: React.ReactNode
  title: string
  label: string
  lines: (string | null | undefined)[]
  href?: string
  empty?: string
}

function EntityCard({ icon, title, label, lines, href, empty }: EntityCardProps) {
  const filledLines = lines.filter(Boolean) as string[]

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium uppercase tracking-wider">
            {icon}
            {title}
          </div>
          {href && filledLines.length > 0 && (
            <Link to={href}>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1">
                <ExternalLink className="h-3 w-3" />
                View
              </Button>
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {filledLines.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">{empty ?? 'Not set'}</p>
        ) : (
          <div className="space-y-0.5">
            <p className="font-semibold">{label}</p>
            {filledLines.slice(1).map((line, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                {line}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Placeholder tab ──────────────────────────────────────────────────────────

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
  const [status, setStatus] = useState(event.status)
  const [notes, setNotes] = useState(event.notes)
  const isDirty = status !== event.status || notes !== event.notes

  // Keep local state in sync when the server data refreshes
  useEffect(() => {
    setStatus(event.status)
    setNotes(event.notes)
  }, [event.status, event.notes])

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
    updateMutation.mutate({ id: event.id, status, notes })
  }

  return (
    <div className="space-y-6">
      {/* ── Entity cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <EntityCard
          icon={<Music2 className="h-3.5 w-3.5" />}
          title="Band"
          label={event.bandName}
          lines={[event.bandName, event.band?.genre || null]}
          href="/band"
          empty="No band assigned"
        />
        <EntityCard
          icon={<MapPin className="h-3.5 w-3.5" />}
          title="Venue"
          label={event.venueName ?? ''}
          lines={[
            event.venueName,
            event.venue?.capacity ? `Capacity: ${event.venue.capacity.toLocaleString()}` : null
          ]}
          href="/venues"
          empty="No venue assigned"
        />
      </div>

      {/* ── LoPro cards ── */}
      <div>
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Local Promoter
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EntityCard
            icon={<User className="h-3.5 w-3.5" />}
            title="Contact Person"
            label={
              event.loProPerson
                ? `${event.loProPerson.firstName} ${event.loProPerson.lastName}`
                : ''
            }
            lines={[
              event.loProPerson
                ? `${event.loProPerson.firstName} ${event.loProPerson.lastName}`
                : null
            ]}
            href="/persons"
            empty="No contact assigned"
          />
          <EntityCard
            icon={<Building2 className="h-3.5 w-3.5" />}
            title="Company"
            label={event.loProCompany?.name ?? ''}
            lines={[event.loProCompany?.name ?? null]}
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
            <h1 className="text-2xl font-bold">{event.deal}</h1>
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
          <PlaceholderTab
            title="Itinerary"
            description="Get-in, soundcheck, dinner, show times and curfews will be managed here."
          />
        </TabsContent>

        <TabsContent value="financials">
          <PlaceholderTab
            title="Financials"
            description="Ticket prices, fees, travel costs and settlement details will appear here."
          />
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
