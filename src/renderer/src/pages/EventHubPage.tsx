import { useState } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Calendar, MapPin, Pencil, X, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { STATUS_STYLES, formatDate } from '@/components/event-hub/constants'
import { OverviewTab } from '@/components/event-hub/OverviewTab'
import { FinancialsTab } from '@/components/event-hub/FinancialsTab'
import { ItineraryTab } from '@/components/event-hub/ItineraryTab'
import { DocumentsTab } from '@/components/event-hub/DocumentsTab'

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Bestätigt',
  pending: 'Ausstehend',
  cancelled: 'Storniert'
}

export function EventHubPage() {
  const { eventId } = useParams({ strict: false }) as { eventId?: string }
  const navigate = useNavigate()

  const {
    data: event,
    isLoading,
    isError
  } = trpcReact.dealMemo.getById.useQuery(Number(eventId), { enabled: !!eventId })

  // ── Edit-mode state ──
  const [isEditing, setIsEditing] = useState(false)
  // Incrementing these signals tells all tabs to either save or reset their local state
  const [saveSignal, setSaveSignal] = useState(0)
  const [cancelSignal, setCancelSignal] = useState(0)

  const handleEdit = () => setIsEditing(true)

  const handleSaveAll = () => {
    setSaveSignal((n) => n + 1)
    setIsEditing(false)
  }

  const handleDiscard = () => {
    setCancelSignal((n) => n + 1)
    setIsEditing(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Event wird geladen…</p>
      </div>
    )
  }

  if (isError || !event) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">Event nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/events' })}>
          Zurück zu den Events
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
          Alle Events
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

          <div className="flex items-center gap-2 shrink-0 mt-1">
            <Badge
              variant="outline"
              className={cn('capitalize', STATUS_STYLES[event.status] ?? '')}
            >
              {STATUS_LABELS[event.status] ?? event.status}
            </Badge>

            {isEditing ? (
              <>
                <Button size="sm" variant="outline" onClick={handleDiscard} className="gap-1.5">
                  <X className="h-3.5 w-3.5" />
                  Verwerfen
                </Button>
                <Button size="sm" onClick={handleSaveAll} className="gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  Alles speichern
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={handleEdit} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                Bearbeiten
              </Button>
            )}
          </div>
        </div>

        {isEditing && (
          <p className="mt-3 text-xs text-muted-foreground bg-muted/50 border rounded-md px-3 py-2 inline-flex items-center gap-1.5">
            <Pencil className="h-3 w-3" />
            Sie befinden sich im Bearbeitungsmodus. Nehmen Sie Änderungen in beliebigen Tabs vor und
            klicken Sie anschließend auf <strong>Alles speichern</strong> oder{' '}
            <strong>Verwerfen</strong>.
          </p>
        )}
      </div>

      {/* ── Tabs ── */}
      <Tabs defaultValue="overview" className="flex-1">
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="itinerary">Tagesablauf</TabsTrigger>
          <TabsTrigger value="financials">Finanzen</TabsTrigger>
          <TabsTrigger value="documents">Dokumente</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab
            event={event}
            isEditing={isEditing}
            saveSignal={saveSignal}
            cancelSignal={cancelSignal}
            onSaved={() => {}}
          />
        </TabsContent>

        <TabsContent value="itinerary">
          <ItineraryTab
            event={event}
            isEditing={isEditing}
            saveSignal={saveSignal}
            cancelSignal={cancelSignal}
          />
        </TabsContent>

        <TabsContent value="financials">
          <FinancialsTab
            event={event}
            isEditing={isEditing}
            saveSignal={saveSignal}
            cancelSignal={cancelSignal}
          />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsTab event={event} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default EventHubPage
