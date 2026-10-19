import { Link } from '@tanstack/react-router'
import { FileText, FolderOpen } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentType,
  type EventDocumentDto
} from '../../../../main/api/schemas/document.schema'
import { formatFileSize, openDocument, revealDocument } from './documentFiles'

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

/**
 * Documents of a band's events, grouped by event (read-only here; they are
 * managed on the event's Dokumente tab)
 */
export function EventDocumentsList({ bandId }: { bandId: number }) {
  const { data: documents = [], isLoading } =
    trpcReact.document.listEventDocumentsForBand.useQuery(bandId)

  const byEvent = new Map<number, EventDocumentDto[]>()
  for (const doc of documents) byEvent.set(doc.ownerId, [...(byEvent.get(doc.ownerId) ?? []), doc])

  return (
    <section aria-label="Dokumente aus Events">
      <h3 className="mb-1 font-semibold">
        Aus Events{' '}
        {documents.length > 0 && (
          <span className="text-muted-foreground">({documents.length})</span>
        )}
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Dokumente der Events dieser Band, verwaltet im Dokumente-Tab des jeweiligen Events.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Dokumente werden geladen…</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">Keine Dokumente in den Events.</p>
      ) : (
        <div className="space-y-4">
          {[...byEvent.entries()].map(([eventId, eventDocuments]) => (
            <div key={eventId} className="rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
                <Link
                  to="/events/$eventId"
                  params={{ eventId: String(eventId) }}
                  search={{ tab: 'documents' }}
                  className="min-w-0 truncate font-medium hover:underline"
                >
                  {eventDocuments[0].eventName}
                </Link>
                <span className="shrink-0 text-muted-foreground">
                  {formatEventDate(eventDocuments[0].eventDate)}
                </span>
              </div>
              <ul>
                {eventDocuments.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-2 px-3 py-2 text-sm">
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
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
