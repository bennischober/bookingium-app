import { useMemo, useState } from 'react'
import { trpcReact } from '@/lib/trpc'
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
import { DocumentTable } from './DocumentTable'
import { ALL, categoriesOf, eventsOf, rowsOf } from './bandDocuments'

export function BandDocumentsView({ bandId }: { bandId: number }) {
  // The band's own documents are listed (and edited) by the DocumentsPanel above this view;
  // listing them here as well showed every band file twice under the same heading
  const {
    data: fromEvents = [],
    isLoading,
    error,
    refetch
  } = trpcReact.document.listEventDocumentsForBand.useQuery(bandId)

  const [category, setCategory] = useState<string>(ALL)
  const [eventId, setEventId] = useState<string>(ALL)

  // The events that actually have documents - a filter over empty entries is noise
  const events = useMemo(() => eventsOf(fromEvents), [fromEvents])

  const categories = useMemo(() => categoriesOf([], fromEvents, DOCUMENT_TYPE_LABELS), [fromEvents])

  const rows = useMemo(
    () => rowsOf([], fromEvents, { category, eventId }),
    [fromEvents, category, eventId]
  )

  const filtered = category !== ALL || eventId !== ALL
  const total = fromEvents.length

  return (
    <section aria-label="Dokumente aus Events" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="font-semibold">
          Dokumente aus Events{' '}
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

      <DocumentTable
        rows={rows}
        label="Dokumentliste aus Events"
        empty={
          total === 0
            ? 'Noch keine Dokumente in den Events der Band.'
            : 'Keine Dokumente für diese Auswahl.'
        }
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        readOnly
        onChanged={() => void refetch()}
      />
    </section>
  )
}
