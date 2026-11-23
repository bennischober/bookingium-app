import { MailHistoryPanel } from '@/components/mail/MailHistoryPanel'
import { useHasMailAccount } from '@/hooks/useHasMailAccount'
import { useDetailTab } from '@/hooks/useDetailTab'
import { useState } from 'react'
import { useParams, useNavigate, useBlocker } from '@tanstack/react-router'
import { confirmAction } from '@/lib/confirm'
import { useRecentRecordVisit } from '@/hooks/useRecentRecords'
import { parseRecordId } from '@/lib/recordId'
import { useEventTabCounts } from '@/hooks/useTabCounts'
import { TabCount } from '@/components/detail/DetailParts'
import { PageErrorState } from '@/components/load-states'
import { isNotFound } from '@/lib/queryErrors'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { FollowUpButton, RecordFollowUps } from '@/components/follow-ups/RecordFollowUps'
import { Button } from '@/components/ui/button'
import {
  ArrowLeft,
  Calendar,
  MapPin,
  Pencil,
  X,
  Check,
  FileSignature,
  Copy,
  FolderInput,
  Trash2
} from 'lucide-react'
import { DuplicateEventWizard } from '@/components/event-wizard/DuplicateEventWizard'
import { ShowFolderDialog } from '@/components/show-folder/ShowFolderDialog'
import { STATUS_LABELS, STATUS_STYLES, formatDate } from '@/components/event-hub/constants'
import { OverviewTab } from '@/components/event-hub/OverviewTab'
import { FinancialsTab } from '@/components/event-hub/FinancialsTab'
import { SettlementTab } from '@/components/event-hub/SettlementTab'
import { AdvancingTab } from '@/components/event-hub/AdvancingTab'
import { TicketsTab } from '@/components/event-hub/TicketsTab'
import { ItineraryTab } from '@/components/event-hub/ItineraryTab'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import { RelatedDocumentsSection } from '@/components/documents/RelatedDocumentsSection'
import { BandDocumentsList } from '@/components/documents/BandDocumentsList'
import { EVENT_TAB_ALIASES, isEventTab } from '@/components/event-hub/constants'
import { MoreActions } from '@/components/detail/MoreActions'
import { TabSection } from '@/components/detail/CompactParts'
import { confirmDelete } from '@/lib/confirm'
import { EventOpenItems } from '@/components/open-items/EventOpenItems'
import { t } from '../../../main/i18n/translate'
import { StaffShareButton } from '@/components/staff/StaffShareButton'

export function EventHubPage() {
  const { eventId } = useParams({ strict: false }) as { eventId?: string }
  const counts = useEventTabCounts(parseRecordId(eventId))
  const navigate = useNavigate()
  const hasMailAccount = useHasMailAccount()
  const activeTab = useDetailTab(isEventTab, 'overview', EVENT_TAB_ALIASES)

  const {
    data: event,
    isLoading,
    isError,
    error,
    refetch
  } = trpcReact.dealMemo.getById.useQuery(Number(eventId), { enabled: !!eventId })
  const utils = trpcReact.useUtils()

  // #162: delete from the detail page, then back to the list
  const deleteEvent = trpcReact.dealMemo.delete.useMutation({
    onSuccess: async () => {
      await navigate({ to: '/events' })
      void utils.dealMemo.invalidate()
      toast.success(t('Event gelöscht'))
    },
    onError: (error) => {
      toast.error(t('Event konnte nicht gelöscht werden'), { description: error.message })
    }
  })

  // ── Edit-mode state ──
  const [isEditing, setIsEditing] = useState(false)
  // #199: the wizard for a new date of this event
  const [duplicating, setDuplicating] = useState(false)
  const [readingFolder, setReadingFolder] = useState(false)
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
        title: t('Änderungen verwerfen?'),
        description: t(
          'Das Event wird gerade bearbeitet. Ungespeicherte Änderungen gehen verloren.'
        ),
        confirmLabel: t('Verwerfen'),
        destructive: true
      })),
    enableBeforeUnload: false
  })

  useRecentRecordVisit(
    event ? { kind: 'event', label: event.name } : null,
    !isLoading && !(isError && !isNotFound(error)) && !event
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">{t('Event wird geladen…')}</p>
      </div>
    )
  }

  if (isError && !isNotFound(error)) {
    return <PageErrorState error={error} onRetry={() => void refetch()} />
  }

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-muted-foreground">{t('Event nicht gefunden.')}</p>
        <Button variant="outline" onClick={() => navigate({ to: '/events' })}>
          {t('Zurück zu den Events')}
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
          {t('Alle Events')}
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
                  {t('Verwerfen')}
                </Button>
                <Button size="sm" onClick={handleSaveAll} className="gap-1.5">
                  <Check className="h-3.5 w-3.5" />
                  {t('Alles speichern')}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setReadingFolder(true)}
                  title={t('Day-/Infosheet, Club-Infos, Mails und Pläne der Agentur einlesen')}
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  {t('Show-Ordner')}
                </Button>
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
                  title={t('Auftrittsvertrag drucken / als PDF speichern')}
                >
                  <FileSignature className="h-3.5 w-3.5" />
                  {t('Vertrag')}
                </Button>
                <StaffShareButton entity="deal_memo" entityId={event.id} />
                <FollowUpButton record={{ type: 'event', id: event.id, name: event.name }} />
                <Button size="sm" variant="outline" onClick={handleEdit} className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" />
                  {t('Bearbeiten')}
                </Button>
                <MoreActions
                  actions={[
                    {
                      label: t('Duplizieren…'),
                      icon: <Copy className="h-3.5 w-3.5" />,
                      title: t('Neues Datum mit Band, Deal und LoPro dieses Events'),
                      onSelect: () => setDuplicating(true)
                    },
                    {
                      label: t('Löschen…'),
                      icon: <Trash2 className="h-3.5 w-3.5" />,
                      destructive: true,
                      disabled: deleteEvent.isPending,
                      onSelect: () =>
                        void confirmDelete(
                          t('Event „{{name}}“ löschen?', { name: event.name })
                        ).then((ok) => ok && deleteEvent.mutate(event.id))
                    }
                  ]}
                />
              </>
            )}
          </div>
        </div>

        {isEditing && (
          <p className="mt-3 text-xs text-muted-foreground bg-muted/50 border rounded-md px-3 py-2 inline-flex items-center gap-1.5">
            <Pencil className="h-3 w-3" />
            {t('Bearbeitungsmodus – Änderungen in allen Tabs werden gemeinsam gespeichert.')}
          </p>
        )}
      </div>

      <RecordFollowUps record={{ type: 'event', id: event.id, name: event.name }} />
      <EventOpenItems eventId={event.id} />

      <DuplicateEventWizard
        sourceId={duplicating ? event.id : null}
        onClose={() => setDuplicating(false)}
      />
      <ShowFolderDialog eventId={event.id} open={readingFolder} onOpenChange={setReadingFolder} />

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
          <TabsTrigger value="overview">{t('Übersicht')}</TabsTrigger>
          <TabsTrigger value="itinerary">{t('Ablauf')}</TabsTrigger>
          <TabsTrigger value="financials">{t('Geld')}</TabsTrigger>
          <TabsTrigger value="documents">
            {hasMailAccount ? t('Dokumente & E-Mails') : t('Dokumente')}
            <TabCount count={counts.documents} />
          </TabsTrigger>
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

        {/* Ablauf: the day itself and its preparation with the local promoter */}
        <TabsContent value="itinerary" className="space-y-10">
          <TabSection title={t('Tagesablauf')}>
            <ItineraryTab
              event={event}
              isEditing={isEditing}
              saveSignal={saveSignal}
              cancelSignal={cancelSignal}
            />
          </TabSection>
          <TabSection id="section-advancing" title={t('Advancing')}>
            <AdvancingTab eventId={event.id} />
          </TabSection>
        </TabsContent>

        {/* Geld: deal and contract, ticket sales, and the settlement after the show */}
        <TabsContent value="financials" className="space-y-10">
          <TabSection title={t('Deal & Vertrag')}>
            <FinancialsTab
              event={event}
              isEditing={isEditing}
              saveSignal={saveSignal}
              cancelSignal={cancelSignal}
            />
          </TabSection>
          <TabSection id="section-tickets" title={t('Tickets')}>
            <TicketsTab eventId={event.id} />
          </TabSection>
          <TabSection id="section-settlement" title={t('Abrechnung')}>
            <SettlementTab eventId={event.id} />
          </TabSection>
        </TabsContent>

        <TabsContent value="documents" className="space-y-8">
          <DocumentsPanel ownerType="event" ownerId={event.id} />
          <RelatedDocumentsSection kind="event" id={event.id} />
          {/* D1: the band's own documents, read-only here - the rider or tech spec is
              needed on the gig without a second upload */}
          <BandDocumentsList bandId={event.bandId} bandName={event.bandName} />
          {hasMailAccount && (
            <section className="space-y-3">
              <h2 className="text-base font-semibold">E-Mails</h2>
              <MailHistoryPanel entityType="event" entityId={event.id} />
            </section>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default EventHubPage
