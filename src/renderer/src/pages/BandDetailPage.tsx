import { useParams, useNavigate, Link } from '@tanstack/react-router'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { trpcReact } from '@/lib/trpc'
import { parseRecordId } from '@/lib/recordId'
import { useBandTabCounts } from '@/hooks/useTabCounts'
import { RecordDetail, RecordDetailPage } from '@/components/detail/RecordDetailPage'
import { FormSheet } from '@/components/form-sheet'
import { BandForm } from '@/components/forms/BandForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { MembersPanel } from '@/components/MembersSheet'
import { ManagementContractPanel } from '@/components/band/ManagementContractSheet'
import { BandDocumentsView } from '@/components/documents/BandDocumentsView'
import { isBandTab } from '@/components/band/constants'
import { RecordInvoicesTable } from '@/components/invoice/RecordInvoicesTable'
import { Empty, EventsTable, InfoCard } from '@/components/detail/DetailParts'
import type { BandDto } from '../../../main/api/schemas/band.schema'

/** Overview: who the band is, who bills and represents it */
function OverviewTab({ band }: { band: BandDto }) {
  const companies = trpcReact.company.getListItems.useQuery()
  const persons = trpcReact.person.getListItems.useQuery()
  const companyName = (id: number | null) =>
    id === null ? null : (companies.data?.find((company) => company.id === id)?.name ?? '…')
  const responsible = persons.data?.find((person) => person.id === band.responsiblePersonId)

  const companyLink = (id: number | null, fallback: string) => {
    const name = companyName(id)
    if (id === null || name === null)
      return <span className="text-muted-foreground">{fallback}</span>
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

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <InfoCard label="Firma der Band">{companyLink(band.companyId, '–')}</InfoCard>
      <InfoCard label="Management (vertreten durch)">
        {companyLink(band.managementCompanyId, 'Standardfirma (keine eigene hinterlegt)')}
      </InfoCard>
      <InfoCard label="Technischer Leiter">
        {responsible ? (
          <Link
            to="/persons/$personId"
            params={{ personId: String(responsible.id) }}
            className="font-medium hover:underline"
          >
            {responsible.firstName} {responsible.lastName}
          </Link>
        ) : (
          <Empty />
        )}
      </InfoCard>
      <InfoCard label="Genre / Gründung">
        {[band.genre, band.founded].filter(Boolean).join(' · ') || <Empty />}
      </InfoCard>
      <div className="md:col-span-2">
        <InfoCard label="Anmerkungen">
          {band.notes ? <p className="whitespace-pre-wrap">{band.notes}</p> : <Empty />}
        </InfoCard>
      </div>
    </div>
  )
}

/** The band's events, newest first; a click opens the event */
function EventsTab({ bandId }: { bandId: number }) {
  const events = trpcReact.dealMemo.listByBand.useQuery(bandId)
  return (
    <EventsTable
      label="Events der Band"
      query={events}
      empty="Noch keine Events für diese Band."
      columns={[{ header: 'Club / Festival', cell: (event) => event.venueName ?? '–' }]}
    />
  )
}

/** Invoices for the band's events or addressed to the band; a click opens the print view */
function InvoicesTab({ bandId }: { bandId: number }) {
  const invoices = trpcReact.invoice.listByBand.useQuery(bandId)
  return (
    <RecordInvoicesTable
      label="Rechnungen der Band"
      query={invoices}
      empty="Keine Rechnungen zu Events der Band oder an die Band."
    />
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
    noun: 'Band',
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
      loading="Band wird geladen…"
      notFound={{ text: 'Band nicht gefunden.', backLabel: 'Zurück zu den Bands', onBack: toList }}
    >
      {(band) => (
        <RecordDetail
          record={{ type: 'band', id: band.id, name: band.name }}
          back={{ label: 'Alle Bands', onBack: toList }}
          subtitle={band.genre}
          onEdit={() => sheet.openEdit(band)}
          onDelete={() => mutations.deleteNow(band)}
          deleting={mutations.isDeleting}
          isTab={isBandTab}
          tabs={[
            { id: 'overview', label: 'Übersicht', content: <OverviewTab band={band} /> },
            {
              id: 'members',
              label: 'Mitglieder',
              count: counts.members,
              className: 'max-w-2xl',
              content: <MembersPanel entityType="band" entityId={band.id} />
            },
            {
              id: 'events',
              label: 'Events',
              count: counts.events,
              content: <EventsTab bandId={band.id} />
            },
            {
              id: 'contracts',
              label: 'Managementverträge',
              count: counts.contracts,
              className: 'max-w-3xl',
              content: <ManagementContractPanel bandId={band.id} />
            },
            {
              id: 'invoices',
              label: 'Rechnungen',
              count: counts.invoices,
              content: <InvoicesTab bandId={band.id} />
            }
          ]}
          documents={{
            count: counts.documents,
            title: 'Dokumente der Band',
            // The band's own documents above (editable), its events' documents below,
            // filtered by category and event
            extra: <BandDocumentsView bandId={band.id} />
          }}
        >
          <FormSheet
            isOpen={sheet.isOpen}
            onClose={sheet.close}
            mode="edit"
            title="Band bearbeiten"
            description="Bandinformationen aktualisieren."
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
