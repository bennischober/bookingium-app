import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FileText, FolderOpen } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DOCUMENT_TYPE_LABELS,
  type DocumentType
} from '../../../../main/api/schemas/document.schema'
import { openDocument, revealDocument } from './documentFiles'
import { ALL, categoriesOf, eventsOf, rowsOf } from './bandDocuments'

function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  })
}

export function BandDocumentsView({ bandId }: { bandId: number }) {
  const { data: own = [], isLoading: ownLoading } = trpcReact.document.listByOwner.useQuery({
    ownerType: 'band',
    ownerId: bandId
  })
  const { data: fromEvents = [], isLoading: eventsLoading } =
    trpcReact.document.listEventDocumentsForBand.useQuery(bandId)

  const [category, setCategory] = useState<string>(ALL)
  const [eventId, setEventId] = useState<string>(ALL)

  // The events that actually have documents - a filter over empty entries is noise
  const events = useMemo(() => eventsOf(fromEvents), [fromEvents])

  const categories = useMemo(
    () => categoriesOf(own, fromEvents, DOCUMENT_TYPE_LABELS),
    [own, fromEvents]
  )

  // The band's own documents are shown under "Band", the events' under their event
  const rows = useMemo(
    () => rowsOf(own, fromEvents, { category, eventId }),
    [own, fromEvents, category, eventId]
  )

  const isLoading = ownLoading || eventsLoading
  const filtered = category !== ALL || eventId !== ALL
  const total = own.length + fromEvents.length

  return (
    <section aria-label="Alle Dokumente der Band" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="font-semibold">
          Dokumente der Band{' '}
          {total > 0 && (
            <span className="text-muted-foreground">
              ({filtered ? `${rows.length} von ${total}` : total})
            </span>
          )}
        </h3>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={category} onValueChange={setCategory} disabled={categories.length === 0}>
            <SelectTrigger className="w-44" aria-label="Nach Kategorie filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Kategorien</SelectItem>
              {categories.map((value) => (
                <SelectItem key={value} value={value}>
                  {DOCUMENT_TYPE_LABELS[value as DocumentType] ?? value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={eventId} onValueChange={setEventId} disabled={events.length === 0}>
            <SelectTrigger className="w-56" aria-label="Nach Event filtern">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle Events</SelectItem>
              {events.map((event) => (
                <SelectItem key={event.id} value={String(event.id)}>
                  {event.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Dokumente werden geladen…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {total === 0 ? 'Noch keine Dokumente.' : 'Keine Dokumente für diese Auswahl.'}
        </p>
      ) : (
        <ul className="rounded-lg border" aria-label="Dokumentliste der Band">
          {rows.map(({ doc, event }) => (
            <li
              key={`${event ? `event-${event.id}` : 'band'}-${doc.id}`}
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
                {DOCUMENT_TYPE_LABELS[doc.documentType as DocumentType] ?? doc.documentType}
              </span>
              {/* Where it comes from: the band itself or one of its gigs */}
              <span
                className="w-40 shrink-0 truncate text-xs text-muted-foreground"
                title={event?.name ?? 'Band'}
              >
                {event ? (
                  <Link
                    to="/events/$eventId"
                    params={{ eventId: String(event.id) }}
                    search={{ tab: 'documents' }}
                    className="hover:underline"
                  >
                    {formatEventDate(event.date)} {event.name}
                  </Link>
                ) : (
                  'Band'
                )}
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
