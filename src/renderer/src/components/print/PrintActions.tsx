import { useEffect, useState } from 'react'
import { FileDown, Printer } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * Toolbar actions of the print pages.
 *
 * "Als PDF speichern" writes the real print output via a save dialog that is
 * prefilled with the file name. While the page is open, the window title is
 * set to the same name, which the system print dialog uses as the job /
 * document name (e.g. for "Microsoft Print to PDF").
 */
export function PrintActions({ fileName }: { fileName: string }) {
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const previousTitle = document.title
    document.title = fileName
    return () => {
      document.title = previousTitle
    }
  }, [fileName])

  const savePdf = async () => {
    setSaving(true)
    try {
      const result = await window.api.savePrintPdf(`${fileName}.pdf`)
      if (!result.success) {
        toast.error('PDF konnte nicht gespeichert werden', { description: result.error })
      } else if (!result.canceled && result.filePath) {
        const filePath = result.filePath
        toast.success('PDF gespeichert', {
          description: filePath,
          action: { label: 'Öffnen', onClick: () => void window.api.openSavedPdf(filePath) }
        })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => void savePdf()} disabled={saving}>
        <FileDown className="h-4 w-4" /> Als PDF speichern
      </Button>
      <Button onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Drucken
      </Button>
    </>
  )
}
