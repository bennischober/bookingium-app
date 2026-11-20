import { useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import { t } from '../../../main/i18n/translate'

// Dropping files from the file manager onto an area, the same everywhere a file can be picked:
// the area shows an overlay while files are dragged over it, and a drop hands over the local
// paths, so the caller runs the same code as after its "Datei auswählen…" dialog.

export interface FileDropOptions {
  /**
   * Called with the local paths of the dropped files that passed the filter, and the files
   * themselves (for callers that read them in the renderer, like mail attachments); nothing is
   * called for none
   */
  onFiles: (paths: string[], files: File[]) => void | Promise<void>
  /** Allowed extensions without the dot ("xlsx", "pdf"); empty or missing = every file */
  extensions?: readonly string[]
  /** Only the first file is taken; a hint says so when more were dropped */
  single?: boolean
  /** Ignores drags, e.g. while a file is being read */
  disabled?: boolean
}

export interface FileDrop {
  dragging: boolean
  /** Spread onto the drop area */
  dropProps: {
    onDragEnter: (e: React.DragEvent<HTMLElement>) => void
    onDragOver: (e: React.DragEvent<HTMLElement>) => void
    onDragLeave: (e: React.DragEvent<HTMLElement>) => void
    onDrop: (e: React.DragEvent<HTMLElement>) => void
  }
}

/** "rider.PDF" -> "pdf" */
export function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * Splits dropped items (files, or paths for tests) into the ones the area takes and the rejected
 * ones, by the extension of `nameOf(item)`. Pure, so the rules (filter, single file) are tested
 * without a DOM.
 */
export function filterDropped<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
  extensions: readonly string[] | undefined,
  single = false
): { accepted: T[]; rejected: T[]; extra: number } {
  const allowed = new Set((extensions ?? []).map((ext) => ext.toLowerCase().replace(/^\./, '')))
  const accepted: T[] = []
  const rejected: T[] = []
  for (const item of items) {
    if (allowed.size === 0 || allowed.has(extensionOf(nameOf(item)))) accepted.push(item)
    else rejected.push(item)
  }
  if (single && accepted.length > 1) {
    return { accepted: accepted.slice(0, 1), rejected, extra: accepted.length - 1 }
  }
  return { accepted, rejected, extra: 0 }
}

/** The files dropped from the file manager (the list, or the items as a fallback) */
function droppedFiles(e: React.DragEvent<HTMLElement>): File[] {
  const fromList = Array.from(e.dataTransfer.files ?? [])
  if (fromList.length > 0) return fromList
  return Array.from(e.dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

const hasFiles = (e: React.DragEvent<HTMLElement>): boolean =>
  Array.from(e.dataTransfer?.types ?? []).includes('Files')

export function useFileDrop({
  onFiles,
  extensions,
  single = false,
  disabled = false
}: FileDropOptions): FileDrop {
  const [dragging, setDragging] = useState(false)
  // dragenter/dragleave fire for every child element; the depth tells when the area is left
  const depth = useRef(0)

  const reset = (): void => {
    depth.current = 0
    setDragging(false)
  }

  return {
    dragging: dragging && !disabled,
    dropProps: {
      onDragEnter: (e) => {
        if (disabled || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        depth.current++
        setDragging(true)
      },
      onDragOver: (e) => {
        if (disabled || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
      },
      onDragLeave: (e) => {
        if (disabled || !hasFiles(e)) return
        e.preventDefault()
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      },
      onDrop: (e) => {
        if (disabled || !hasFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        reset()
        const { accepted, rejected, extra } = filterDropped(
          droppedFiles(e),
          (file) => file.name,
          extensions,
          single
        )
        if (rejected.length > 0) {
          const allowed = (extensions ?? []).map((ext) => `.${ext}`).join(', ')
          toast.error(
            rejected.length === 1
              ? t('Diese Datei passt hier nicht')
              : t('{{count}} Dateien passen hier nicht', { count: rejected.length }),
            { description: t('Möglich sind: {{allowed}}', { allowed }) }
          )
        }
        if (extra > 0) {
          toast.info(t('Nur die erste Datei wird gelesen'), {
            description: t('Hier geht jeweils eine Datei.')
          })
        }
        if (accepted.length === 0) return
        const paths = accepted.map((file) => window.api.getPathForFile(file)).filter(Boolean)
        void onFiles(paths, accepted)
      }
    }
  }
}
