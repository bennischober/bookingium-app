import { useParams, useNavigate, useSearch, Link } from '@tanstack/react-router'
import { ArrowLeft, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { z } from 'zod'
import { trpcReact } from '@/lib/trpc'
import { useOpenInvoice } from '@/hooks/useOpenInvoice'
import { formatShortDate } from '@/lib/utils'
import { formatMoney, invoiceNumberLabel } from '@/lib/invoiceLabels'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InvoiceStatusBadge } from '@/components/invoice/InvoiceStatusBadge'
import { FollowUpButton, RecordFollowUps } from '@/components/follow-ups/RecordFollowUps'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { CompanyForm } from '@/components/forms/CompanyForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { MembersPanel } from '@/components/MembersSheet'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import { isCompanyTab } from '@/components/company/constants'
import {
  AddressLines,
  Empty,
  EventsTable,
  Fields,
  InfoCard,
  RowTable
} from '@/components/detail/DetailParts'
import type {
  CompanyDto,
  CreateCompanyInput,
  UpdateCompanyInput
} from '../../../main/api/schemas/company.schema'
import { VENUE_KIND_LABELS } from '../../../main/api/schemas/venue.schema'

/** Overview: address, contact, tax and register data, bank, invoicing */
function OverviewTab({ company }: { company: CompanyDto }) {
  const { contact, bank } = company
  const persons = trpcReact.person.getListItems.useQuery(undefined, {
    enabled: company.invoiceContactPersonId !== null
  })
  const invoiceContact = persons.data?.find(
    (person) => person.id === company.invoiceContactPersonId
  )
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <InfoCard label="Adresse">
        <AddressLines address={company.address} />
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
      <InfoCard label="Steuer & Register">
        <Fields
          fields={[
            ['USt-IdNr.', company.vatNumber],
            ['USt-Nr.', company.ustNumber],
            ['Steuernummer', company.taxNumber],
            ['Registernummer', company.commercialRegisterNo],
            ['Registergericht', company.registerCourt],
            ['KSK-Nr.', company.kskNumber]
          ]}
        />
      </InfoCard>
      <InfoCard label="Bankverbindung">
        <Fields
          fields={[
            ['Bank', bank?.bankName],
            ['Inhaber', bank?.accountHolder],
            ['IBAN', bank?.iban],
            ['BIC', bank?.bic]
          ]}
        />
      </InfoCard>
      <InfoCard label="Rechnungsstellung">
        {company.isDefaultForInvoicing ? (
          <span className="font-medium">Standardfirma für Rechnungen</span>
        ) : (
          <Empty>Nicht die Standardfirma für Rechnungen</Empty>
        )}
        {invoiceContact && (
          <div className="mt-1">
            <span className="text-muted-foreground">Ansprechpartner für Rechnungen: </span>
            <Link
              to="/persons/$personId"
              params={{ personId: String(invoiceContact.id) }}
              className="font-medium hover:underline"
            >
              {`${invoiceContact.firstName} ${invoiceContact.lastName}`.trim()}
            </Link>
          </div>
        )}
      </InfoCard>
      <InfoCard label="Anmerkungen">
        {company.notes ? <p className="whitespace-pre-wrap">{company.notes}</p> : <Empty />}
      </InfoCard>
    </div>
  )
}

/** Bands the company owns ("Firma der Band") or manages; a click opens the band */
function BandsTab({ companyId }: { companyId: number }) {
  const navigate = useNavigate()
  const bands = trpcReact.band.listByCompany.useQuery(companyId)
  return (
    <RowTable
      label="Bands der Firma"
      rows={bands.data}
      isLoading={bands.isLoading}
      loading="Bands werden geladen…"
      empty="Keine Bands gehören zu dieser Firma oder werden von ihr gemanagt."
      columns={[
        { header: 'Band', cell: (band) => band.name, className: 'font-medium' },
        { header: 'Genre', cell: (band) => band.genre || '–' },
        {
          header: 'Rolle',
          cell: (band) =>
            [
              band.companyId === companyId && 'Firma der Band',
              band.managementCompanyId === companyId && 'Management'
            ]
              .filter(Boolean)
              .join(' · ')
        }
      ]}
      onRowClick={(band) => navigate({ to: '/band/$bandId', params: { bandId: String(band.id) } })}
    />
  )
}

/** Venues the company runs; a click opens the venue */
function VenuesTab({ companyId }: { companyId: number }) {
  const navigate = useNavigate()
  const venues = trpcReact.venue.listByCompany.useQuery(companyId)
  return (
    <RowTable
      label="Spielstätten der Firma"
      rows={venues.data}
      isLoading={venues.isLoading}
      loading="Spielstätten werden geladen…"
      empty="Keine Spielstätten mit dieser Firma."
      columns={[
        { header: 'Spielstätte', cell: (venue) => venue.name, className: 'font-medium' },
        { header: 'Art', cell: (venue) => VENUE_KIND_LABELS[venue.kind] },
        { header: 'Stadt', cell: (venue) => venue.address?.city || '–' },
        {
          header: 'Kapazität',
          cell: (venue) => venue.capacity?.toLocaleString('de-DE') ?? '–'
        }
      ]}
      onRowClick={(venue) =>
        navigate({ to: '/venues/$venueId', params: { venueId: String(venue.id) } })
      }
    />
  )
}

/** Events where the company is local promoter or invoice company */
function EventsTab({ companyId }: { companyId: number }) {
  const events = trpcReact.dealMemo.listByCompany.useQuery(companyId)
  return (
    <EventsTable
      label="Events der Firma"
      events={events.data}
      isLoading={events.isLoading}
      empty="Keine Events mit dieser Firma als LoPro oder Rechnungsfirma."
      columns={[
        {
          // One column for both keeps the table within narrow windows
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
              event.loProCompanyId === companyId && 'LoPro',
              event.invoiceCompanyId === companyId && 'Rechnungsfirma'
            ]
              .filter(Boolean)
              .join(' · ')
        }
      ]}
    />
  )
}

/** Invoices the company issued or received; a click opens the print view */
function InvoicesTab({ companyId }: { companyId: number }) {
  const openInvoice = useOpenInvoice()
  const invoices = trpcReact.invoice.listByCompany.useQuery(companyId)
  return (
    <RowTable
      label="Rechnungen der Firma"
      rows={invoices.data}
      isLoading={invoices.isLoading}
      loading="Rechnungen werden geladen…"
      empty="Keine Rechnungen von oder an diese Firma."
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
        {
          header: 'Partner',
          // Issued invoices name the recipient, received ones the issuer
          cell: (invoice) =>
            invoice.companyId === companyId
              ? `an ${invoice.recipientName}`
              : `von ${invoice.companyName}`
        },
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
 * Company page: everything about one company in tabs (contacts, bands,
 * venues, events, invoices, documents). Quick edits stay in the sheet.
 */
export default function CompanyDetailPage() {
  const { companyId } = useParams({ strict: false }) as { companyId?: string }
  const id = Number(companyId)
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { tab?: string }
  const activeTab = isCompanyTab(search.tab) ? search.tab : 'overview'
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<CompanyDto>()

  const {
    data: company,
    isLoading,
    isError
  } = trpcReact.company.getById.useQuery({ id }, { enabled: Number.isFinite(id) && id > 0 })

  const updateCompany = trpcReact.company.update.useMutation({
    onSuccess: (data) => {
      void utils.company.invalidate()
      sheet.close()
      toast.success('Firma aktualisiert', { description: `${data.name} wurde aktualisiert.` })
    },
    onError: (error) => {
      toast.error('Firma konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground">Firma wird geladen…</p>
      </div>
    )
  }

  if (isError || !company) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Firma nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/companies' })}>
          Zurück zu den Firmen
        </Button>
      </div>
    )
  }

  const city = company.address?.city

  return (
    <div className="flex h-full w-full min-w-0 flex-col p-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 gap-1.5 text-muted-foreground"
          onClick={() => navigate({ to: '/companies' })}
        >
          <ArrowLeft className="h-4 w-4" />
          Alle Firmen
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{company.name}</h1>
            {(city || company.isDefaultForInvoicing) && (
              <p className="mt-1 text-sm text-muted-foreground">
                {[city, company.isDefaultForInvoicing && 'Standardfirma für Rechnungen']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-2">
            <FollowUpButton record={{ type: 'company', id: company.id, name: company.name }} />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => sheet.openEdit(company)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Bearbeiten
            </Button>
          </div>
        </div>
      </div>

      <RecordFollowUps record={{ type: 'company', id: company.id, name: company.name }} />

      <Tabs
        value={activeTab}
        onValueChange={(tab) =>
          // replace: switching tabs should not pile up history entries
          navigate({
            to: '/companies/$companyId',
            params: { companyId: String(company.id) },
            search: { tab: isCompanyTab(tab) && tab !== 'overview' ? tab : undefined },
            replace: true
          })
        }
        className="flex-1"
      >
        {/* Tabs wrap onto a second row in narrow windows */}
        <TabsList className="mb-6 h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="contacts">Ansprechpartner</TabsTrigger>
          <TabsTrigger value="bands">Bands</TabsTrigger>
          <TabsTrigger value="venues">Spielstätten</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="invoices">Rechnungen</TabsTrigger>
          <TabsTrigger value="documents">Dokumente</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab company={company} />
        </TabsContent>
        <TabsContent value="contacts" className="max-w-2xl">
          <MembersPanel entityType="company" entityId={company.id} />
        </TabsContent>
        <TabsContent value="bands">
          <BandsTab companyId={company.id} />
        </TabsContent>
        <TabsContent value="venues">
          <VenuesTab companyId={company.id} />
        </TabsContent>
        <TabsContent value="events">
          <EventsTab companyId={company.id} />
        </TabsContent>
        <TabsContent value="invoices">
          <InvoicesTab companyId={company.id} />
        </TabsContent>
        <TabsContent value="documents">
          <DocumentsPanel ownerType="company" ownerId={company.id} title="Dokumente der Firma" />
        </TabsContent>
      </Tabs>

      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode="edit"
        title="Firma bearbeiten"
        description="Firmeninformationen aktualisieren."
      >
        <CompanyForm
          company={sheet.selectedItem || undefined}
          onSubmit={(data: z.infer<typeof CreateCompanyInput> & { id?: number }) =>
            updateCompany.mutate(data as UpdateCompanyInput)
          }
          onCancel={sheet.close}
        />
      </FormSheet>
    </div>
  )
}
