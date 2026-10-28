import { trpcReact } from '@/lib/trpc'

/**
 * Row counts for the tabs of a detail page, so an empty tab shows as empty
 * without opening it. Each count runs the same query (same input) as its tab,
 * so React Query shares the result and opening the tab costs nothing extra.
 * A count is undefined while its query loads, or while the route's id is invalid.
 */
type Counts<K extends string> = Partial<Record<K, number>>

const lengthOf = (data: readonly unknown[] | undefined) => data?.length

/** Sum of lists shown together in one tab; undefined until all have loaded */
const sumOf = (...lists: (readonly unknown[] | undefined)[]) =>
  lists.every((list) => list !== undefined)
    ? lists.reduce((sum, list) => sum + (list?.length ?? 0), 0)
    : undefined

export function useCompanyTabCounts(id: number | null) {
  const companyId = id ?? 0
  const on = { enabled: id !== null }
  const contacts = trpcReact.relation.getCompanyMembers.useQuery({ companyId }, on)
  const bands = trpcReact.band.listByCompany.useQuery(companyId, on)
  const venues = trpcReact.venue.listByCompany.useQuery(companyId, on)
  const events = trpcReact.dealMemo.listByCompany.useQuery(companyId, on)
  const invoices = trpcReact.invoice.listByCompany.useQuery(companyId, on)
  const documents = trpcReact.document.listByOwner.useQuery(
    {
      ownerType: 'company',
      ownerId: companyId
    },
    on
  )
  return {
    contacts: lengthOf(contacts.data),
    bands: lengthOf(bands.data),
    venues: lengthOf(venues.data),
    events: lengthOf(events.data),
    invoices: lengthOf(invoices.data),
    documents: lengthOf(documents.data)
  } satisfies Counts<string>
}

export function useVenueTabCounts(id: number | null) {
  const venueId = id ?? 0
  const on = { enabled: id !== null }
  const contacts = trpcReact.relation.getVenueMembers.useQuery({ venueId }, on)
  const events = trpcReact.dealMemo.listByVenue.useQuery(venueId, on)
  const documents = trpcReact.document.listByOwner.useQuery(
    { ownerType: 'venue', ownerId: venueId },
    on
  )
  return {
    contacts: lengthOf(contacts.data),
    events: lengthOf(events.data),
    documents: lengthOf(documents.data)
  } satisfies Counts<string>
}

export function useBandTabCounts(id: number | null) {
  const bandId = id ?? 0
  const on = { enabled: id !== null }
  const members = trpcReact.relation.getBandMembers.useQuery({ bandId }, on)
  const events = trpcReact.dealMemo.listByBand.useQuery(bandId, on)
  const contracts = trpcReact.managementContract.listByBand.useQuery(bandId, on)
  const own = trpcReact.document.listByOwner.useQuery({ ownerType: 'band', ownerId: bandId }, on)
  const fromEvents = trpcReact.document.listEventDocumentsForBand.useQuery(bandId, on)
  return {
    members: lengthOf(members.data),
    events: lengthOf(events.data),
    contracts: lengthOf(contracts.data),
    // The tab lists the band's own documents and those of its events
    documents: sumOf(own.data, fromEvents.data)
  } satisfies Counts<string>
}

export function usePersonTabCounts(id: number | null) {
  const personId = id ?? 0
  const on = { enabled: id !== null }
  const relations = trpcReact.relation.getPersonRelations.useQuery({ personId }, on)
  const ledBands = trpcReact.band.listByResponsiblePerson.useQuery(personId, on)
  const billed = trpcReact.company.listByInvoiceContact.useQuery(personId, on)
  const events = trpcReact.dealMemo.listByPerson.useQuery(personId, on)
  const contracts = trpcReact.managementContract.listByPerson.useQuery(personId, on)
  const invoices = trpcReact.invoice.listByPerson.useQuery(personId, on)
  const documents = trpcReact.document.listByOwner.useQuery(
    { ownerType: 'person', ownerId: personId },
    on
  )
  return {
    // Bands and Firmen each show two lists: memberships plus a role elsewhere
    bands: sumOf(relations.data?.bands, ledBands.data),
    companies: sumOf(relations.data?.companies, billed.data),
    venues: lengthOf(relations.data?.venues),
    events: lengthOf(events.data),
    contracts: lengthOf(contracts.data),
    invoices: lengthOf(invoices.data),
    documents: lengthOf(documents.data)
  } satisfies Counts<string>
}

export function useEventTabCounts(id: number | null) {
  const eventId = id ?? 0
  const on = { enabled: id !== null }
  const documents = trpcReact.document.listByOwner.useQuery(
    { ownerType: 'event', ownerId: eventId },
    on
  )
  return { documents: lengthOf(documents.data) } satisfies Counts<string>
}
