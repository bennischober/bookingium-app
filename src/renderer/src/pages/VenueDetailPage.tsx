import { MailHistoryPanel } from '@/components/mail/MailHistoryPanel'
import { useMailClientEnabled } from '@/hooks/useMailClientEnabled'
import { useDetailTab } from '@/hooks/useDetailTab'
import { useEffect } from 'react'
import { useParams, useNavigate, useRouterState, Link } from '@tanstack/react-router'
import { ArrowLeft, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { PageErrorState } from '@/components/load-states'
import { isNotFound } from '@/lib/queryErrors'
import { trpcReact } from '@/lib/trpc'
import { parseRecordId } from '@/lib/recordId'
import { useVenueTabCounts } from '@/hooks/useTabCounts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FollowUpButton, RecordFollowUps } from '@/components/follow-ups/RecordFollowUps'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { VenueForm } from '@/components/forms/VenueForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { MembersPanel } from '@/components/MembersSheet'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import {
  isMisplacedVenuePath,
  isVenueTab,
  VENUE_KIND_COPY,
  venueDetailPath,
  venueListPath
} from '@/components/venue/constants'
import {
  AddressLines,
  Empty,
  EventsTable,
  Fields,
  InfoCard,
  TabCount
} from '@/components/detail/DetailParts'
import {
  VENUE_KIND_LABELS,
  type UpdateVenueInput,
  type VenueDto
} from '../../../main/api/schemas/venue.schema'

/** Overview: kind, capacity, genres, address, contact, promoter company, notes */
function OverviewTab({ venue }: { venue: VenueDto }) {
  const { contact } = venue
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <InfoCard label="Art / Kapazität">
        {VENUE_KIND_LABELS[venue.kind]}
        {venue.capacity ? ` · ${venue.capacity.toLocaleString('de-DE')} Personen` : ''}
        {venue.genres && <p className="text-muted-foreground">Genres: {venue.genres}</p>}
      </InfoCard>
      <InfoCard label="Firma (Veranstalter)">
        {venue.company ? (
          <Link
            to="/companies/$companyId"
            params={{ companyId: String(venue.company.id) }}
            className="font-medium hover:underline"
          >
            {venue.company.name}
          </Link>
        ) : (
          <Empty />
        )}
      </InfoCard>
      <InfoCard label="Adresse">
        <AddressLines address={venue.address} />
      </InfoCard>
      <InfoCard label="Kontakt">
        <Fields
          fields={[
            ['E-Mail', contact?.email],
            ['Telefon', contact?.phone],
            ['Mobil', contact?.mobilePhone],
            ['Website', contact?.homepage]
          ]}
        />
      </InfoCard>
      <div className="md:col-span-2">
        <InfoCard label="Anmerkungen">
          {venue.notes ? <p className="whitespace-pre-wrap">{venue.notes}</p> : <Empty />}
        </InfoCard>
      </div>
    </div>
  )
}

/** Events at this venue, newest first */
function EventsTab({ venue }: { venue: VenueDto }) {
  const events = trpcReact.dealMemo.listByVenue.useQuery(venue.id)
  return (
    <EventsTable
      label={`Events ${venue.kind === 'festival' ? 'des Festivals' : 'des Clubs'}`}
      query={events}
      empty={`Noch keine Events ${venue.kind === 'festival' ? 'auf diesem Festival' : 'in diesem Club'}.`}
      columns={[{ header: 'Band', cell: (event) => event.bandName }]}
    />
  )
}

/**
 * Venue page: everything about one club or festival in tabs (contacts,
 * events, documents). Quick edits stay in the sheet. It answers at /clubs/<id>,
 * /festivals/<id> and /venues/<id>, and moves itself to the path of its kind.
 */
export default function VenueDetailPage() {
  const { venueId } = useParams({ strict: false }) as { venueId?: string }
  const id = parseRecordId(venueId)
  const counts = useVenueTabCounts(id)
  const navigate = useNavigate()
  const mailClientEnabled = useMailClientEnabled()
  const activeTab = useDetailTab(isVenueTab, 'overview')
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<VenueDto>()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  const {
    data: venue,
    isLoading,
    isError,
    error,
    refetch
  } = trpcReact.venue.getById.useQuery({ id: id ?? 0 }, { enabled: id !== null })

  // Links that do not know the kind, older /venues links, or the kind changed in the sheet:
  // replace the URL with the one below the right list, keeping the tab
  const misplaced = venue ? isMisplacedVenuePath(pathname, venue) : false
  const venueKind = venue?.kind
  useEffect(() => {
    if (!misplaced || !venueKind || id === null) return
    void navigate({
      to: venueDetailPath(venueKind),
      params: { venueId: String(id) },
      search: { tab: activeTab !== 'overview' ? activeTab : undefined },
      replace: true
    })
  }, [misplaced, venueKind, id, activeTab, navigate])

  const updateVenue = trpcReact.venue.update.useMutation({
    onSuccess: (data) => {
      void utils.venue.invalidate()
      sheet.close()
      toast.success(`${VENUE_KIND_COPY[data.kind].singular} aktualisiert`, {
        description: `${data.name} wurde aktualisiert.`
      })
    },
    onError: (error) => {
      toast.error('Änderungen konnten nicht gespeichert werden', { description: error.message })
    }
  })

  // A bad id never loads (the query stays disabled), it is not found
  if (id !== null && isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground">Wird geladen…</p>
      </div>
    )
  }

  if (isError && !isNotFound(error)) {
    return <PageErrorState error={error} onRetry={() => void refetch()} />
  }

  if (!venue) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Club oder Festival nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/clubs' })}>
          Zurück zu den Clubs
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col p-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 gap-1.5 text-muted-foreground"
          onClick={() => navigate({ to: venueListPath(venue.kind) })}
        >
          <ArrowLeft className="h-4 w-4" />
          Alle {VENUE_KIND_COPY[venue.kind].plural}
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{venue.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {[VENUE_KIND_LABELS[venue.kind], venue.address?.city].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-2">
            <FollowUpButton record={{ type: 'venue', id: venue.id, name: venue.name }} />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => sheet.openEdit(venue)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Bearbeiten
            </Button>
          </div>
        </div>
      </div>

      <RecordFollowUps record={{ type: 'venue', id: venue.id, name: venue.name }} />

      <Tabs
        value={activeTab}
        onValueChange={(tab) =>
          // replace: switching tabs should not pile up history entries
          navigate({
            to: venueDetailPath(venue.kind),
            params: { venueId: String(venue.id) },
            search: { tab: isVenueTab(tab) && tab !== 'overview' ? tab : undefined },
            replace: true
          })
        }
        className="flex-1"
      >
        {/* Tabs wrap onto a second row in narrow windows */}
        <TabsList className="mb-6 h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="contacts">
            Ansprechpartner
            <TabCount count={counts.contacts} />
          </TabsTrigger>
          <TabsTrigger value="events">
            Events
            <TabCount count={counts.events} />
          </TabsTrigger>
          <TabsTrigger value="documents">
            Dokumente
            <TabCount count={counts.documents} />
          </TabsTrigger>
          {mailClientEnabled && <TabsTrigger value="mails">E-Mails</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab venue={venue} />
        </TabsContent>
        <TabsContent value="contacts" className="max-w-2xl">
          <MembersPanel entityType="venue" entityId={venue.id} />
        </TabsContent>
        <TabsContent value="events">
          <EventsTab venue={venue} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel
            ownerType="venue"
            ownerId={venue.id}
            title={`Dokumente ${venue.kind === 'festival' ? 'des Festivals' : 'des Clubs'}`}
          />
        </TabsContent>
        {mailClientEnabled && (
          <TabsContent value="mails">
            <MailHistoryPanel entityType="venue" entityId={venue.id} />
          </TabsContent>
        )}
      </Tabs>

      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode="edit"
        title={`${VENUE_KIND_COPY[venue.kind].singular} bearbeiten`}
        description="Angaben aktualisieren."
      >
        <VenueForm
          mode="edit"
          initialData={sheet.selectedItem}
          onSubmit={(data) => updateVenue.mutate(data as UpdateVenueInput)}
          onCancel={sheet.close}
          isSubmitting={updateVenue.isPending}
        />
      </FormSheet>
    </div>
  )
}
