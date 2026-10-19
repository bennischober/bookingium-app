import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import type { ExportList } from '../../../../main/api/schemas/export.schema'
import type { VenueKind } from '../../../../main/api/schemas/venue.schema'

/** Toast after an export, with "Öffnen" for the written file */
export function useExportToast() {
  const openExport = trpcReact.dataExport.openExport.useMutation({
    onError: (error) =>
      toast.error('Datei konnte nicht geöffnet werden', { description: error.message })
  })
  return (result: { canceled: boolean; filePath: string | null; rows: number }) => {
    if (result.canceled || !result.filePath) return
    const filePath = result.filePath
    toast.success(`${result.rows} ${result.rows === 1 ? 'Zeile' : 'Zeilen'} exportiert`, {
      description: filePath,
      action: { label: 'Öffnen', onClick: () => openExport.mutate(filePath) }
    })
  }
}

/** "Exportieren" on a list page: the list as shown (search/filter, all pages) */
export function ExportButton({
  list,
  search,
  kind
}: {
  list: ExportList
  search?: string
  kind?: VenueKind
}) {
  const showResult = useExportToast()
  const exportList = trpcReact.dataExport.exportList.useMutation({
    onSuccess: showResult,
    onError: (error) => toast.error('Export fehlgeschlagen', { description: error.message })
  })

  return (
    <Button
      variant="outline"
      aria-label="Exportieren"
      onClick={() => exportList.mutate({ list, search: search || undefined, kind })}
      disabled={exportList.isPending}
      title={
        search || kind
          ? 'Gefilterte Liste als Excel-Datei speichern (alle Seiten)'
          : 'Liste als Excel-Datei speichern'
      }
    >
      <Download className="h-4 w-4" />
      {/* Icon only in narrow windows; the name stays for screen readers */}
      <span className="hidden lg:inline">Exportieren</span>
    </Button>
  )
}
