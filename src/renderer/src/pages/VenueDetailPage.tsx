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
import { toast } from '@/lib/toast'
import { Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  VENUE_TAB_ALIASES,
  venueDetailPath,
  venueListPath
} from '@/components/venue/constants'
import { EventsTable } from '@/components/detail/DetailParts'
import { addressBlock, contactFacts } from '@/components/detail/facts'
import { FactSheet, LinkList, TabSection } from '@/components/detail/CompactParts'
import { eventItems, upcoming } from '@/components/detail/relatedLinks'
import { VENUE_KIND_LABELS, type VenueDto } from '../../../main/api/schemas/venue.schema'
import { formatCapacity } from '../../../main/api/schemas/capacity'
import { VenueMarketingCard } from '@/components/band/marketing/MarketingLinksCard'

/**
 * Overview: the club's or festival's data in one sheet, the next events, its marketing entries
 * and its contacts
 */
function OverviewTab({ venue }: { venue: VenueDto }) {
  const { contact } = venue
  const navigate = useNavigate()
  const mapPreview = useMapPreview()
  const events = trpcReact.dealMemo.listByVenue.useQuery(venue.id)
  return (
    <div className="space-y-6">
      <CompanySuggestion venue={venue} />
      <FactSheet
        groups={[
          {
            title: VENUE_KIND_LABELS[venue.kind],
            facts: [
              [
                'Kapazität',
                venue.capacity
                  ? `${formatCapacity(venue.capacityMin, venue.capacity)} Personen`
                  : null
              ],
              ['Genres', venue.genres],
              [
                'Veranstalter',
                venue.company && (
                  <Link
                    to="/companies/$companyId"
                    params={{ companyId: String(venue.company.id) }}
                    className="font-medium hover:underline"
                  >
                    {venue.company.name}
                  </Link>
                )
              ],
              [
                'Gebietsschutz',
                mapPreview.enabled &&
                  mapPreview.defaults &&
                  `${formatClause(inheritClause(venue, defaultClause(mapPreview.defaults, venue.kind)))} (${
                    hasOverride(venue)
                      ? 'eigene Angabe'
                      : `Standard für ${venue.kind === 'festival' ? 'Festivals' : 'Clubs'}`
                  })`
              ]
            ]
          },
          {
            title: 'Kontakt',
            facts: [...contactFacts(contact), ['Adresse', addressBlock(venue.address)]]
          },
          {
            title: 'Anmerkungen',
            facts: [
              ['Notiz', venue.notes && <span className="whitespace-pre-wrap">{venue.notes}</span>]
            ]
          }
        ]}
      />
      <LinkList
        title="Nächste Events"
        items={eventItems(upcoming(events.data), (event) => event.bandName)}
        action={
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => navigate({ to: '.', search: { tab: 'events' } as never, replace: true })}
          >
            Alle Events
          </button>
        }
      />
      <VenueMarketingCard venueId={venue.id} />
      <TabSection id="section-contacts" title="Ansprechpartner">
        <MembersPanel entityType="venue" entityId={venue.id} />
      </TabSection>
      {venue.company && (
        <TabSection
          id="section-company-contacts"
          title={`Ansprechpartner bei ${venue.company.name}`}
        >
          <MembersPanel entityType="company" entityId={venue.company.id} />
        </TabSection>
      )}
    </div>
  )
}

/**
 * While the venue has no company: the club's own company (same name), linked with one click.
 * Its contacts then show here too. The promoter (LoPro) stays on the events.
 */
function CompanySuggestion({ venue }: { venue: VenueDto }) {
  const utils = trpcReact.useUtils()
  const suggestions = trpcReact.venue.companySuggestions.useQuery(
    { venueId: venue.id },
    { enabled: !venue.company }
  )
  const link = trpcReact.venue.linkCompany.useMutation({
    onSuccess: () => {
      void utils.venue.invalidate()
      void utils.company.invalidate()
      toast.success('Firma verknüpft', {
        description: 'Ihre Ansprechpartner stehen jetzt auch hier.'
      })
    },
    onError: (error) =>
      toast.error('Firma konnte nicht verknüpft werden', { description: error.message })
  })
  if (venue.company || !suggestions.data?.length) return null
  return (
    <div
      className="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm"
      data-testid="venue-company-suggestion"
    >
      <div className="flex items-start gap-2">
        <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span>
          Es gibt eine Firma mit dem Namen dieses Eintrags. Ist das die Firma des Clubs? Verknüpft
          stehen ihre Ansprechpartner und Angaben auch hier.
        </span>
      </div>
      <div className="flex flex-wrap gap-2 pl-6">
        {suggestions.data.map((company) => (
          <Button
            key={company.id}
            size="sm"
            variant="outline"
            disabled={link.isPending}
            onClick={() => link.mutate({ venueId: venue.id, companyId: company.id })}
          >
            {company.name} verknüpfen
          </Button>
        ))}
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
  const activeTab = useDetailTab(isVenueTab, 'overview', VENUE_TAB_ALIASES)
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
            aliases={VENUE_TAB_ALIASES}
            tabs={[
              { id: 'overview', label: 'Übersicht', content: <OverviewTab venue={venue} /> },
              {
                id: 'events',
                label: 'Events',
                count: counts.events,
                hideWhenEmpty: true,
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
