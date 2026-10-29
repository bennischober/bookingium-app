import { FileText, FolderOpen } from 'lucide-react'
import { EmptyState, ErrorState, LoadingRow } from '@/components/load-states'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentType
} from '../../../../main/api/schemas/document.schema'
import { formatFileSize, openDocument, revealDocument } from './documentFiles'

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

  if (documentsQuery.isLoading || documentsQuery.isError) {
    return (
      <section aria-label="Dokumente der Band">
        <h3 className="mb-1 font-semibold">Dokumente der Band</h3>
        {documentsQuery.isLoading ? (
          <LoadingRow>Dokumente werden geladen…</LoadingRow>
        ) : (
          <ErrorState error={documentsQuery.error} onRetry={() => void documentsQuery.refetch()} />
        )}
      </section>
    )
  }

  return (
    <section aria-label="Dokumente der Band">
      <h3 className="mb-1 font-semibold">
        Dokumente der Band{' '}
        {documents.length > 0 && (
          <span className="text-muted-foreground">({documents.length})</span>
        )}
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        {bandName ? `Dokumente von ${bandName}` : 'Dokumente der Band'}, verwaltet im Dokumente-Tab
        der Band.
      </p>

      {documents.length === 0 ? (
        <EmptyState>Keine Dokumente in der Band.</EmptyState>
      ) : (
        <ul className="rounded-lg border" aria-label="Dokumente der Band">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-b-0"
            >
              <button
                type="button"
                onClick={() => void openDocument(doc.filePath)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
              >
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate" title={doc.fileName}>
                  {doc.fileName}
                </span>
              </button>
              <span className="shrink-0 text-xs text-muted-foreground">
                {DOCUMENT_TYPE_LABELS[doc.documentType as DocumentType] ?? doc.documentType} ·{' '}
                {formatFileSize(doc.fileSize)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                title="Im Ordner anzeigen"
                aria-label="Im Ordner anzeigen"
                onClick={() => void revealDocument(doc.filePath)}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
