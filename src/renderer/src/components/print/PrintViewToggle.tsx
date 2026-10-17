import { FileText, Files } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { PrintView } from './PagedDocument'

/** Switches the print pages between the A4 page view and the plain document */
export function PrintViewToggle({
  value,
  onChange
}: {
  value: PrintView
  onChange: (view: PrintView) => void
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next as PrintView)
      }}
    >
      <ToggleGroupItem value="pages" aria-label="Seitenansicht (DIN A4)">
        <Files className="h-4 w-4" /> Seiten (A4)
      </ToggleGroupItem>
      <ToggleGroupItem value="document" aria-label="Dokumentansicht">
        <FileText className="h-4 w-4" /> Dokument
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
