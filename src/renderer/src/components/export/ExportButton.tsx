import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { useExportToast } from './useExportToast'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import type { ExportList } from '../../../../main/api/schemas/export.schema'
import type { VenueKind } from '../../../../main/api/schemas/venue.schema'

/** "Exportieren" on a list page: the whole list as shown (search, filter, order) */
export function ExportButton({
  list,
  search,
  kind,
  sort
}: {
  list: ExportList
  search?: string
  kind?: VenueKind
  /** The grid's sort order, so the file has the same order */
  sort?: { sortBy?: string; sortDir?: 'asc' | 'desc' }
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
      onClick={() => exportList.mutate({ list, search: search || undefined, kind, ...sort })}
      disabled={exportList.isPending}
      title={
        search || kind
          ? 'Gefilterte Liste als Excel-Datei speichern'
          : 'Liste als Excel-Datei speichern'
      }
    >
      <Download className="h-4 w-4" />
      {/* Icon only in narrow windows; the name stays for screen readers */}
      <span className="hidden lg:inline">Exportieren</span>
    </Button>
  )
}
