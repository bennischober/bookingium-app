import { MailHistoryPanel } from '@/components/mail/MailHistoryPanel'
import { useMailClientEnabled } from '@/hooks/useMailClientEnabled'
import { useParams, useNavigate, useSearch, Link } from '@tanstack/react-router'
import { ArrowLeft, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { z } from 'zod'
import { trpcReact } from '@/lib/trpc'
import { parseRecordId } from '@/lib/recordId'
import { usePersonTabCounts } from '@/hooks/useTabCounts'
import { useOpenInvoice } from '@/hooks/useOpenInvoice'
import { formatShortDate } from '@/lib/utils'
import { formatMoney, invoiceNumberLabel } from '@/lib/invoiceLabels'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InvoiceStatusBadge } from '@/components/invoice/InvoiceStatusBadge'
import { FollowUpButton, RecordFollowUps } from '@/components/follow-ups/RecordFollowUps'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { PersonForm } from '@/components/forms/PersonForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import { PersonMembershipsPanel } from '@/components/person/PersonMembershipsPanel'
import { isPersonTab } from '@/components/person/constants'
import {
  AddressLines,
  Empty,
  EventsTable,
  Fields,
  InfoCard,
  RowTable,
  TabCount
} from '@/components/detail/DetailParts'
import type {
  CreatePersonInput,
  PersonDto,
  UpdatePersonInput
} from '../../../main/api/schemas/person.schema'

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
  const navigate = useNavigate()
  const ledBands = trpcReact.band.listByResponsiblePerson.useQuery(personId)
  return (
    <div className="space-y-8">
      <section className="max-w-2xl">
        <SectionTitle>Mitglied in</SectionTitle>
        <PersonMembershipsPanel personId={personId} type="band" />
      </section>
      <section>
        <SectionTitle>Technischer Leiter von</SectionTitle>
        <RowTable
          label="Bands als Technischer Leiter"
          rows={ledBands.data}
          isLoading={ledBands.isLoading}
          loading="Bands werden geladen…"
          empty="Für keine Band als Technischer Leiter eingetragen."
          columns={[
            { header: 'Band', cell: (band) => band.name, className: 'font-medium' },
            { header: 'Genre', cell: (band) => band.genre || '–' }
          ]}
          onRowClick={(band) =>
            navigate({ to: '/band/$bandId', params: { bandId: String(band.id) } })
          }
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
      <section className="max-w-2xl">
        <SectionTitle>Zugehörig zu</SectionTitle>
        <PersonMembershipsPanel personId={personId} type="company" />
      </section>
      <section>
        <SectionTitle>Ansprechpartner für Rechnungen bei</SectionTitle>
        <RowTable
          label="Firmen mit der Person als Ansprechpartner für Rechnungen"
          rows={billed.data}
          isLoading={billed.isLoading}
          loading="Firmen werden geladen…"
          empty="Bei keiner Firma als Ansprechpartner für Rechnungen eingetragen."
          columns={[
            { header: 'Firma', cell: (company) => company.name, className: 'font-medium' },
            { header: 'Stadt', cell: (company) => company.address?.city || '–' }
          ]}
          onRowClick={(company) =>
            navigate({ to: '/companies/$companyId', params: { companyId: String(company.id) } })
          }
        />
      </section>
    </div>
  )
}

/** Events where the person is LoPro contact or TL of the band */
function EventsTab({ personId }: { personId: number }) {
  const events = trpcReact.dealMemo.listByPerson.useQuery(personId)
  const ledBands = trpcReact.band.listByResponsiblePerson.useQuery(personId)
  const ledBandIds = new Set((ledBands.data ?? []).map((band) => band.id))
  return (
    <EventsTable
      label="Events der Person"
      events={events.data}
      isLoading={events.isLoading}
      empty="Keine Events mit dieser Person als LoPro-Kontakt oder Technischer Leiter."
      columns={[
        {
          header: 'Band / Spielstätte',
          cell: (event) => (
            <>
              <div>{event.bandName}</div>
              <div className="text-xs text-muted-foreground">{event.venueName ?? '–'}</div>
            </>
          )
        },
        {
          header: 'Rolle',
          cell: (event) =>
            [
              event.loProPersonId === personId && 'LoPro-Kontakt',
              ledBandIds.has(event.bandId) && 'TL der Band'
            ]
              .filter(Boolean)
              .join(' · ')
        }
      ]}
    />
  )
}

/** Management contracts naming the person; a click opens the band's contracts */
function ContractsTab({ personId }: { personId: number }) {
  const navigate = useNavigate()
  const contracts = trpcReact.managementContract.listByPerson.useQuery(personId)
  const bands = trpcReact.band.getListItems.useQuery()
  const bandName = (id: number) => bands.data?.find((band) => band.id === id)?.name ?? '…'
  return (
    <RowTable
      label="Managementverträge der Person"
      rows={contracts.data}
      isLoading={contracts.isLoading}
      loading="Verträge werden geladen…"
      empty="In keinem Managementvertrag aufgeführt."
      columns={[
        { header: 'Band', cell: (contract) => bandName(contract.bandId), className: 'font-medium' },
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
  const openInvoice = useOpenInvoice()
  const invoices = trpcReact.invoice.listByPerson.useQuery(personId)
  return (
    <RowTable
      label="Rechnungen an die Person"
      rows={invoices.data}
      isLoading={invoices.isLoading}
      loading="Rechnungen werden geladen…"
      empty="Keine Rechnungen an diese Person."
      columns={[
        {
          header: 'Nr.',
          cell: (invoice) => invoiceNumberLabel(invoice.invoiceNumber),
          className: 'whitespace-nowrap font-medium'
        },
        {
          header: 'Datum',
          cell: (invoice) => formatShortDate(invoice.issueDate),
          className: 'whitespace-nowrap'
        },
        { header: 'Von', cell: (invoice) => invoice.companyName },
        { header: 'Event', cell: (invoice) => invoice.dealMemoName ?? '–' },
        {
          header: 'Status',
          cell: (invoice) => (
            <InvoiceStatusBadge
              status={invoice.status}
              kind={invoice.kind}
              cancelsInvoiceNumber={invoice.cancelsInvoiceNumber}
            />
          )
        },
        {
          header: 'Betrag',
          cell: (invoice) => formatMoney(invoice.totalAmount, invoice.currency),
          className: 'whitespace-nowrap text-right'
        }
      ]}
      onRowClick={openInvoice}
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
  const search = useSearch({ strict: false }) as { tab?: string }
  const mailClientEnabled = useMailClientEnabled()
  // the E-Mails tab exists only with the mail client on
  const activeTab =
    isPersonTab(search.tab) && (search.tab !== 'mails' || mailClientEnabled)
      ? search.tab
      : 'overview'
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<PersonDto>()

  const {
    data: person,
    isLoading,
    isError
  } = trpcReact.person.getById.useQuery({ id: id ?? 0 }, { enabled: id !== null })

  const updatePerson = trpcReact.person.update.useMutation({
    onSuccess: (data) => {
      void utils.person.invalidate()
      // Member lists show the person's name
      void utils.relation.invalidate()
      sheet.close()
      toast.success('Person aktualisiert', {
        description: `${personName(data)} wurde aktualisiert.`
      })
    },
    onError: (error) => {
      toast.error('Person konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  // A bad id never loads (the query stays disabled), it is not found
  if (id !== null && isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground">Person wird geladen…</p>
      </div>
    )
  }

  if (isError || !person) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Person nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/persons' })}>
          Zurück zu den Personen
        </Button>
      </div>
    )
  }

  const subtitle = [person.address?.city, person.contact?.email].filter(Boolean).join(' · ')

  return (
    <div className="flex h-full w-full min-w-0 flex-col p-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 gap-1.5 text-muted-foreground"
          onClick={() => navigate({ to: '/persons' })}
        >
          <ArrowLeft className="h-4 w-4" />
          Alle Personen
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{personName(person)}</h1>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-2">
            <FollowUpButton record={{ type: 'person', id: person.id, name: personName(person) }} />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => sheet.openEdit(person)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Bearbeiten
            </Button>
          </div>
        </div>
      </div>

      <RecordFollowUps record={{ type: 'person', id: person.id, name: personName(person) }} />

      <Tabs
        value={activeTab}
        onValueChange={(tab) =>
          // replace: switching tabs should not pile up history entries
          navigate({
            to: '/persons/$personId',
            params: { personId: String(person.id) },
            search: { tab: isPersonTab(tab) && tab !== 'overview' ? tab : undefined },
            replace: true
          })
        }
        className="flex-1"
      >
        {/* Tabs wrap onto a second row in narrow windows */}
        <TabsList className="mb-6 h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="bands">
            Bands
            <TabCount count={counts.bands} />
          </TabsTrigger>
          <TabsTrigger value="companies">
            Firmen
            <TabCount count={counts.companies} />
          </TabsTrigger>
          <TabsTrigger value="venues">
            Spielstätten
            <TabCount count={counts.venues} />
          </TabsTrigger>
          <TabsTrigger value="events">
            Events
            <TabCount count={counts.events} />
          </TabsTrigger>
          <TabsTrigger value="contracts">
            Managementverträge
            <TabCount count={counts.contracts} />
          </TabsTrigger>
          <TabsTrigger value="invoices">
            Rechnungen
            <TabCount count={counts.invoices} />
          </TabsTrigger>
          <TabsTrigger value="documents">
            Dokumente
            <TabCount count={counts.documents} />
          </TabsTrigger>
          {mailClientEnabled && <TabsTrigger value="mails">E-Mails</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab person={person} />
        </TabsContent>
        <TabsContent value="bands">
          <BandsTab personId={person.id} />
        </TabsContent>
        <TabsContent value="companies">
          <CompaniesTab personId={person.id} />
        </TabsContent>
        <TabsContent value="venues" className="max-w-2xl">
          <PersonMembershipsPanel personId={person.id} type="venue" />
        </TabsContent>
        <TabsContent value="events">
          <EventsTab personId={person.id} />
        </TabsContent>
        <TabsContent value="contracts">
          <ContractsTab personId={person.id} />
        </TabsContent>
        <TabsContent value="invoices">
          <InvoicesTab personId={person.id} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel ownerType="person" ownerId={person.id} title="Dokumente der Person" />
        </TabsContent>
        {mailClientEnabled && (
          <TabsContent value="mails">
            <MailHistoryPanel entityType="person" entityId={person.id} />
          </TabsContent>
        )}
      </Tabs>

      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode="edit"
        title="Person bearbeiten"
        description="Kontaktdaten der Person aktualisieren."
      >
        <PersonForm
          person={sheet.selectedItem || undefined}
          onSubmit={(data: z.infer<typeof CreatePersonInput> & { id?: number }) =>
            updatePerson.mutate(data as UpdatePersonInput)
          }
          onCancel={sheet.close}
        />
      </FormSheet>
    </div>
  )
}
