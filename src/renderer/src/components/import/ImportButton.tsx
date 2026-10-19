import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImportDialog } from './ImportDialog'
import type { ImportTarget } from '../../../../main/api/schemas/import.schema'

/** "Importieren" on a list page: the import dialog with that list's type */
export function ImportButton({ target }: { target: ImportTarget }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="outline"
        aria-label="Importieren"
        title="Excel-Liste importieren"
        onClick={() => setOpen(true)}
      >
        <Upload className="h-4 w-4" />
        {/* Icon only in narrow windows; the name stays for screen readers */}
        <span className="hidden lg:inline">Importieren</span>
      </Button>
      <ImportDialog open={open} onOpenChange={setOpen} target={target} />
    </>
  )
}
