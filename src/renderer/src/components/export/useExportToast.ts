import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { t } from '../../../../main/i18n/translate'

/** Toast after an export, with "Öffnen" for the written file */
export function useExportToast() {
  const openExport = trpcReact.dataExport.openExport.useMutation({
    onError: (error) =>
      toast.error(t('Datei konnte nicht geöffnet werden'), { description: error.message })
  })
  return (result: { canceled: boolean; filePath: string | null; rows: number }) => {
    if (result.canceled || !result.filePath) return
    const filePath = result.filePath
    toast.success(`${result.rows} ${result.rows === 1 ? t('Zeile') : t('Zeilen')} exportiert`, {
      description: filePath,
      action: { label: t('Öffnen'), onClick: () => openExport.mutate(filePath) }
    })
  }
}
