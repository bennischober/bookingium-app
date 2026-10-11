'use client'

import { useEffect, useState } from 'react'
import { trpcReact } from '@/main'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { FileText, Trash2, Upload, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import type { DealMemoDetailDto } from 'src/main/api/schemas/deal_memo.schema'
import type { DocumentType } from 'src/main/api/schemas/document.schema'

export interface DocumentsTabProps {
  event: DealMemoDetailDto
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  deal_memo: 'Deal Memo',
  contract: 'Vertrag',
  rider: 'Rider',
  invoice: 'Rechnung',
  other: 'Sonstiges'
}

export function DocumentsTab({ event }: DocumentsTabProps) {
  const utils = trpcReact.useUtils()
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    const preventWindowDrop = (event: DragEvent) => {
      event.preventDefault()
    }

    window.addEventListener('dragover', preventWindowDrop)
    window.addEventListener('drop', preventWindowDrop)

    return () => {
      window.removeEventListener('dragover', preventWindowDrop)
      window.removeEventListener('drop', preventWindowDrop)
    }
  }, [])

  // Fetch documents for this event
  const { data: documents = [], isLoading } = trpcReact.document.getByDealMemoId.useQuery(event.id)

  // Mutations
  const createDocumentMutation = trpcReact.document.create.useMutation({
    onSuccess: () => {
      utils.document.getByDealMemoId.invalidate(event.id)
      toast.success('Dokument erfolgreich hochgeladen')
    },
    onError: (error) => {
      toast.error('Dokument konnte nicht hochgeladen werden', { description: error.message })
    }
  })

  const updateDocumentMutation = trpcReact.document.update.useMutation({
    onSuccess: () => {
      utils.document.getByDealMemoId.invalidate(event.id)
      toast.success('Dokument aktualisiert')
    },
    onError: (error) => {
      toast.error('Dokument konnte nicht aktualisiert werden', { description: error.message })
    }
  })

  const deleteDocumentMutation = trpcReact.document.delete.useMutation({
    onSuccess: () => {
      utils.document.getByDealMemoId.invalidate(event.id)
      toast.success('Dokument gelöscht')
    },
    onError: (error) => {
      toast.error('Dokument konnte nicht gelöscht werden', { description: error.message })
    }
  })

  // Handle file upload - called by file picker or drag-and-drop
  const handleFileUpload = async (filePath: string, fileName: string) => {
    try {
      // Call IPC to copy file to event storage
      const uploadResult = await window.api.uploadDocument(event.id, filePath, fileName)

      if (!uploadResult.success) {
        toast.error('Upload fehlgeschlagen', { description: uploadResult.error })
        return
      }

      // Get file type from extension
      const ext = fileName.split('.').pop()?.toLowerCase() || ''
      const mimeType = getMimeType(ext)

      // Create document record in database
      createDocumentMutation.mutate({
        dealMemoId: event.id,
        fileName: uploadResult.fileName || fileName,
        fileType: mimeType,
        filePath: uploadResult.relativePath || '',
        documentType: 'other',
        fileSize: Math.max(uploadResult.fileSize ?? 0, 1),
        uploadedBy: undefined
      })
    } catch (error) {
      toast.error('Fehler beim Hochladen des Dokuments', {
        description: error instanceof Error ? error.message : 'Unbekannter Fehler'
      })
    }
  }

  // Handle file dialog and upload
  const handleSelectFiles = async () => {
    try {
      const result = await window.api.showOpenDialog()

      if (result.canceled || !result.filePaths) {
        return
      }

      setIsUploading(true)

      // Upload each selected file
      for (const filePath of result.filePaths) {
        const fileName = filePath.split(/[\\/]/).pop() || 'unknown'
        await handleFileUpload(filePath, fileName)
      }

      setIsUploading(false)
    } catch (error) {
      console.error('Error selecting files:', error)
      toast.error('Dateien konnten nicht ausgewählt werden', {
        description: error instanceof Error ? error.message : 'Unbekannter Fehler'
      })
      setIsUploading(false)
    }
  }

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }

  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const onDropZoneDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const fileInfos = extractDroppedFiles(e)

    if (fileInfos.length === 0) {
      const types = Array.from(e.dataTransfer.types ?? [])
      toast.error('Dateien konnten nicht gelesen werden', {
        description:
          types.length === 0
            ? 'Das Betriebssystem hat keine Drag-Daten bereitgestellt. Falls das Problem bestehen bleibt, verwenden Sie „Dateien auswählen“.'
            : 'Diese Drag-Quelle stellt keine lokalen Dateipfade bereit. Bitte verwenden Sie „Dateien auswählen“.'
      })
      return
    }

    setIsUploading(true)

    for (const file of fileInfos) {
      await handleFileUpload(file.filePath, file.fileName)
    }

    setIsUploading(false)
  }

  const handleDocumentTypeChange = (documentId: number, newType: DocumentType) => {
    updateDocumentMutation.mutate({
      id: documentId,
      documentType: newType
    })
  }

  const handleOpenDocument = async (filePath: string) => {
    try {
      const result = await window.api.openDocument(filePath)
      if (!result.success) {
        // If opening fails, try revealing in folder instead
        await handleRevealInFolder(filePath)
      }
    } catch (error) {
      toast.error('Fehler beim Öffnen des Dokuments', {
        description: error instanceof Error ? error.message : 'Unbekannter Fehler'
      })
    }
  }

  const handleRevealInFolder = async (filePath: string) => {
    try {
      const result = await window.api.revealDocumentInFolder(filePath)
      if (!result.success) {
        toast.error('Fehler beim Anzeigen der Datei im Ordner', { description: result.error })
      }
    } catch (error) {
      toast.error('Fehler beim Anzeigen der Datei im Ordner', {
        description: error instanceof Error ? error.message : 'Unbekannter Fehler'
      })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-muted-foreground">Dokumente werden geladen…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Drag & Drop Zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDropZoneDrop}
      >
        <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <h3 className="font-semibold mb-1">Dokumente hier ablegen oder Dateien auswählen</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Ziehen Sie Dateien aus Ihrem Dateimanager hierher oder klicken Sie unten zum Durchsuchen
        </p>
        <Button
          onClick={handleSelectFiles}
          disabled={isUploading || createDocumentMutation.isPending}
        >
          {isUploading ? 'Wird hochgeladen...' : 'Dateien auswählen'}
        </Button>
      </div>

      {/* Documents List */}
      <div>
        <h3 className="font-semibold mb-3">
          Dokumente{' '}
          {documents.length > 0 && (
            <span className="text-muted-foreground">({documents.length})</span>
          )}
        </h3>

        {documents.length === 0 ? (
          <div className="flex items-center justify-center py-8 border border-dashed rounded-lg">
            <div className="text-center text-muted-foreground">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">Noch keine Dokumente</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <button
                    type="button"
                    onClick={() => handleOpenDocument(doc.filePath)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left hover:underline"
                  >
                    <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate" title={doc.fileName}>
                        {doc.fileName}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatFileSize(doc.fileSize)}</span>
                        <span>·</span>
                        <span>{formatDate(doc.uploadedAt)}</span>
                      </div>
                    </div>
                  </button>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Select
                    value={doc.documentType}
                    onValueChange={(value) =>
                      handleDocumentTypeChange(doc.id, value as DocumentType)
                    }
                    disabled={updateDocumentMutation.isPending}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    variant="ghost"
                    size="sm"
                    title="Im Ordner anzeigen"
                    onClick={() => handleRevealInFolder(doc.filePath)}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteDocumentMutation.isPending}
                    onClick={() => {
                      if (
                        confirm(
                          `„${doc.fileName}" löschen? Diese Aktion kann nicht rückgängig gemacht werden.`
                        )
                      ) {
                        deleteDocumentMutation.mutate(doc.id)
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// Utility functions
function formatFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('de-DE', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    csv: 'text/csv',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    zip: 'application/zip',
    '7z': 'application/x-7z-compressed',
    rar: 'application/x-rar-compressed'
  }

  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream'
}

function extractDroppedFiles(
  e: React.DragEvent<HTMLDivElement>
): Array<{ filePath: string; fileName: string }> {
  const filesFromList = Array.from(e.dataTransfer.files ?? [])
    .map((file) => ({
      filePath: (file as File & { path?: string }).path,
      fileName: file.name
    }))
    .filter((file): file is { filePath: string; fileName: string } => Boolean(file.filePath))

  if (filesFromList.length > 0) {
    return filesFromList
  }

  const items = Array.from(e.dataTransfer.items ?? [])
  const filesFromItems = items
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .map((file) => ({
      filePath: (file as File & { path?: string }).path,
      fileName: file.name
    }))
    .filter((file): file is { filePath: string; fileName: string } => Boolean(file.filePath))

  return filesFromItems
}
