import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { trpcReact } from '@/lib/trpc'
import { parseRecordId } from '@/lib/recordId'
import { useCompanyTabCounts } from '@/hooks/useTabCounts'
import { RecordInvoicesTable } from '@/components/invoice/RecordInvoicesTable'
import { RecordDetail, RecordDetailPage } from '@/components/detail/RecordDetailPage'
import { RelatedEventsTable } from '@/components/detail/RelatedTables'
import { FormSheet } from '@/components/form-sheet'
import { CompanyForm } from '@/components/forms/CompanyForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { MembersPanel } from '@/components/MembersSheet'
import { COMPANY_TAB_ALIASES, isCompanyTab } from '@/components/company/constants'
import { addressBlock, contactFacts } from '@/components/detail/facts'
import { FactSheet, LinkList, TabSection } from '@/components/detail/CompactParts'
import {
  bandItems,
  eventItems,
  openInvoices,
  upcoming,
  useInvoiceItems,
  venueItems
} from '@/components/detail/relatedLinks'
import { CompanyMarketingCard } from '@/components/band/marketing/MarketingLinksCard'
import { VENUE_KIND_LABELS } from '../../../main/api/schemas/venue.schema'
import type { CompanyDto } from '../../../main/api/schemas/company.schema'
import { COMPANY_KIND_LABELS } from '../../../main/api/schemas/company.schema'
import { t } from '../../../main/i18n/translate'

/**
 * Overview: the company's data in one sheet, then what it is linked to (bands, clubs and
 * festivals, next events, open invoices) as short lists, then its contacts
 */
function OverviewTab({ company }: { company: CompanyDto }) {
  const navigate = useNavigate()
  const { contact, bank } = company
  const persons = trpcReact.person.getListItems.useQuery(undefined, {
    enabled: company.invoiceContactPersonId !== null
  })
  const bands = trpcReact.band.listByCompany.useQuery(company.id)
  const venues = trpcReact.venue.listByCompany.useQuery(company.id)
  const events = trpcReact.dealMemo.listByCompany.useQuery(company.id)
  const invoices = trpcReact.invoice.listByCompany.useQuery(company.id)
  const invoiceItems = useInvoiceItems(openInvoices(invoices.data))
  const invoiceContact = persons.data?.find(
    (person) => person.id === company.invoiceContactPersonId
  )
  const toTab = (tab: 'events' | 'invoices') =>
    navigate({ to: '.', search: { tab } as never, replace: true })
  const bandRows = bands.data?.map((band) => ({
    ...band,
    role: [
      band.companyId === company.id && t('Firma der Band'),
      band.managementCompanyId === company.id && t('Management')
    ]
      .filter(Boolean)
      .join(' · ')
  }))

  return (
    <div className="space-y-6">
      <FactSheet
        groups={[
          {
            title: t('Kontakt'),
            facts: [...contactFacts(contact), [t('Adresse'), addressBlock(company.address)]]
          },
          {
            title: t('Rechnungen'),
            facts: [
              [t('Standardfirma'), company.isDefaultForInvoicing && t('Ja, für eigene Rechnungen')],
              [
                t('Ansprechpartner'),
                invoiceContact && (
                  <Link
                    to="/persons/$personId"
                    params={{ personId: String(invoiceContact.id) }}
                    className="font-medium hover:underline"
                  >
                    {`${invoiceContact.firstName} ${invoiceContact.lastName}`.trim()}
                  </Link>
                )
              ],
              [
                t('Kundennummer'),
                company.customerNumber == null ? null : String(company.customerNumber)
              ]
            ]
          },
          {
            title: t('Steuer & Register'),
            facts: [
              ['USt-IdNr.', company.vatId],
              [t('Steuernummer'), company.taxNumber],
              [t('Registernummer'), company.commercialRegisterNo],
              [t('Registergericht'), company.registerCourt],
              ['KSK-Nr.', company.kskNumber]
            ]
          },
          {
            title: t('Bankverbindung'),
            facts: [
              [t('Bank'), bank?.bankName],
              [t('Inhaber'), bank?.accountHolder],
              ['IBAN', bank?.iban],
              ['BIC', bank?.bic]
            ]
          },
          {
            title: t('Medien'),
            facts:
              company.kind === 'media'
                ? [
                    [t('Art'), COMPANY_KIND_LABELS[company.kind]],
                    [t('Genres'), company.genres]
                  ]
                : []
          },
          {
            title: t('Anmerkungen'),
            facts: [
              [
                t('Notiz'),
                company.notes && <span className="whitespace-pre-wrap">{company.notes}</span>
              ]
            ]
          }
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div id="section-bands">
          <LinkList
            title={t('Bands')}
            items={bandItems(bandRows, (band) => bandRows?.find((row) => row.id === band.id)?.role)}
          />
        </div>
        <div id="section-venues">
          <LinkList
            title={t('Clubs / Festivals')}
            items={venueItems(venues.data, (venue) => {
              const row = venues.data?.find((entry) => entry.id === venue.id)
              return row
                ? [VENUE_KIND_LABELS[row.kind], row.address?.city].filter(Boolean).join(' · ')
                : null
            })}
          />
        </div>
        <LinkList
          title={t('Nächste Events')}
          items={eventItems(upcoming(events.data))}
          action={
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => toTab('events')}
            >
              {t('Alle Events')}
            </button>
          }
        />
        <LinkList
          title={t('Offene Rechnungen')}
          items={invoiceItems}
          action={
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => toTab('invoices')}
            >
              {t('Alle Rechnungen')}
            </button>
          }
        />
      </div>
      <CompanyMarketingCard companyId={company.id} />
      <TabSection id="section-contacts" title={t('Ansprechpartner')}>
        <MembersPanel entityType="company" entityId={company.id} />
      </TabSection>
    </div>
  )
}

/** Events where the company is local promoter or invoice company */
function EventsTab({ companyId }: { companyId: number }) {
  const events = trpcReact.dealMemo.listByCompany.useQuery(companyId)
  return (
    <RelatedEventsTable
      label={t('Events der Firma')}
      query={events}
      empty={t('Keine Events mit dieser Firma als LoPro oder Rechnungsfirma.')}
      roles={(event) => [
        event.loProCompanyId === companyId && 'LoPro',
        event.invoiceCompanyId === companyId && t('Rechnungsfirma')
      ]}
    />
  )
}

/** Invoices the company issued or received; a click opens the print view */
function InvoicesTab({ companyId }: { companyId: number }) {
  const invoices = trpcReact.invoice.listByCompany.useQuery(companyId)
  return (
    <RecordInvoicesTable
      label={t('Rechnungen der Firma')}
      query={invoices}
      empty={t('Keine Rechnungen von oder an diese Firma.')}
    />
  )
}

/**
 * Company page: the overview holds its data, links and contacts; events and invoices (long,
 * sortable lists) have a tab each, shown once there are any. Quick edits stay in the sheet.
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
    noun: t('Firma'),
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
      loading={t('Firma wird geladen…')}
      notFound={{
        text: t('Firma nicht gefunden.'),
        backLabel: t('Zurück zu den Firmen'),
        onBack: toList
      }}
    >
      {(company) => (
        <RecordDetail
          record={{ type: 'company', id: company.id, name: company.name }}
          back={{ label: t('Alle Firmen'), onBack: toList }}
          subtitle={[
            company.address?.city,
            company.isDefaultForInvoicing && t('Standardfirma für Rechnungen')
          ]
            .filter(Boolean)
            .join(' · ')}
          onEdit={() => sheet.openEdit(company)}
          onDelete={() => mutations.deleteNow(company)}
          deleting={mutations.isDeleting}
          isTab={isCompanyTab}
          aliases={COMPANY_TAB_ALIASES}
          tabs={[
            { id: 'overview', label: t('Übersicht'), content: <OverviewTab company={company} /> },
            {
              id: 'events',
              label: t('Events'),
              count: counts.events,
              hideWhenEmpty: true,
              content: <EventsTab companyId={company.id} />
            },
            {
              id: 'invoices',
              label: t('Rechnungen'),
              count: counts.invoices,
              hideWhenEmpty: true,
              content: <InvoicesTab companyId={company.id} />
            }
          ]}
          documents={{ count: counts.documents, title: t('Dokumente der Firma') }}
        >
          <FormSheet
            isOpen={sheet.isOpen}
            onClose={sheet.close}
            mode="edit"
            title={t('Firma bearbeiten')}
            description={t('Firmeninformationen aktualisieren.')}
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
