import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { trpcReact } from '@/lib/trpc'
import { parseRecordId } from '@/lib/recordId'
import { formatLooseDate } from '@/lib/utils'
import { useBandTabCounts } from '@/hooks/useTabCounts'
import { RecordDetail, RecordDetailPage } from '@/components/detail/RecordDetailPage'
import { FormSheet } from '@/components/form-sheet'
import { BandForm } from '@/components/forms/BandForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { MembersPanel } from '@/components/MembersSheet'
import { ManagementContractPanel } from '@/components/band/ManagementContractSheet'
import { BandDocumentsView } from '@/components/documents/BandDocumentsView'
import { BAND_TAB_ALIASES, isBandTab } from '@/components/band/constants'
import { FactSheet, LinkList, TabSection } from '@/components/detail/CompactParts'
import {
  eventItems,
  openInvoices,
  upcoming,
  useInvoiceItems
} from '@/components/detail/relatedLinks'
import { sumCounts } from '@/hooks/useTabCounts'
import { RecordInvoicesTable } from '@/components/invoice/RecordInvoicesTable'
import { MarketingTab } from '@/components/band/marketing/MarketingTab'
import { EventsTable } from '@/components/detail/DetailParts'
import { eventPlace } from '@/components/event-list/pastEvent'
import type { BandDto } from '../../../main/api/schemas/band.schema'
import { t } from '../../../main/i18n/translate'

/**
 * Overview: the band's data in one sheet, its members, the next shows and what is still unpaid.
 * Everything long (all events, contracts, marketing) has its own tab.
 */
function OverviewTab({ band }: { band: BandDto }) {
  const navigate = useNavigate()
  const companies = trpcReact.company.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const events = trpcReact.dealMemo.listByBand.useQuery(band.id)
  const invoices = trpcReact.invoice.listByBand.useQuery(band.id)
  const next = upcoming(events.data)
  const unpaid = openInvoices(invoices.data)
  const invoiceItems = useInvoiceItems(unpaid)
  const companyName = (id: number | null) =>
    id === null ? null : (companies.data?.find((company) => company.id === id)?.name ?? '…')
  const responsible = persons.data?.find((person) => person.id === band.responsiblePersonId)

  const companyLink = (id: number | null) => {
    const name = companyName(id)
    if (id === null || name === null) return null
    return (
      <Link
        to="/companies/$companyId"
        params={{ companyId: String(id) }}
        className="font-medium hover:underline"
      >
        {name}
      </Link>
    )
  }
  const toTab = (tab: 'events' | 'invoices') =>
    navigate({ to: '.', search: { tab } as never, replace: true })

  return (
    <div className="space-y-6">
      <FactSheet
        groups={[
          {
            title: t('Band'),
            facts: [
              [t('Genre'), band.genre],
              [t('Gegründet'), band.founded && formatLooseDate(band.founded)],
              [
                t('Technischer Leiter'),
                responsible && (
                  <Link
                    to="/persons/$personId"
                    params={{ personId: String(responsible.id) }}
                    className="font-medium hover:underline"
                  >
                    {responsible.firstName} {responsible.lastName}
                  </Link>
                )
              ]
            ]
          },
          {
            title: t('Firma und Management'),
            facts: [
              [t('Firma der Band'), companyLink(band.companyId)],
              [
                t('Management'),
                companyLink(band.managementCompanyId) ?? (
                  <span className="text-muted-foreground">{t('Standardfirma')}</span>
                )
              ]
            ]
          },
          {
            title: t('Anmerkungen'),
            facts: [
              [t('Notiz'), band.notes && <span className="whitespace-pre-wrap">{band.notes}</span>]
            ]
          }
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <LinkList
          title={t('Nächste Shows')}
          items={eventItems(next)}
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
              {t('Verträge & Rechnungen')}
            </button>
          }
        />
      </div>
      <TabSection id="section-members" title={t('Mitglieder')}>
        <MembersPanel entityType="band" entityId={band.id} />
      </TabSection>
    </div>
  )
}

/** The band's events, newest first; a click opens the event */
function EventsTab({ bandId }: { bandId: number }) {
  const events = trpcReact.dealMemo.listByBand.useQuery(bandId)
  return (
    <EventsTable
      label={t('Events der Band')}
      query={events}
      empty={t('Noch keine Events für diese Band.')}
      columns={[{ header: t('Club / Festival, Ort'), cell: (event) => eventPlace(event) }]}
    />
  )
}

/** Management contracts and the invoices for the band's events or addressed to the band */
function MoneyTab({ bandId }: { bandId: number }) {
  const invoices = trpcReact.invoice.listByBand.useQuery(bandId)
  return (
    <div className="space-y-10">
      <TabSection id="section-contracts" title={t('Managementverträge')}>
        <ManagementContractPanel bandId={bandId} />
      </TabSection>
      <TabSection title={t('Rechnungen')}>
        <RecordInvoicesTable
          label={t('Rechnungen der Band')}
          query={invoices}
          empty={t('Keine Rechnungen zu Events der Band oder an die Band.')}
        />
      </TabSection>
    </div>
  )
}

/**
 * Band page: everything about one band in tabs (members, events, management
 * contracts, documents). Quick edits of the band itself stay in the sheet.
 */
export default function BandDetailPage() {
  const { bandId } = useParams({ strict: false }) as { bandId?: string }
  const id = parseRecordId(bandId)
  const counts = useBandTabCounts(id)
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<BandDto>()
  const band = trpcReact.band.getById.useQuery(id ?? 0, { enabled: id !== null })

  // #162: delete from the detail page, then back to the list
  const mutations = useRecordMutations({
    procedures: trpcReact.band,
    utils: utils.band,
    noun: t('Band'),
    label: (band: BandDto) => band.name,
    deleteInput: (band) => band.id,
    onSaved: sheet.close,
    onDeleted: () => navigate({ to: '/band' })
  })

  const toList = () => navigate({ to: '/band' })

  return (
    <RecordDetailPage
      id={id}
      query={band}
      loading={t('Band wird geladen…')}
      notFound={{
        text: t('Band nicht gefunden.'),
        backLabel: t('Zurück zu den Bands'),
        onBack: toList
      }}
    >
      {(band) => (
        <RecordDetail
          record={{ type: 'band', id: band.id, name: band.name }}
          back={{ label: t('Alle Bands'), onBack: toList }}
          subtitle={band.genre}
          onEdit={() => sheet.openEdit(band)}
          onDelete={() => mutations.deleteNow(band)}
          deleting={mutations.isDeleting}
          isTab={isBandTab}
          aliases={BAND_TAB_ALIASES}
          tabs={[
            { id: 'overview', label: t('Übersicht'), content: <OverviewTab band={band} /> },
            {
              id: 'events',
              label: t('Events'),
              count: counts.events,
              hideWhenEmpty: true,
              content: <EventsTab bandId={band.id} />
            },
            {
              id: 'marketing',
              label: t('Marketing'),
              content: <MarketingTab bandId={band.id} bandName={band.name} />
            },
            {
              id: 'invoices',
              label: t('Verträge & Rechnungen'),
              count: sumCounts(counts.contracts, counts.invoices),
              content: <MoneyTab bandId={band.id} />
            }
          ]}
          documents={{
            count: counts.documents,
            title: t('Dokumente der Band'),
            // The band's own documents above (editable), its events' documents below,
            // filtered by category and event
            extra: <BandDocumentsView bandId={band.id} />
          }}
        >
          <FormSheet
            isOpen={sheet.isOpen}
            onClose={sheet.close}
            mode="edit"
            title={t('Band bearbeiten')}
            description={t('Bandinformationen aktualisieren.')}
          >
            <BandForm
              mode="edit"
              initialData={sheet.selectedItem}
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
