import { useMapPreview } from '@/hooks/useMapPreview'
import {
  defaultClause,
  formatClause,
  hasOverride,
  inheritClause
} from '@/components/map/radiusDisplay'
import { useDetailTab } from '@/hooks/useDetailTab'
import { useEffect } from 'react'
import { useParams, useNavigate, useRouterState, Link } from '@tanstack/react-router'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { trpcReact } from '@/lib/trpc'
import { parseRecordId } from '@/lib/recordId'
import { useVenueTabCounts } from '@/hooks/useTabCounts'
import { RecordDetail, RecordDetailPage } from '@/components/detail/RecordDetailPage'
import { FormSheet } from '@/components/form-sheet'
import { VenueForm } from '@/components/forms/VenueForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { MembersPanel } from '@/components/MembersSheet'
import {
  isMisplacedVenuePath,
  isVenueTab,
  VENUE_KIND_TERMS,
  venueDetailPath,
  venueListPath
} from '@/components/venue/constants'
import { AddressLines, Empty, EventsTable, Fields, InfoCard } from '@/components/detail/DetailParts'
import { VENUE_KIND_LABELS, type VenueDto } from '../../../main/api/schemas/venue.schema'
import { formatCapacity } from '../../../main/api/schemas/capacity'
import { VenueMarketingCard } from '@/components/band/marketing/MarketingLinksCard'

/** Overview: kind, capacity, genres, address, contact, promoter company, notes */
function OverviewTab({ venue }: { venue: VenueDto }) {
  const { contact } = venue
  const mapPreview = useMapPreview()
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <InfoCard label="Art / Kapazität">
        {VENUE_KIND_LABELS[venue.kind]}
        {venue.capacity ? ` · ${formatCapacity(venue.capacityMin, venue.capacity)} Personen` : ''}
        {venue.genres && <p className="text-muted-foreground">Genres: {venue.genres}</p>}
      </InfoCard>
      <VenueMarketingCard venueId={venue.id} />
      {mapPreview.enabled && mapPreview.defaults && (
        <InfoCard label="Gebietsschutz">
          {formatClause(inheritClause(venue, defaultClause(mapPreview.defaults, venue.kind)))}
          <p className="text-muted-foreground">
            {hasOverride(venue)
              ? 'Eigene Angabe; leere Felder vom Standard'
              : `Standard für ${venue.kind === 'festival' ? 'Festivals' : 'Clubs'}`}
          </p>
        </InfoCard>
      )}
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
  // The shell reads the tab too; the redirect below keeps it
  const activeTab = useDetailTab(isVenueTab, 'overview')
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<VenueDto>()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const query = trpcReact.venue.getById.useQuery({ id: id ?? 0 }, { enabled: id !== null })
  const venue = query.data

  // #162: delete from the detail page, then back to the list of its kind
  const mutations = useRecordMutations({
    procedures: trpcReact.venue,
    utils: utils.venue,
    noun: venue ? VENUE_KIND_TERMS[venue.kind].singular : 'Eintrag',
    label: (venue: VenueDto) => venue.name,
    deleteInput: (venue) => ({ id: venue.id }),
    onSaved: sheet.close,
    onDeleted: (venue) => navigate({ to: venueListPath(venue.kind) })
  })

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

  return (
    <RecordDetailPage
      id={id}
      query={query}
      loading="Wird geladen…"
      notFound={{
        text: 'Club oder Festival nicht gefunden.',
        backLabel: 'Zurück zu den Clubs',
        onBack: () => navigate({ to: '/clubs' })
      }}
    >
      {(venue) => {
        const copy = VENUE_KIND_TERMS[venue.kind]
        const ofVenue = venue.kind === 'festival' ? 'des Festivals' : 'des Clubs'
        return (
          <RecordDetail
            record={{ type: 'venue', id: venue.id, name: venue.name }}
            back={{
              label: `Alle ${copy.plural}`,
              onBack: () => navigate({ to: venueListPath(venue.kind) })
            }}
            subtitle={[VENUE_KIND_LABELS[venue.kind], venue.address?.city]
              .filter(Boolean)
              .join(' · ')}
            onEdit={() => sheet.openEdit(venue)}
            onDelete={() => mutations.deleteNow(venue)}
            deleting={mutations.isDeleting}
            isTab={isVenueTab}
            tabs={[
              { id: 'overview', label: 'Übersicht', content: <OverviewTab venue={venue} /> },
              {
                id: 'contacts',
                label: 'Ansprechpartner',
                count: counts.contacts,
                content: <MembersPanel entityType="venue" entityId={venue.id} />
              },
              {
                id: 'events',
                label: 'Events',
                count: counts.events,
                content: <EventsTab venue={venue} />
              }
            ]}
            documents={{ count: counts.documents, title: `Dokumente ${ofVenue}` }}
          >
            <FormSheet
              isOpen={sheet.isOpen}
              onClose={sheet.close}
              mode="edit"
              title={`${copy.singular} bearbeiten`}
              description="Angaben aktualisieren."
            >
              <VenueForm
                mode="edit"
                initialData={sheet.selectedItem}
                onSubmit={mutations.submit}
                onCancel={sheet.close}
                isSubmitting={mutations.isSubmitting}
              />
            </FormSheet>
          </RecordDetail>
        )
      }}
    </RecordDetailPage>
  )
}
