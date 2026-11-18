import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { trpcReact } from '@/lib/trpc'
import { parseRecordId } from '@/lib/recordId'
import { useCompanyTabCounts } from '@/hooks/useTabCounts'
import { RecordInvoicesTable } from '@/components/invoice/RecordInvoicesTable'
import { RecordDetail, RecordDetailPage } from '@/components/detail/RecordDetailPage'
import {
  RelatedBandsTable,
  RelatedEventsTable,
  RelatedVenuesTable
} from '@/components/detail/RelatedTables'
import { FormSheet } from '@/components/form-sheet'
import { CompanyForm } from '@/components/forms/CompanyForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { MembersPanel } from '@/components/MembersSheet'
import { isCompanyTab } from '@/components/company/constants'
import { AddressLines, Empty, Fields, InfoCard } from '@/components/detail/DetailParts'
import type { CompanyDto } from '../../../main/api/schemas/company.schema'
import { COMPANY_KIND_LABELS } from '../../../main/api/schemas/company.schema'

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
      {company.kind === 'media' && (
        <InfoCard label="Verteiler">
          <Fields
            fields={[
              ['Art', COMPANY_KIND_LABELS[company.kind]],
              ['Genres', company.genres]
            ]}
          />
        </InfoCard>
      )}
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
            ['USt-IdNr.', company.vatId],
            ['Steuernummer', company.taxNumber],
            ['Registernummer', company.commercialRegisterNo],
            ['Registergericht', company.registerCourt],
            ['KSK-Nr.', company.kskNumber],
            ['Kundennummer', company.customerNumber == null ? null : String(company.customerNumber)]
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

/** Bands the company owns ("Firma der Band") or manages */
function BandsTab({ companyId }: { companyId: number }) {
  const bands = trpcReact.band.listByCompany.useQuery(companyId)
  return (
    <RelatedBandsTable
      label="Bands der Firma"
      query={bands}
      empty="Keine Bands gehören zu dieser Firma oder werden von ihr gemanagt."
      roles={(band) => [
        band.companyId === companyId && 'Firma der Band',
        band.managementCompanyId === companyId && 'Management'
      ]}
    />
  )
}

/** Venues the company runs */
function VenuesTab({ companyId }: { companyId: number }) {
  const venues = trpcReact.venue.listByCompany.useQuery(companyId)
  return (
    <RelatedVenuesTable
      label="Clubs und Festivals der Firma"
      query={venues}
      empty="Keine Clubs und Festivals mit dieser Firma."
    />
  )
}

/** Events where the company is local promoter or invoice company */
function EventsTab({ companyId }: { companyId: number }) {
  const events = trpcReact.dealMemo.listByCompany.useQuery(companyId)
  return (
    <RelatedEventsTable
      label="Events der Firma"
      query={events}
      empty="Keine Events mit dieser Firma als LoPro oder Rechnungsfirma."
      roles={(event) => [
        event.loProCompanyId === companyId && 'LoPro',
        event.invoiceCompanyId === companyId && 'Rechnungsfirma'
      ]}
    />
  )
}

/** Invoices the company issued or received; a click opens the print view */
function InvoicesTab({ companyId }: { companyId: number }) {
  const invoices = trpcReact.invoice.listByCompany.useQuery(companyId)
  return (
    <RecordInvoicesTable
      label="Rechnungen der Firma"
      query={invoices}
      empty="Keine Rechnungen von oder an diese Firma."
    />
  )
}

/**
 * Company page: everything about one company in tabs (contacts, bands,
 * venues, events, invoices, documents). Quick edits stay in the sheet.
 */
export default function CompanyDetailPage() {
  const { companyId } = useParams({ strict: false }) as { companyId?: string }
  const id = parseRecordId(companyId)
  const counts = useCompanyTabCounts(id)
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<CompanyDto>()
  const company = trpcReact.company.getById.useQuery({ id: id ?? 0 }, { enabled: id !== null })

  // #162: delete from the detail page, then back to the list
  const mutations = useRecordMutations({
    procedures: trpcReact.company,
    utils: utils.company,
    noun: 'Firma',
    label: (company: CompanyDto) => company.name,
    deleteInput: (company) => ({ id: company.id }),
    onSaved: sheet.close,
    onDeleted: () => navigate({ to: '/companies' })
  })

  const toList = () => navigate({ to: '/companies' })

  return (
    <RecordDetailPage
      id={id}
      query={company}
      loading="Firma wird geladen…"
      notFound={{
        text: 'Firma nicht gefunden.',
        backLabel: 'Zurück zu den Firmen',
        onBack: toList
      }}
    >
      {(company) => (
        <RecordDetail
          record={{ type: 'company', id: company.id, name: company.name }}
          back={{ label: 'Alle Firmen', onBack: toList }}
          subtitle={[
            company.address?.city,
            company.isDefaultForInvoicing && 'Standardfirma für Rechnungen'
          ]
            .filter(Boolean)
            .join(' · ')}
          onEdit={() => sheet.openEdit(company)}
          onDelete={() => mutations.deleteNow(company)}
          deleting={mutations.isDeleting}
          isTab={isCompanyTab}
          tabs={[
            { id: 'overview', label: 'Übersicht', content: <OverviewTab company={company} /> },
            {
              id: 'contacts',
              label: 'Ansprechpartner',
              count: counts.contacts,
              content: <MembersPanel entityType="company" entityId={company.id} />
            },
            {
              id: 'bands',
              label: 'Bands',
              count: counts.bands,
              content: <BandsTab companyId={company.id} />
            },
            {
              id: 'venues',
              label: 'Clubs / Festivals',
              count: counts.venues,
              content: <VenuesTab companyId={company.id} />
            },
            {
              id: 'events',
              label: 'Events',
              count: counts.events,
              content: <EventsTab companyId={company.id} />
            },
            {
              id: 'invoices',
              label: 'Rechnungen',
              count: counts.invoices,
              content: <InvoicesTab companyId={company.id} />
            }
          ]}
          documents={{ count: counts.documents, title: 'Dokumente der Firma' }}
        >
          <FormSheet
            isOpen={sheet.isOpen}
            onClose={sheet.close}
            mode="edit"
            title="Firma bearbeiten"
            description="Firmeninformationen aktualisieren."
          >
            <CompanyForm
              company={sheet.selectedItem || undefined}
              onSubmit={mutations.submit}
              onCancel={sheet.close}
              isSubmitting={mutations.isSubmitting}
            />
          </FormSheet>
        </RecordDetail>
      )}
    </RecordDetailPage>
  )
}
