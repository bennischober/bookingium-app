import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { EmptyState } from '@/components/load-states'
import { trpcReact } from '@/lib/trpc'
import { parseRecordId } from '@/lib/recordId'
import { usePersonTabCounts } from '@/hooks/useTabCounts'
import { formatShortDate } from '@/lib/utils'
import { RecordInvoicesTable } from '@/components/invoice/RecordInvoicesTable'
import { FormSheet } from '@/components/form-sheet'
import { PersonForm } from '@/components/forms/PersonForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { PersonMembershipsPanel } from '@/components/person/PersonMembershipsPanel'
import { isPersonTab } from '@/components/person/constants'
import { RecordDetail, RecordDetailPage } from '@/components/detail/RecordDetailPage'
import { RelatedBandsTable, RelatedEventsTable } from '@/components/detail/RelatedTables'
import { AddressLines, Empty, Fields, InfoCard, RowTable } from '@/components/detail/DetailParts'
import type { PersonDto } from '../../../main/api/schemas/person.schema'

function personName(person: { firstName: string; lastName: string }) {
  return `${person.firstName} ${person.lastName}`.trim()
}

/** Section heading inside a tab that holds more than one list */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-medium text-muted-foreground">{children}</h2>
}

/** Overview: contact, address, birthday, roles at a glance, notes */
function OverviewTab({ person }: { person: PersonDto }) {
  const { contact } = person
  const relations = trpcReact.relation.getPersonRelations.useQuery({ personId: person.id })
  const roles = [
    ...(relations.data?.bands ?? []).map((m) => ({
      key: `band-${m.id}`,
      role: m.role,
      link: (
        <Link to="/band/$bandId" params={{ bandId: String(m.bandId) }} className="hover:underline">
          {m.bandName}
        </Link>
      )
    })),
    ...(relations.data?.companies ?? []).map((m) => ({
      key: `company-${m.id}`,
      role: m.role,
      link: (
        <Link
          to="/companies/$companyId"
          params={{ companyId: String(m.companyId) }}
          className="hover:underline"
        >
          {m.companyName}
        </Link>
      )
    })),
    ...(relations.data?.venues ?? []).map((m) => ({
      key: `venue-${m.id}`,
      role: m.role,
      link: (
        <Link
          to="/venues/$venueId"
          params={{ venueId: String(m.venueId) }}
          className="hover:underline"
        >
          {m.venueName}
        </Link>
      )
    }))
  ]

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
      <InfoCard label="Adresse">
        <AddressLines address={person.address} />
      </InfoCard>
      <InfoCard label="Rollen">
        {roles.length === 0 ? (
          <Empty>Keine Zugehörigkeiten</Empty>
        ) : (
          <ul className="space-y-1">
            {roles.map((entry) => (
              <li key={entry.key}>
                <span className="font-medium">{entry.link}</span>
                {entry.role && <span className="text-muted-foreground"> · {entry.role}</span>}
              </li>
            ))}
          </ul>
        )}
      </InfoCard>
      <InfoCard label="Geburtstag">
        {person.birthday ? formatShortDate(person.birthday) : <Empty />}
      </InfoCard>
      <div className="md:col-span-2">
        <InfoCard label="Anmerkungen">
          {person.notes ? <p className="whitespace-pre-wrap">{person.notes}</p> : <Empty />}
        </InfoCard>
      </div>
    </div>
  )
}

/** Band memberships, plus the bands the person is technical lead of */
function BandsTab({ personId }: { personId: number }) {
  const ledBands = trpcReact.band.listByResponsiblePerson.useQuery(personId)
  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>Mitglied in</SectionTitle>
        <PersonMembershipsPanel personId={personId} type="band" />
      </section>
      <section>
        <SectionTitle>Technischer Leiter von</SectionTitle>
        <RelatedBandsTable
          label="Bands als Technischer Leiter"
          query={ledBands}
          empty="Für keine Band als Technischer Leiter eingetragen."
        />
      </section>
    </div>
  )
}

/** Company memberships, plus the companies naming the person as invoice contact */
function CompaniesTab({ personId }: { personId: number }) {
  const navigate = useNavigate()
  const billed = trpcReact.company.listByInvoiceContact.useQuery(personId)
  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>Zugehörig zu</SectionTitle>
        <PersonMembershipsPanel personId={personId} type="company" />
      </section>
      <section>
        <SectionTitle>Ansprechpartner für Rechnungen bei</SectionTitle>
        <RowTable
          label="Firmen mit der Person als Ansprechpartner für Rechnungen"
          query={billed}
          loading="Firmen werden geladen…"
          empty="Bei keiner Firma als Ansprechpartner für Rechnungen eingetragen."
          itemLabel={{ singular: 'Firma', plural: 'Firmen' }}
          columns={[
            {
              header: 'Firma',
              cell: (company) => company.name,
              className: 'font-medium',
              sortValue: (company) => company.name
            },
            {
              header: 'Stadt',
              cell: (company) => company.address?.city || '–',
              sortValue: (company) => company.address?.city || ''
            }
          ]}
          onRowClick={(company) =>
            navigate({ to: '/companies/$companyId', params: { companyId: String(company.id) } })
          }
        />
      </section>
    </div>
  )
}

/**
 * Venues the person is a contact at, plus the events at those venues - the same
 * two sections the Bands and Companies tabs have, so the tab does not look
 * unfinished next to them.
 */
function VenuesTab({ personId }: { personId: number }) {
  const relations = trpcReact.relation.getPersonRelations.useQuery({ personId })
  const venues = relations.data?.venues ?? []

  return (
    <div className="space-y-8">
      <section>
        <SectionTitle>Clubs und Festivals</SectionTitle>
        <PersonMembershipsPanel personId={personId} type="venue" />
      </section>
      <section>
        <SectionTitle>Events in diesen Clubs und Festivals</SectionTitle>
        {venues.length === 0 ? (
          <EmptyState>Keinem Club und keinem Festival zugeordnet.</EmptyState>
        ) : (
          <div className="space-y-6">
            {venues.map((venue) => (
              <VenueEvents key={venue.id} venueId={venue.venueId} name={venue.venueName} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** One venue's events; the heading links to the venue so the list has a source */
function VenueEvents({ venueId, name }: { venueId: number; name: string }) {
  const navigate = useNavigate()
  const events = trpcReact.dealMemo.listByVenue.useQuery(venueId)
  return (
    <div>
      <h4 className="mb-2 font-medium">
        <Link
          to="/venues/$venueId"
          params={{ venueId: String(venueId) }}
          className="hover:underline"
        >
          {name}
        </Link>
      </h4>
      <RowTable
        label={`Events in ${name}`}
        query={events}
        loading="Events werden geladen…"
        empty={`Noch keine Events in ${name}.`}
        columns={[
          {
            header: 'Datum',
            cell: (event) => formatShortDate(event.date),
            className: 'whitespace-nowrap'
          },
          { header: 'Event', cell: (event) => event.name, className: 'font-medium' },
          { header: 'Band', cell: (event) => event.bandName }
        ]}
        onRowClick={(event) =>
          navigate({ to: '/events/$eventId', params: { eventId: String(event.id) } })
        }
      />
    </div>
  )
}

/** Events where the person is LoPro contact or TL of the band */
function EventsTab({ personId }: { personId: number }) {
  const events = trpcReact.dealMemo.listByPerson.useQuery(personId)
  const ledBands = trpcReact.band.listByResponsiblePerson.useQuery(personId)
  const ledBandIds = new Set((ledBands.data ?? []).map((band) => band.id))
  return (
    <RelatedEventsTable
      label="Events der Person"
      query={events}
      empty="Keine Events mit dieser Person als LoPro-Kontakt oder Technischer Leiter."
      roles={(event) => [
        event.loProPersonId === personId && 'LoPro-Kontakt',
        ledBandIds.has(event.bandId) && 'TL der Band'
      ]}
    />
  )
}

/** Management contracts naming the person; a click opens the band's contracts */
function ContractsTab({ personId }: { personId: number }) {
  const navigate = useNavigate()
  const contracts = trpcReact.managementContract.listByPerson.useQuery(personId)
  const bands = trpcReact.band.getListItems.useQuery()
  const bandName = (id: number) => bands.data?.find((band) => band.id === id)?.name ?? '–'
  return (
    <RowTable
      label="Managementverträge der Person"
      query={contracts}
      loading="Verträge werden geladen…"
      empty="In keinem Managementvertrag aufgeführt."
      itemLabel={{ singular: 'Vertrag', plural: 'Verträge' }}
      columns={[
        {
          header: 'Band',
          cell: (contract) => bandName(contract.bandId),
          className: 'font-medium',
          sortValue: (contract) => bandName(contract.bandId)
        },
        {
          header: 'Beginn',
          cell: (contract) => (contract.startDate ? formatShortDate(contract.startDate) : '–'),
          className: 'whitespace-nowrap'
        },
        {
          header: 'Rolle',
          cell: (contract) =>
            [
              contract.memberPersonIds.includes(personId) && 'Mitglied',
              contract.representativePersonId === personId && 'Bevollmächtigt'
            ]
              .filter(Boolean)
              .join(' · ')
        }
      ]}
      onRowClick={(contract) =>
        navigate({
          to: '/band/$bandId',
          params: { bandId: String(contract.bandId) },
          search: { tab: 'contracts' }
        })
      }
    />
  )
}

/** Invoices addressed to the person; a click opens the print view */
function InvoicesTab({ personId }: { personId: number }) {
  const invoices = trpcReact.invoice.listByPerson.useQuery(personId)
  return (
    <RecordInvoicesTable
      label="Rechnungen an die Person"
      query={invoices}
      empty="Keine Rechnungen an diese Person."
      recipient={false}
    />
  )
}

/**
 * Person page: everything about one contact in tabs (bands, companies,
 * venues, events, contracts, invoices, documents). Quick edits stay in the
 * sheet.
 */
export default function PersonDetailPage() {
  const { personId } = useParams({ strict: false }) as { personId?: string }
  const id = parseRecordId(personId)
  const counts = usePersonTabCounts(id)
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<PersonDto>()
  const person = trpcReact.person.getById.useQuery({ id: id ?? 0 }, { enabled: id !== null })

  // #162: delete from the detail page, then back to the list
  const mutations = useRecordMutations({
    procedures: trpcReact.person,
    utils: utils.person,
    noun: 'Person',
    label: personName,
    deleteInput: (person: PersonDto) => ({ id: person.id }),
    onSaved: () => {
      // Member lists show the person's name
      void utils.relation.invalidate()
      sheet.close()
    },
    onDeleted: () => navigate({ to: '/persons' })
  })

  const toList = () => navigate({ to: '/persons' })

  return (
    <RecordDetailPage
      id={id}
      query={person}
      loading="Person wird geladen…"
      notFound={{
        text: 'Person nicht gefunden.',
        backLabel: 'Zurück zu den Personen',
        onBack: toList
      }}
    >
      {(person) => (
        <RecordDetail
          record={{ type: 'person', id: person.id, name: personName(person) }}
          back={{ label: 'Alle Personen', onBack: toList }}
          subtitle={[person.address?.city, person.contact?.email].filter(Boolean).join(' · ')}
          onEdit={() => sheet.openEdit(person)}
          onDelete={() => mutations.deleteNow(person)}
          deleting={mutations.isDeleting}
          isTab={isPersonTab}
          tabs={[
            { id: 'overview', label: 'Übersicht', content: <OverviewTab person={person} /> },
            {
              id: 'bands',
              label: 'Bands',
              count: counts.bands,
              content: <BandsTab personId={person.id} />
            },
            {
              id: 'companies',
              label: 'Firmen',
              count: counts.companies,
              content: <CompaniesTab personId={person.id} />
            },
            {
              id: 'venues',
              label: 'Clubs / Festivals',
              count: counts.venues,
              content: <VenuesTab personId={person.id} />
            },
            {
              id: 'events',
              label: 'Events',
              count: counts.events,
              content: <EventsTab personId={person.id} />
            },
            {
              id: 'contracts',
              label: 'Managementverträge',
              count: counts.contracts,
              content: <ContractsTab personId={person.id} />
            },
            {
              id: 'invoices',
              label: 'Rechnungen',
              count: counts.invoices,
              content: <InvoicesTab personId={person.id} />
            }
          ]}
          documents={{ count: counts.documents, title: 'Dokumente der Person' }}
        >
          <FormSheet
            isOpen={sheet.isOpen}
            onClose={sheet.close}
            mode="edit"
            title="Person bearbeiten"
            description="Kontaktdaten der Person aktualisieren."
          >
            <PersonForm
              person={sheet.selectedItem || undefined}
              onSubmit={mutations.submit}
              onCancel={sheet.close}
            />
          </FormSheet>
        </RecordDetail>
      )}
    </RecordDetailPage>
  )
}
