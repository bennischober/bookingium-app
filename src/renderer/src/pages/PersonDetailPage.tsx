import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { trpcReact } from '@/lib/trpc'
import { parseRecordId } from '@/lib/recordId'
import { sumCounts, usePersonTabCounts } from '@/hooks/useTabCounts'
import { formatShortDate } from '@/lib/utils'
import { RecordInvoicesTable } from '@/components/invoice/RecordInvoicesTable'
import { FormSheet } from '@/components/form-sheet'
import { PersonForm } from '@/components/forms/PersonForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { PersonMembershipsPanel } from '@/components/person/PersonMembershipsPanel'
import { isPersonTab, PERSON_TAB_ALIASES } from '@/components/person/constants'
import { addressBlock, contactFacts } from '@/components/detail/facts'
import { FactSheet, LinkList, TabSection } from '@/components/detail/CompactParts'
import { eventItems, upcoming } from '@/components/detail/relatedLinks'
import { RecordDetail, RecordDetailPage } from '@/components/detail/RecordDetailPage'
import { RelatedBandsTable, RelatedEventsTable } from '@/components/detail/RelatedTables'
import { RowTable } from '@/components/detail/DetailParts'
import type { PersonDto } from '../../../main/api/schemas/person.schema'
import { t } from '../../../main/i18n/translate'

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

  const navigate = useNavigate()
  const events = trpcReact.dealMemo.listByPerson.useQuery(person.id)
  const roleItems = roles.map((entry) => ({
    key: entry.key,
    label: entry.link,
    detail: entry.role
  }))
  return (
    <div className="space-y-6">
      <FactSheet
        groups={[
          {
            title: t('Kontakt'),
            facts: [...contactFacts(contact), [t('Adresse'), addressBlock(person.address)]]
          },
          {
            title: t('Persönliches'),
            facts: [
              [t('Geburtstag'), person.birthday && formatShortDate(person.birthday)],
              [
                t('Notiz'),
                person.notes && <span className="whitespace-pre-wrap">{person.notes}</span>
              ]
            ]
          }
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <LinkList
          title={t('Rollen')}
          items={roleItems}
          action={
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() =>
                navigate({ to: '.', search: { tab: 'bands' } as never, replace: true })
              }
            >
              {t('Zugehörigkeiten')}
            </button>
          }
        />
        <LinkList
          title={t('Nächste Events')}
          items={eventItems(upcoming(events.data))}
          action={
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() =>
                navigate({ to: '.', search: { tab: 'events' } as never, replace: true })
              }
            >
              {t('Alle Events')}
            </button>
          }
        />
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
        <SectionTitle>{t('Mitglied in')}</SectionTitle>
        <PersonMembershipsPanel personId={personId} type="band" />
      </section>
      <section>
        <SectionTitle>{t('Technischer Leiter von')}</SectionTitle>
        <RelatedBandsTable
          label={t('Bands als Technischer Leiter')}
          query={ledBands}
          empty={t('Für keine Band als Technischer Leiter eingetragen.')}
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
        <SectionTitle>{t('Zugehörig zu')}</SectionTitle>
        <PersonMembershipsPanel personId={personId} type="company" />
      </section>
      <section>
        <SectionTitle>{t('Ansprechpartner für Rechnungen bei')}</SectionTitle>
        <RowTable
          label={t('Firmen mit der Person als Ansprechpartner für Rechnungen')}
          query={billed}
          loading={t('Firmen werden geladen…')}
          empty={t('Bei keiner Firma als Ansprechpartner für Rechnungen eingetragen.')}
          itemLabel={{ singular: t('Firma'), plural: t('Firmen') }}
          columns={[
            {
              header: t('Firma'),
              cell: (company) => company.name,
              className: 'font-medium',
              sortValue: (company) => company.name
            },
            {
              header: t('Stadt'),
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
 * Bands, companies, clubs and festivals the person belongs to, in one tab: memberships are
 * edited here, the roles elsewhere (technical lead, invoice contact) listed below each
 */
function MembershipsTab({ personId }: { personId: number }) {
  return (
    <div className="space-y-10">
      <TabSection id="section-bands" title={t('Bands')}>
        <BandsTab personId={personId} />
      </TabSection>
      <TabSection id="section-companies" title={t('Firmen')}>
        <CompaniesTab personId={personId} />
      </TabSection>
      <TabSection id="section-venues" title={t('Clubs / Festivals')}>
        <PersonMembershipsPanel personId={personId} type="venue" />
      </TabSection>
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
      label={t('Events der Person')}
      query={events}
      empty={t('Keine Events mit dieser Person als LoPro-Kontakt oder Technischer Leiter.')}
      roles={(event) => [
        event.loProPersonId === personId && 'LoPro-Kontakt',
        ledBandIds.has(event.bandId) && t('TL der Band')
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
      label={t('Managementverträge der Person')}
      query={contracts}
      loading={t('Verträge werden geladen…')}
      empty={t('In keinem Managementvertrag aufgeführt.')}
      itemLabel={{ singular: t('Vertrag'), plural: t('Verträge') }}
      columns={[
        {
          header: t('Band'),
          cell: (contract) => bandName(contract.bandId),
          className: 'font-medium',
          sortValue: (contract) => bandName(contract.bandId)
        },
        {
          header: t('Beginn'),
          cell: (contract) => (contract.startDate ? formatShortDate(contract.startDate) : '–'),
          className: 'whitespace-nowrap'
        },
        {
          header: t('Rolle'),
          cell: (contract) =>
            [
              contract.memberPersonIds.includes(personId) && t('Mitglied'),
              contract.representativePersonId === personId && t('Bevollmächtigt')
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

/** Management contracts naming the person and invoices addressed to them */
function MoneyTab({ personId }: { personId: number }) {
  return (
    <div className="space-y-10">
      <TabSection id="section-contracts" title={t('Managementverträge')}>
        <ContractsTab personId={personId} />
      </TabSection>
      <TabSection title={t('Rechnungen')}>
        <InvoicesTab personId={personId} />
      </TabSection>
    </div>
  )
}

/** Invoices addressed to the person; a click opens the print view */
function InvoicesTab({ personId }: { personId: number }) {
  const invoices = trpcReact.invoice.listByPerson.useQuery(personId)
  return (
    <RecordInvoicesTable
      label={t('Rechnungen an die Person')}
      query={invoices}
      empty={t('Keine Rechnungen an diese Person.')}
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
    noun: t('Person'),
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
      loading={t('Person wird geladen…')}
      notFound={{
        text: t('Person nicht gefunden.'),
        backLabel: t('Zurück zu den Personen'),
        onBack: toList
      }}
    >
      {(person) => (
        <RecordDetail
          record={{ type: 'person', id: person.id, name: personName(person) }}
          back={{ label: t('Alle Personen'), onBack: toList }}
          subtitle={[person.address?.city, person.contact?.email].filter(Boolean).join(' · ')}
          onEdit={() => sheet.openEdit(person)}
          onDelete={() => mutations.deleteNow(person)}
          deleting={mutations.isDeleting}
          isTab={isPersonTab}
          aliases={PERSON_TAB_ALIASES}
          tabs={[
            { id: 'overview', label: t('Übersicht'), content: <OverviewTab person={person} /> },
            {
              id: 'bands',
              label: t('Zugehörigkeiten'),
              count: sumCounts(counts.bands, counts.companies, counts.venues),
              content: <MembershipsTab personId={person.id} />
            },
            {
              id: 'events',
              label: t('Events'),
              count: counts.events,
              hideWhenEmpty: true,
              content: <EventsTab personId={person.id} />
            },
            {
              id: 'invoices',
              label: t('Verträge & Rechnungen'),
              count: sumCounts(counts.contracts, counts.invoices),
              hideWhenEmpty: true,
              content: <MoneyTab personId={person.id} />
            }
          ]}
          documents={{ count: counts.documents, title: t('Dokumente der Person') }}
        >
          <FormSheet
            isOpen={sheet.isOpen}
            onClose={sheet.close}
            mode="edit"
            title={t('Person bearbeiten')}
            description={t('Kontaktdaten der Person aktualisieren.')}
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
