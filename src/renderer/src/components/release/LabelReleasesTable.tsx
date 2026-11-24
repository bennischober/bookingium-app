import { useNavigate } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'
import { formatShortDate } from '@/lib/utils'
import { RowTable } from '@/components/detail/DetailParts'
import { releaseTitle } from './releaseText'
import { RELEASE_TYPE_LABELS } from '../../../../main/api/schemas/release.schema'
import { t } from '../../../../main/i18n/translate'

/** #289: the releases a company put out as their label; a row opens the release */
export function LabelReleasesTable({ companyId }: { companyId: number }) {
  const navigate = useNavigate()
  const releases = trpcReact.release.listByLabelCompany.useQuery(companyId)
  return (
    <RowTable
      label={t('Releases des Labels')}
      query={releases}
      loading={t('Releases werden geladen…')}
      empty={t('Keine Releases mit dieser Firma als Label.')}
      itemLabel={{ singular: t('Release'), plural: t('Releases') }}
      onRowClick={(release) =>
        void navigate({ to: '/releases/$releaseId', params: { releaseId: String(release.id) } })
      }
      columns={[
        {
          header: t('VÖ'),
          cell: (release) => (release.releaseDate ? formatShortDate(release.releaseDate) : '-'),
          sortValue: (release) => release.releaseDate ?? ''
        },
        {
          header: t('Artist'),
          cell: (release) => release.artist || '-',
          sortValue: (release) => release.artist.toLowerCase()
        },
        {
          header: t('Titel'),
          cell: (release) => <span className="font-medium">{releaseTitle(release)}</span>,
          sortValue: (release) => release.title.toLowerCase()
        },
        { header: t('Art'), cell: (release) => RELEASE_TYPE_LABELS[release.releaseType] },
        { header: t('Katalognr.'), cell: (release) => release.catalogNumber || '-' }
      ]}
    />
  )
}
