import { toast } from 'sonner'

// Shared helpers of the document lists (own documents and related ones)

/** Shows the file in the file manager */
export async function revealDocument(filePath: string): Promise<void> {
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

/** Opens the file with its default app; falls back to showing it in its folder */
export async function openDocument(filePath: string): Promise<void> {
  try {
    const result = await window.api.openDocument(filePath)
    if (!result.success) await revealDocument(filePath)
  } catch (error) {
    toast.error('Fehler beim Öffnen des Dokuments', {
      description: error instanceof Error ? error.message : 'Unbekannter Fehler'
    })
  }
}

/** Local paths of files dropped from the file manager */
export function droppedFilePaths(e: React.DragEvent<HTMLElement>): string[] {
  const pathOf = (file: File): string => window.api.getPathForFile(file)
  const fromList = Array.from(e.dataTransfer.files ?? [])
    .map(pathOf)
    .filter((path): path is string => Boolean(path))
  if (fromList.length > 0) return fromList

  return Array.from(e.dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
    .map(pathOf)
    .filter((path): path is string => Boolean(path))
}
