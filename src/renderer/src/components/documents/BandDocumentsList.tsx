import { trpcReact } from '@/lib/trpc'
import { DocumentTable } from './DocumentTable'
import { t } from '../../../../main/i18n/translate'

/**
 * D1: the other direction of inheritance. The band page already lists its events'
 * documents; this shows the band's own documents on one of its gigs, so the rider or the
 * tech spec is there without a second upload.
 *
 * Read-only on purpose: a file is managed where it was uploaded, and that is the band.
 */
export function BandDocumentsList({ bandId, bandName }: { bandId: number; bandName?: string }) {
  const documentsQuery = trpcReact.document.listByOwner.useQuery({
    ownerType: 'band',
    ownerId: bandId
  })

  const documents = documentsQuery.data ?? []

  return (
    <section aria-label={t('Dokumente der Band')}>
      <h3 className="mb-1 font-semibold">
        {t('Dokumente der Band')}{' '}
        {documents.length > 0 && (
          <span className="text-muted-foreground">({documents.length})</span>
        )}
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        {bandName ? t('Dokumente von {{bandName}}', { bandName }) : t('Dokumente der Band')}
        {t(', verwaltet im Dokumente-Tab der Band.')}
      </p>

      <DocumentTable
        rows={documents.map((doc) => ({ doc, event: null }))}
        label={t('Dokumente der Band')}
        empty={t('Keine Dokumente in der Band.')}
        isLoading={documentsQuery.isLoading}
        error={documentsQuery.error}
        onRetry={() => void documentsQuery.refetch()}
        readOnly
      />
    </section>
  )
}
