import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { formatShortDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { RowTable } from '@/components/detail/DetailParts'
import { FormSheet } from '@/components/form-sheet'
import { ReleaseForm } from '@/components/forms/ReleaseForm'
import { useFormSheet } from '@/hooks/useFormSheet'
import { useRecordMutations } from '@/hooks/useRecordMutations'
import { releaseTitle } from './releaseText'
import {
  RELEASE_TYPE_LABELS,
  type CreateReleaseRequest,
  type ReleaseDto,
  type UpdateReleaseRequest
} from '../../../../main/api/schemas/release.schema'
import { t } from '../../../../main/i18n/translate'

/** #289: the releases of a band; a row opens the release, a new one starts with the band */
export function BandReleasesTab({ bandId }: { bandId: number }) {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const releases = trpcReact.release.listByBand.useQuery(bandId)
  const sheet = useFormSheet<ReleaseDto>()
  const open = (release: ReleaseDto) =>
    void navigate({ to: '/releases/$releaseId', params: { releaseId: String(release.id) } })
  const mutations = useRecordMutations<
    ReleaseDto,
    CreateReleaseRequest,
    UpdateReleaseRequest,
    number
  >({
    procedures: trpcReact.release,
    utils: utils.release,
    noun: t('Release'),
    label: (release) => release.title,
    deleteInput: (release) => release.id,
    onSaved: (release) => {
      sheet.close()
      open(release)
    }
  })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={sheet.openCreate}>
          <Plus className="h-3.5 w-3.5" />
          {t('Neues Release')}
        </Button>
      </div>
      <RowTable
        label={t('Releases der Band')}
        query={releases}
        loading={t('Releases werden geladen…')}
        empty={t('Noch keine Releases. Lege eines an und trage die Labelcopy ein.')}
        itemLabel={{ singular: t('Release'), plural: t('Releases') }}
        onRowClick={open}
        columns={[
          {
            header: t('VÖ'),
            cell: (release) => (release.releaseDate ? formatShortDate(release.releaseDate) : '-'),
            sortValue: (release) => release.releaseDate ?? ''
          },
          {
            header: t('Titel'),
            cell: (release) => <span className="font-medium">{releaseTitle(release)}</span>,
            sortValue: (release) => release.title.toLowerCase()
          },
          { header: t('Art'), cell: (release) => RELEASE_TYPE_LABELS[release.releaseType] },
          { header: t('Label'), cell: (release) => release.label || '-' },
          { header: t('Katalognr.'), cell: (release) => release.catalogNumber || '-' },
          { header: t('Tracks'), cell: (release) => release.trackCount || '-' }
        ]}
      />
      <FormSheet
        isOpen={sheet.isOpen}
        onClose={sheet.close}
        mode="create"
        title={t('Neues Release anlegen')}
        description={t('Kopfdaten des Releases. Tracks und Produkte folgen auf seiner Seite.')}
      >
        <ReleaseForm
          mode="create"
          defaultBandId={bandId}
          onSubmit={mutations.submit}
          onCancel={sheet.close}
          isSubmitting={mutations.isSubmitting}
        />
      </FormSheet>
    </div>
  )
}
