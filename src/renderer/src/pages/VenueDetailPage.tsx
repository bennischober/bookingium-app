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
import { t } from '../../../main/i18n/translate'

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
      <FactSheet
        groups={[
          {
            title: VENUE_KIND_LABELS[venue.kind],
            facts: [
              [
                t('Kapazität'),
                venue.capacity
                  ? t('{{formatCapacity}} Personen', {
                      formatCapacity: formatCapacity(venue.capacityMin, venue.capacity)
                    })
                  : null
              ],
              [t('Genres'), venue.genres],
              [
                t('Veranstalter'),
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
                t('Gebietsschutz'),
                mapPreview.enabled &&
                  mapPreview.defaults &&
                  `${formatClause(inheritClause(venue, defaultClause(mapPreview.defaults, venue.kind)))} (${
                    hasOverride(venue)
                      ? t('eigene Angabe')
                      : t('Standard für {{value}}', {
                          value: venue.kind === 'festival' ? t('Festivals') : t('Clubs')
                        })
                  })`
              ]
            ]
          },
          {
            title: t('Kontakt'),
            facts: [...contactFacts(contact), [t('Adresse'), addressBlock(venue.address)]]
          },
          {
            title: t('Anmerkungen'),
            facts: [
              [
                t('Notiz'),
                venue.notes && <span className="whitespace-pre-wrap">{venue.notes}</span>
              ]
            ]
          }
        ]}
      />
      <LinkList
        title={t('Nächste Events')}
        items={eventItems(upcoming(events.data), (event) => event.bandName)}
        action={
          <button
            type="button"
            className="text-sm text-primary hover:underline"
            onClick={() => navigate({ to: '.', search: { tab: 'events' } as never, replace: true })}
          >
            {t('Alle Events')}
          </button>
        }
      />
      <VenueMarketingCard venueId={venue.id} />
      <TabSection id="section-contacts" title={t('Ansprechpartner')}>
        <MembersPanel entityType="venue" entityId={venue.id} />
      </TabSection>
    </div>
  )
}

/** Events at this venue, newest first */
function EventsTab({ venue }: { venue: VenueDto }) {
  const events = trpcReact.dealMemo.listByVenue.useQuery(venue.id)
  return (
    <EventsTable
      label={t('Events {{value}}', {
        value: venue.kind === 'festival' ? t('des Festivals') : t('des Clubs')
      })}
      query={events}
      empty={t('Noch keine Events {{value}}.', {
        value: venue.kind === 'festival' ? t('auf diesem Festival') : t('in diesem Club')
      })}
      columns={[{ header: t('Band'), cell: (event) => event.bandName }]}
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
    noun: venue ? VENUE_KIND_TERMS[venue.kind].singular : t('Eintrag'),
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
      loading={t('Wird geladen…')}
      notFound={{
        text: t('Club oder Festival nicht gefunden.'),
        backLabel: t('Zurück zu den Clubs'),
        onBack: () => navigate({ to: '/clubs' })
      }}
    >
      {(venue) => {
        const copy = VENUE_KIND_TERMS[venue.kind]
        const ofVenue = venue.kind === 'festival' ? t('des Festivals') : t('des Clubs')
        return (
          <RecordDetail
            record={{ type: 'venue', id: venue.id, name: venue.name }}
            back={{
              label: t('Alle {{plural}}', { plural: copy.plural }),
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
              { id: 'overview', label: t('Übersicht'), content: <OverviewTab venue={venue} /> },
              {
                id: 'events',
                label: t('Events'),
                count: counts.events,
                hideWhenEmpty: true,
                content: <EventsTab venue={venue} />
              }
            ]}
            documents={{ count: counts.documents, title: t('Dokumente {{ofVenue}}', { ofVenue }) }}
          >
            <FormSheet
              isOpen={sheet.isOpen}
              onClose={sheet.close}
              mode="edit"
              title={`${copy.singular} bearbeiten`}
              description={t('Angaben aktualisieren.')}
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
