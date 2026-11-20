import { useNavigate } from '@tanstack/react-router'
import { EventsTable, RowTable, type Column, type ListQuery } from '@/components/detail/DetailParts'
import type { DealMemoListItemDto } from '../../../../main/api/schemas/deal_memo.schema'
import { VENUE_KIND_LABELS, type VenueDto } from '../../../../main/api/schemas/venue.schema'
import { formatCapacity } from '../../../../main/api/schemas/capacity'
import { eventPlace } from '@/components/event-list/pastEvent'

/**
 * #172: tables of the records linked to a detail page's record, shared by the
 * pages that list the same kind of record (bands of a company, bands a person
 * leads, …). The page passes the query and the wording; `roles` names how each
 * row is linked ("Firma der Band", "LoPro") and adds the Rolle column.
 */

/** The parts of a role that apply, joined: "LoPro · Rechnungsfirma" */
type Roles<T> = (row: T) => (string | false)[]

function roleColumn<T>(roles: Roles<T>): Column<T> {
  return { header: 'Rolle', cell: (row) => roles(row).filter(Boolean).join(' · ') }
}

interface RelatedTableProps<T> {
  /** The table's accessible name, e.g. "Bands der Firma" */
  label: string
  query: ListQuery<T>
  empty: string
  roles?: Roles<T>
}

/** Bands by name and genre; a click opens the band */
export function RelatedBandsTable<T extends { id: number; name: string; genre: string | null }>({
  label,
  query,
  empty,
  roles
}: RelatedTableProps<T>) {
  const navigate = useNavigate()
  return (
    <RowTable
      label={label}
      query={query}
      loading="Bands werden geladen…"
      empty={empty}
      itemLabel={{ singular: 'Band', plural: 'Bands' }}
      columns={[
        {
          header: 'Band',
          cell: (band) => band.name,
          className: 'font-medium',
          sortValue: (band) => band.name
        },
        {
          header: 'Genre',
          cell: (band) => band.genre || '–',
          sortValue: (band) => band.genre || ''
        },
        ...(roles ? [roleColumn(roles)] : [])
      ]}
      onRowClick={(band) => navigate({ to: '/band/$bandId', params: { bandId: String(band.id) } })}
    />
  )
}

/** Clubs and festivals with kind, city and capacity; a click opens the venue */
export function RelatedVenuesTable({ label, query, empty, roles }: RelatedTableProps<VenueDto>) {
  const navigate = useNavigate()
  return (
    <RowTable
      label={label}
      query={query}
      loading="Clubs und Festivals werden geladen…"
      empty={empty}
      itemLabel={{ singular: 'Club oder Festival', plural: 'Clubs und Festivals' }}
      columns={[
        {
          header: 'Name',
          cell: (venue) => venue.name,
          className: 'font-medium',
          sortValue: (venue) => venue.name
        },
        {
          header: 'Art',
          cell: (venue) => VENUE_KIND_LABELS[venue.kind],
          sortValue: (venue) => VENUE_KIND_LABELS[venue.kind]
        },
        {
          header: 'Stadt',
          cell: (venue) => venue.address?.city || '–',
          sortValue: (venue) => venue.address?.city || ''
        },
        {
          header: 'Kapazität',
          cell: (venue) => formatCapacity(venue.capacityMin, venue.capacity) || '–'
        },
        ...(roles ? [roleColumn(roles)] : [])
      ]}
      onRowClick={(venue) =>
        navigate({ to: '/venues/$venueId', params: { venueId: String(venue.id) } })
      }
    />
  )
}

/** Events with band and venue in one column (it keeps the table within narrow windows) */
export function RelatedEventsTable<T extends DealMemoListItemDto>({
  label,
  query,
  empty,
  roles
}: RelatedTableProps<T>) {
  return (
    <EventsTable
      label={label}
      query={query}
      empty={empty}
      columns={[
        {
          header: 'Band / Club / Festival',
          cell: (event) => (
            <>
              <div>{event.bandName}</div>
              <div className="text-xs text-muted-foreground">{eventPlace(event)}</div>
            </>
          )
        },
        ...(roles ? [roleColumn(roles)] : [])
      ]}
    />
  )
}
