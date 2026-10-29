import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DocumentOwnerType } from '../../../../main/api/schemas/document.schema'
import { droppedFilePaths } from './documentFiles'
import { DocumentTable } from './DocumentTable'

/**
 * Files of one record (event, band, …): drop or pick files to copy them into
 * the record's folder (storage/documents/<type>/<id>-<name>/), set their
 * type, open, show in folder or delete them (to the OS trash).
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
  // Drag events fire on every child element; counting enter/leave keeps the
  // overlay from flickering while the pointer crosses the table
  const dragDepth = useRef(0)
  const owner = { ownerType, ownerId }

  // Files dropped outside the panel must not open in the window
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
    dragDepth.current = 0
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

  const isEmpty = !documentsQuery.isLoading && documents.length === 0

  return (
    <div
      className="relative flex flex-col gap-4"
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current++
        setIsDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setIsDragging(false)
      }}
      onDrop={onDrop}
    >
      {/* Overlay while a file is dragged anywhere over the tab panel */}
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/85">
          <div className="text-center">
            <Upload className="mx-auto mb-2 h-8 w-8 text-primary" />
            <p className="font-medium">Dateien hier ablegen</p>
            <p className="text-sm text-muted-foreground">
              Sie werden in den Dokumentenordner dieses Eintrags kopiert.
            </p>
          </div>
        </div>
      )}

      {/* Toolbar row; the large box is the empty state below */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void handleSelectFiles()} disabled={isUploading}>
            <Upload className="h-4 w-4" />
            {isUploading ? 'Wird hochgeladen…' : 'Dateien auswählen'}
          </Button>
          <Button
            variant="outline"
            onClick={() => openFolder.mutate(owner)}
            disabled={openFolder.isPending}
          >
            <FolderOpen className="h-4 w-4" /> Ordner öffnen
          </Button>
          <span className="text-sm text-muted-foreground">oder hierher ziehen</span>
        </div>
        {documents.length > 0 && (
          <span className="text-sm text-muted-foreground">
            {title} ({documents.length})
          </span>
        )}
      </div>

      {isEmpty ? (
        <div
          className={cn(
            'rounded-lg border-2 border-dashed p-8 text-center transition-colors',
            isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
          )}
        >
          <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <h3 className="mb-1 font-semibold">Noch keine Dokumente</h3>
          <p className="mb-3 text-sm text-muted-foreground">
            Dateien hier ablegen oder „Dateien auswählen“ verwenden.
          </p>
          <Button onClick={() => void handleSelectFiles()} disabled={isUploading}>
            {isUploading ? 'Wird hochgeladen…' : 'Dateien auswählen'}
          </Button>
        </div>
      ) : (
        <DocumentTable
          rows={documents.map((doc) => ({ doc, event: null }))}
          label={title}
          empty="Noch keine Dokumente."
          isLoading={documentsQuery.isLoading}
          error={documentsQuery.error}
          onRetry={() => void documentsQuery.refetch()}
          onChanged={() => void invalidate()}
        />
      )}
    </div>
  )
}
