import { useParams, useNavigate, useSearch, Link } from '@tanstack/react-router'
import { ArrowLeft, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { FormSheet } from '@/components/form-sheet'
import { BandForm } from '@/components/forms/BandForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { MembersPanel } from '@/components/MembersSheet'
import { ManagementContractPanel } from '@/components/band/ManagementContractSheet'
import { DocumentsPanel } from '@/components/documents/DocumentsPanel'
import { EventDocumentsList } from '@/components/documents/EventDocumentsList'
import { isBandTab } from '@/components/band/constants'
import { EventsTable, InfoCard } from '@/components/detail/DetailParts'
import type { BandDto, UpdateBandInput } from '../../../main/api/schemas/band.schema'

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
      <Link to="/companies" search={{ open: id }} className="font-medium hover:underline">
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
          <span className="font-medium">
            {responsible.firstName} {responsible.lastName}
          </span>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </InfoCard>
      <InfoCard label="Genre / Gründung">
        {[band.genre, band.founded].filter(Boolean).join(' · ') || (
          <span className="text-muted-foreground">–</span>
        )}
      </InfoCard>
      <div className="md:col-span-2">
        <InfoCard label="Anmerkungen">
          {band.notes ? (
            <p className="whitespace-pre-wrap">{band.notes}</p>
          ) : (
            <span className="text-muted-foreground">–</span>
          )}
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
      events={events.data}
      isLoading={events.isLoading}
      empty="Noch keine Events für diese Band."
      columns={[{ header: 'Spielstätte', cell: (event) => event.venueName ?? '–' }]}
    />
  )
}

/**
 * Band page: everything about one band in tabs (members, events, management
 * contracts, documents). Quick edits of the band itself stay in the sheet.
 */
export default function BandDetailPage() {
  const { bandId } = useParams({ strict: false }) as { bandId?: string }
  const id = Number(bandId)
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { tab?: string }
  const activeTab = isBandTab(search.tab) ? search.tab : 'overview'
  const utils = trpcReact.useUtils()
  const sheet = useFormSheet<BandDto>()

  const {
    data: band,
    isLoading,
    isError
  } = trpcReact.band.getById.useQuery(id, {
    enabled: Number.isFinite(id) && id > 0
  })

  const updateBand = trpcReact.band.update.useMutation({
    onSuccess: (data) => {
      void utils.band.invalidate()
      sheet.close()
      toast.success('Band aktualisiert', { description: `${data.name} wurde aktualisiert.` })
    },
    onError: (error) => {
      toast.error('Band konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <p className="text-muted-foreground">Band wird geladen…</p>
      </div>
    )
  }

  if (isError || !band) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Band nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/band' })}>
          Zurück zu den Bands
        </Button>
      </div>
    )
  }

  return (
    <div className="flex h-full w-full min-w-0 flex-col p-6">
      <div className="mb-6">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 -ml-2 gap-1.5 text-muted-foreground"
          onClick={() => navigate({ to: '/band' })}
        >
          <ArrowLeft className="h-4 w-4" />
          Alle Bands
        </Button>

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">{band.name}</h1>
            {band.genre && <p className="mt-1 text-sm text-muted-foreground">{band.genre}</p>}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-1 shrink-0 gap-1.5"
            onClick={() => sheet.openEdit(band)}
          >
            <Pencil className="h-3.5 w-3.5" />
            Bearbeiten
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(tab) =>
          // replace: switching tabs should not pile up history entries
          navigate({
            to: '/band/$bandId',
            params: { bandId: String(band.id) },
            search: { tab: isBandTab(tab) && tab !== 'overview' ? tab : undefined },
            replace: true
          })
        }
        className="flex-1"
      >
        <TabsList className="mb-6 max-w-full overflow-x-auto">
          <TabsTrigger value="overview">Übersicht</TabsTrigger>
          <TabsTrigger value="members">Mitglieder</TabsTrigger>
          <TabsTrigger value="events">Events</TabsTrigger>
          <TabsTrigger value="contracts">Managementverträge</TabsTrigger>
          <TabsTrigger value="documents">Dokumente</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab band={band} />
        </TabsContent>
        <TabsContent value="members" className="max-w-2xl">
          <MembersPanel entityType="band" entityId={band.id} />
        </TabsContent>
        <TabsContent value="events">
          <EventsTab bandId={band.id} />
        </TabsContent>
        <TabsContent value="contracts" className="max-w-3xl">
          <ManagementContractPanel bandId={band.id} />
        </TabsContent>
        <TabsContent value="documents" className="space-y-8">
          <DocumentsPanel ownerType="band" ownerId={band.id} title="Dokumente der Band" />
          <EventDocumentsList bandId={band.id} />
        </TabsContent>
      </Tabs>

      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode="edit"
        title="Band bearbeiten"
        description="Nehmen Sie Änderungen am Bandprofil unten vor."
      >
        <BandForm
          mode="edit"
          initialData={sheet.selectedItem}
          onSubmit={(data) => updateBand.mutate(data as UpdateBandInput)}
          onCancel={sheet.close}
          isSubmitting={updateBand.isPending}
        />
      </FormSheet>
    </div>
  )
}
