import { useEffect, useState } from 'react'
import { FileText, FolderOpen, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingRow } from '@/components/load-states'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { confirmAction } from '@/lib/confirm'
import {
  DOCUMENT_TYPE_LABELS,
  DocumentType,
  type DocumentOwnerType
} from '../../../../main/api/schemas/document.schema'
import {
  droppedFilePaths,
  formatFileSize,
  formatUploadDate,
  openDocument,
  revealDocument
} from './documentFiles'

/**
 * Files of one record (event, band, …): drop or pick files to copy them into
 * the record's folder (storage/documents/<type>/<id>-<name>/), set their
 * type, open, show in folder or delete them.
 */
export function DocumentsPanel({
  ownerType,
  ownerId,
  title = 'Dokumente'
}: {
  ownerType: DocumentOwnerType
  ownerId: number
  title?: string
}) {
  const utils = trpcReact.useUtils()
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const owner = { ownerType, ownerId }

  // Files dropped next to the drop zone must not open in the window
  useEffect(() => {
    const preventWindowDrop = (event: DragEvent) => event.preventDefault()
    window.addEventListener('dragover', preventWindowDrop)
    window.addEventListener('drop', preventWindowDrop)
    return () => {
      window.removeEventListener('dragover', preventWindowDrop)
      window.removeEventListener('drop', preventWindowDrop)
    }
  }, [])

  const documentsQuery = trpcReact.document.listByOwner.useQuery(owner)
  const documents = documentsQuery.data ?? []
  const invalidate = () => utils.document.invalidate()

  const upload = trpcReact.document.upload.useMutation()

  const updateDocument = trpcReact.document.update.useMutation({
    onSuccess: () => {
      void invalidate()
      toast.success('Dokument aktualisiert')
    },
    onError: (error) => {
      toast.error('Dokument konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  const deleteDocument = trpcReact.document.delete.useMutation({
    onSuccess: () => {
      void invalidate()
      toast.success('Dokument gelöscht')
    },
    onError: (error) => {
      toast.error('Dokument konnte nicht gelöscht werden', { description: error.message })
    }
  })

  const openFolder = trpcReact.document.openOwnerFolder.useMutation({
    onError: (error) => {
      toast.error('Ordner konnte nicht geöffnet werden', { description: error.message })
    }
  })

  const uploadFiles = async (paths: string[]) => {
    setIsUploading(true)
    let uploaded = 0
    for (const sourcePath of paths) {
      try {
        await upload.mutateAsync({ ...owner, sourcePath })
        uploaded++
      } catch (error) {
        toast.error(`„${sourcePath.split(/[\\/]/).pop()}“ konnte nicht hochgeladen werden`, {
          description: error instanceof Error ? error.message : undefined
        })
      }
    }
    setIsUploading(false)
    void invalidate()
    if (uploaded > 0) {
      toast.success(uploaded === 1 ? 'Dokument hochgeladen' : `${uploaded} Dokumente hochgeladen`)
    }
  }

  const handleSelectFiles = async () => {
    const result = await window.api.showOpenDialog()
    if (result.canceled || !result.filePaths?.length) return
    await uploadFiles(result.filePaths)
  }

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const paths = droppedFilePaths(e)
    if (paths.length === 0) {
      toast.error('Dateien konnten nicht gelesen werden', {
        description:
          'Diese Drag-Quelle stellt keine lokalen Dateien bereit. Bitte verwenden Sie „Dateien auswählen“.'
      })
      return
    }
    await uploadFiles(paths)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Drag & Drop Zone */}
      <div
        className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'copy'
          setIsDragging(true)
        }}
        onDragLeave={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setIsDragging(false)
        }}
        onDrop={onDrop}
      >
        <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h3 className="mb-1 font-semibold">Dokumente hier ablegen oder Dateien auswählen</h3>
        <p className="mb-3 text-sm text-muted-foreground">
          Die Dateien werden in den Dokumentenordner dieses Eintrags kopiert.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={() => void handleSelectFiles()} disabled={isUploading}>
            {isUploading ? 'Wird hochgeladen…' : 'Dateien auswählen'}
          </Button>
          <Button
            variant="outline"
            onClick={() => openFolder.mutate(owner)}
            disabled={openFolder.isPending}
          >
            <FolderOpen className="h-4 w-4" /> Ordner öffnen
          </Button>
        </div>
      </div>

      {/* Documents List */}
      <div>
        <h3 className="mb-3 font-semibold">
          {title}{' '}
          {documents.length > 0 && (
            <span className="text-muted-foreground">({documents.length})</span>
          )}
        </h3>

        {documentsQuery.isLoading ? (
          <LoadingRow>Dokumente werden geladen…</LoadingRow>
        ) : documentsQuery.isError ? (
          <ErrorState error={documentsQuery.error} onRetry={() => void documentsQuery.refetch()} />
        ) : documents.length === 0 ? (
          <EmptyState>Noch keine Dokumente.</EmptyState>
        ) : (
          <ul className="space-y-2" aria-label={title}>
            {documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
              >
                <button
                  type="button"
                  onClick={() => void openDocument(doc.filePath)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                >
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium" title={doc.fileName}>
                      {doc.fileName}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{formatFileSize(doc.fileSize)}</span>
                      <span>·</span>
                      <span>{formatUploadDate(doc.uploadedAt)}</span>
                    </div>
                  </div>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  <Select
                    value={doc.documentType}
                    onValueChange={(value) =>
                      updateDocument.mutate({ id: doc.id, documentType: value as DocumentType })
                    }
                    disabled={updateDocument.isPending}
                  >
                    <SelectTrigger className="w-32" aria-label={`Art von ${doc.fileName}`}>
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

                  <Button
                    variant="ghost"
                    size="sm"
                    title="Im Ordner anzeigen"
                    aria-label="Im Ordner anzeigen"
                    onClick={() => void revealDocument(doc.filePath)}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    title="Löschen"
                    aria-label={`${doc.fileName} löschen`}
                    className="hover:text-destructive"
                    disabled={deleteDocument.isPending}
                    onClick={async () => {
                      if (
                        await confirmAction({
                          title: `„${doc.fileName}“ löschen?`,
                          description: 'Die Datei wird aus dem Dokumentenordner gelöscht.',
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
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
