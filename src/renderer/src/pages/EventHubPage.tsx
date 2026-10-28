import { MailHistoryPanel } from '@/components/mail/MailHistoryPanel'
import { useMailClientEnabled } from '@/hooks/useMailClientEnabled'
import { useDetailTab } from '@/hooks/useDetailTab'
import { useState } from 'react'
import { useParams, useNavigate, useBlocker } from '@tanstack/react-router'
import { confirmAction } from '@/lib/confirm'
import { trpcReact } from '@/lib/trpc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { FollowUpButton, RecordFollowUps } from '@/components/follow-ups/RecordFollowUps'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Calendar, MapPin, Pencil, X, Check, FileSignature } from 'lucide-react'
import { STATUS_LABELS, STATUS_STYLES, formatDate } from '@/components/event-hub/constants'
import { OverviewTab } from '@/components/event-hub/OverviewTab'
import { FinancialsTab } from '@/components/event-hub/FinancialsTab'
import { ItineraryTab } from '@/components/event-hub/ItineraryTab'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import { BandDocumentsList } from '@/components/documents/BandDocumentsList'
import { isEventTab } from '@/components/event-hub/constants'

export function EventHubPage() {
  const { eventId } = useParams({ strict: false }) as { eventId?: string }
  const navigate = useNavigate()
  const mailClientEnabled = useMailClientEnabled()
  const activeTab = useDetailTab(isEventTab, 'overview')

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

  // Leaving the event while editing would drop the changes of every tab; switching tabs keeps them.
  // No beforeunload: in Electron it would silently keep the window from closing.
  useBlocker({
    shouldBlockFn: async ({ current, next }) =>
      isEditing &&
      current.pathname !== next.pathname &&
      !(await confirmAction({
        title: 'Änderungen verwerfen?',
        description: 'Das Event wird gerade bearbeitet. Ungespeicherte Änderungen gehen verloren.',
        confirmLabel: 'Verwerfen',
        destructive: true
      })),
    enableBeforeUnload: false
  })

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
    <div className="flex flex-col w-full min-w-0 h-full p-6">
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
            <Badge variant="outline" className={STATUS_STYLES[event.status] ?? ''}>
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
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() =>
                    navigate({
                      to: '/events/$eventId/contract/print',
                      params: { eventId: String(event.id) }
                    })
                  }
                  title="Auftrittsvertrag drucken / als PDF speichern"
                >
                  <FileSignature className="h-3.5 w-3.5" />
                  Vertrag
                </Button>
                <FollowUpButton record={{ type: 'event', id: event.id, name: event.name }} />
                <Button size="sm" variant="outline" onClick={handleEdit} className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" />
                  Bearbeiten
                </Button>
              </>
            )}
          </div>
        </div>

        {isEditing && (
          <p className="mt-3 text-xs text-muted-foreground bg-muted/50 border rounded-md px-3 py-2 inline-flex items-center gap-1.5">
            <Pencil className="h-3 w-3" />
            Bearbeitungsmodus – Änderungen in allen Tabs werden gemeinsam gespeichert.
          </p>
        )}
      </div>

      <RecordFollowUps record={{ type: 'event', id: event.id, name: event.name }} />

      {/* ── Tabs ── */}
      <Tabs
        value={activeTab}
        onValueChange={(tab) =>
          // replace: switching tabs should not pile up history entries
          navigate({
            to: '/events/$eventId',
            params: { eventId: String(eventId) },
            search: { tab: isEventTab(tab) && tab !== 'overview' ? tab : undefined },
            replace: true
          })
        }
        className="flex-1"
      >
        {/* Tabs wrap onto a second row in narrow windows */}
        <TabsList className="mb-6 h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="itinerary">Tagesablauf</TabsTrigger>
          <TabsTrigger value="financials">Finanzen</TabsTrigger>
          <TabsTrigger value="documents">Dokumente</TabsTrigger>
          {mailClientEnabled && <TabsTrigger value="mails">E-Mails</TabsTrigger>}
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

        <TabsContent value="documents" className="space-y-8">
          <DocumentsPanel ownerType="event" ownerId={event.id} />
          {/* D1: the band's own documents, read-only here - the rider or tech spec is
              needed on the gig without a second upload */}
          <BandDocumentsList bandId={event.bandId} bandName={event.bandName} />
        </TabsContent>

        {mailClientEnabled && (
          <TabsContent value="mails">
            <MailHistoryPanel entityType="event" entityId={event.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}

export default EventHubPage
