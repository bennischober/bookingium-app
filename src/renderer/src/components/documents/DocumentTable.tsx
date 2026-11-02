import { useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowDown, ArrowUp, ArrowUpDown, FileText, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState, ErrorState, LoadingRow } from '@/components/load-states'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { confirmAction } from '@/lib/confirm'
import { cn, formatShortDate } from '@/lib/utils'
import { trpcReact } from '@/lib/trpc'
import type { QueryError } from '@/lib/queryErrors'
import {
  DOCUMENT_TYPE_LABELS,
  DocumentType,
  type DocumentDto,
  type EventDocumentDto
} from '../../../../main/api/schemas/document.schema'
import { openDocument, revealDocument } from './documentFiles'
import {
  DEFAULT_DOCUMENT_SORT,
  fileNameExtension,
  formatFileSize,
  nextDocumentSort,
  shownName,
  sortDocuments,
  type DocumentSort,
  type DocumentSortKey
} from './documentSort'

/** Where a document came from: the record itself (null) or one of a band's gigs */
export type DocumentSource = { id: number; name: string; date: string } | null

export type DocumentRow = { doc: DocumentDto | EventDocumentDto; event: DocumentSource }

const HEADERS: { key: DocumentSortKey | null; label: string; className?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Typ' },
  { key: null, label: 'Quelle' },
  { key: 'size', label: 'Größe', className: 'text-right' },
  { key: 'uploadedAt', label: 'Hochgeladen' },
  { key: null, label: 'Aktionen', className: 'text-right' }
]

/**
 * The one document table: Name · Typ · Quelle · Größe · Hochgeladen · actions.
 * `readOnly` drops the editing actions (the file is managed where it was uploaded).
 */
export function DocumentTable({
  rows,
  label,
  empty,
  isLoading = false,
  error,
  onRetry,
  readOnly = false,
  onChanged
}: {
  rows: DocumentRow[]
  label: string
  empty: string
  isLoading?: boolean
  error?: QueryError
  onRetry?: () => void
  readOnly?: boolean
  /** Called after a type change or delete so the caller can refetch */
  onChanged?: () => void
}) {
  const [sort, setSort] = useState<DocumentSort>(DEFAULT_DOCUMENT_SORT)
  const [busyId, setBusyId] = useState<number | null>(null)
  // The row being renamed and the text typed so far; null = no row is editing
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null)
  // Enter and Escape close the field, and closing it blurs it while `renaming` is
  // still the old state: this keeps that blur from saving a second time, or from
  // saving what Escape threw away
  const closed = useRef(false)

  const sorted = useMemo(() => sortDocuments(rows, sort, DOCUMENT_TYPE_LABELS), [rows, sort])

  const updateDocument = trpcReact.document.update.useMutation({
    onSuccess: () => {
      onChanged?.()
      toast.success('Dokument aktualisiert')
    },
    onError: (mutationError) => {
      toast.error('Dokument konnte nicht aktualisiert werden', {
        description: mutationError.message
      })
    }
  })

  const deleteDocument = trpcReact.document.delete.useMutation({
    onSuccess: () => {
      onChanged?.()
      toast.success('Die Datei wird in den Papierkorb verschoben.')
    },
    onError: (mutationError) => {
      toast.error('Dokument konnte nicht gelöscht werden', {
        description: mutationError.message
      })
    }
  })

  /**
   * Keeps the extension of the file on disk when the user leaves it out: renaming
   * "Scan" to "Rechnung" gives "Rechnung.pdf", not a file without a suffix.
   */
  const saveName = (doc: DocumentDto | EventDocumentDto) => {
    if (!renaming || renaming.id !== doc.id || closed.current) return
    closed.current = true
    const typed = renaming.value.trim()
    setRenaming(null)
    // Unchanged, or cleared back to the file name: nothing to send
    if (typed === shownName(doc)) return
    const extension = fileNameExtension(doc.fileName)
    const next =
      typed.length === 0 ? null : typed.endsWith(extension) ? typed : `${typed}${extension}`
    setBusyId(doc.id)
    updateDocument.mutate({ id: doc.id, displayName: next }, { onSettled: () => setBusyId(null) })
  }

  if (isLoading) return <LoadingRow>Dokumente werden geladen…</LoadingRow>
  if (error && rows.length === 0) return <ErrorState error={error} onRetry={() => onRetry?.()} />
  if (sorted.length === 0) return <EmptyState>{empty}</EmptyState>

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm" aria-label={label}>
        <thead className="bg-muted text-left">
          <tr>
            {HEADERS.map((header) => {
              const isSorted = header.key !== null && sort.key === header.key
              return (
                <th
                  key={header.label}
                  aria-sort={isSorted ? (sort.desc ? 'descending' : 'ascending') : undefined}
                  className={cn('px-3 py-2 font-medium whitespace-nowrap', header.className)}
                >
                  {header.key ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort((current) =>
                          nextDocumentSort(current, header.key as DocumentSortKey)
                        )
                      }
                      className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
                      title="Sortieren"
                    >
                      {header.label}
                      {isSorted ? (
                        sort.desc ? (
                          <ArrowDown className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUp className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />
                      )}
                    </button>
                  ) : (
                    header.label
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ doc, event }) => (
            <tr
              key={`${event ? `event-${event.id}` : 'own'}-${doc.id}`}
              className="border-t hover:bg-muted/50"
            >
              <td className="px-3 py-2">
                {renaming?.id === doc.id ? (
                  <input
                    autoFocus
                    aria-label={`Name von ${doc.fileName}`}
                    className="w-full rounded border bg-background px-2 py-1 text-sm"
                    value={renaming.value}
                    disabled={busyId === doc.id}
                    onChange={(event) => setRenaming({ id: doc.id, value: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        saveName(doc)
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        closed.current = true
                        setRenaming(null)
                      }
                    }}
                    // Leaving the field keeps what was typed, like Enter does
                    onBlur={() => saveName(doc)}
                  />
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void openDocument(doc.filePath)}
                      className="flex min-w-0 items-center gap-2 text-left hover:underline"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate" title={doc.fileName}>
                        {shownName(doc)}
                      </span>
                    </button>
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Umbenennen"
                        aria-label={`${shownName(doc)} umbenennen`}
                        className="shrink-0"
                        onClick={() => {
                          closed.current = false
                          setRenaming({ id: doc.id, value: shownName(doc) })
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                {readOnly ? (
                  <span className="text-muted-foreground">
                    {DOCUMENT_TYPE_LABELS[doc.documentType as DocumentType] ?? doc.documentType}
                  </span>
                ) : (
                  <Select
                    value={doc.documentType}
                    onValueChange={(value) => {
                      setBusyId(doc.id)
                      updateDocument.mutate(
                        { id: doc.id, documentType: value as DocumentType },
                        { onSettled: () => setBusyId(null) }
                      )
                    }}
                    disabled={busyId === doc.id}
                  >
                    <SelectTrigger className="w-32" aria-label={`Art von ${shownName(doc)}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DocumentType.options.map((type) => (
                        <SelectItem key={type} value={type}>
                          {DOCUMENT_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </td>
              <td className="max-w-52 px-3 py-2">
                {event ? (
                  <Link
                    to="/events/$eventId"
                    params={{ eventId: String(event.id) }}
                    search={{ tab: 'documents' }}
                    className="block max-w-full"
                    title={`${formatShortDate(event.date)} ${event.name}`}
                  >
                    <Badge variant="outline" className="max-w-full truncate">
                      {formatShortDate(event.date)} {event.name}
                    </Badge>
                  </Link>
                ) : (
                  <span className="text-xs text-muted-foreground">Band</span>
                )}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                {formatFileSize(doc.fileSize)}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{formatShortDate(doc.uploadedAt)}</td>
              <td className="px-3 py-2">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Im Ordner anzeigen"
                    aria-label="Im Ordner anzeigen"
                    onClick={() => void revealDocument(doc.filePath)}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Löschen"
                      aria-label={`${shownName(doc)} löschen`}
                      className="hover:text-destructive"
                      disabled={deleteDocument.isPending}
                      onClick={async () => {
                        if (
                          await confirmAction({
                            title: `„${shownName(doc)}“ löschen?`,
                            description: 'Die Datei wird in den Papierkorb verschoben.',
                            confirmLabel: 'Löschen',
                            destructive: true
                          })
                        ) {
                          deleteDocument.mutate(doc.id)
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
