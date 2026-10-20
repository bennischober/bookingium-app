import { useParams, useNavigate, useSearch, Link } from '@tanstack/react-router'
import { ArrowLeft, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FollowUpButton, RecordFollowUps } from '@/components/follow-ups/RecordFollowUps'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { VenueForm } from '@/components/forms/VenueForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { MembersPanel } from '@/components/MembersSheet'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import { isVenueTab } from '@/components/venue/constants'
import { AddressLines, Empty, EventsTable, Fields, InfoCard } from '@/components/detail/DetailParts'
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
function EventsTab({ venueId }: { venueId: number }) {
  const events = trpcReact.dealMemo.listByVenue.useQuery(venueId)
  return (
    <EventsTable
      label="Events der Spielstätte"
      events={events.data}
      isLoading={events.isLoading}
      empty="Noch keine Events in dieser Spielstätte."
      columns={[{ header: 'Band', cell: (event) => event.bandName }]}
    />
  )
}

/**
 * Venue page: everything about one venue or festival in tabs (contacts,
 * events, documents). Quick edits stay in the sheet.
 */
export default function VenueDetailPage() {
  const { venueId } = useParams({ strict: false }) as { venueId?: string }
  const id = Number(venueId)
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { tab?: string }
  const activeTab = isVenueTab(search.tab) ? search.tab : 'overview'
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<VenueDto>()

  const {
    data: venue,
    isLoading,
    isError
  } = trpcReact.venue.getById.useQuery({ id }, { enabled: Number.isFinite(id) && id > 0 })

  const updateVenue = trpcReact.venue.update.useMutation({
    onSuccess: (data) => {
      void utils.venue.invalidate()
      sheet.close()
      toast.success('Spielstätte aktualisiert', {
        description: `${data.name} wurde aktualisiert.`
      })
    },
    onError: (error) => {
      toast.error('Spielstätte konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground">Spielstätte wird geladen…</p>
      </div>
    )
  }

  if (isError || !venue) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Spielstätte nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/venues' })}>
          Zurück zu den Spielstätten
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
          onClick={() => navigate({ to: '/venues' })}
        >
          <ArrowLeft className="h-4 w-4" />
          Alle Spielstätten
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
            to: '/venues/$venueId',
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
          <TabsTrigger value="contacts">Ansprechpartner</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="documents">Dokumente</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab venue={venue} />
        </TabsContent>
        <TabsContent value="contacts" className="max-w-2xl">
          <MembersPanel entityType="venue" entityId={venue.id} />
        </TabsContent>
        <TabsContent value="events">
          <EventsTab venueId={venue.id} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel ownerType="venue" ownerId={venue.id} title="Dokumente der Spielstätte" />
        </TabsContent>
      </Tabs>

      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode="edit"
        title="Spielstätte bearbeiten"
        description="Spielstätteninformationen aktualisieren."
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
