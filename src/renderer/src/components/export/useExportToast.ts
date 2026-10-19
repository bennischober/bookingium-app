import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'

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
