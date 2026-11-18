import { FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ImportFileStepProps {
  picking: boolean
  onPick: () => Promise<void>
}

/** Step 1: explains the expected list and opens the file picker */
export function ImportFileStep({ picking, onPick }: ImportFileStepProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
      <p className="max-w-md text-sm text-muted-foreground">
        Eine Zeile pro Eintrag, mit Spaltenüberschriften wie Name, Firma, Ansprechpartner, E-Mail,
        Telefon und Anschrift. Im nächsten Schritt wählen Sie, was die Liste enthält, und prüfen die
        Zuordnung der Spalten. Excel-Dateien (.xlsx, erstes Blatt) und CSV gehen direkt.
      </p>
      <Button onClick={() => void onPick()} disabled={picking}>
        {picking ? 'Datei wird gelesen…' : 'Datei auswählen…'}
      </Button>
    </div>
  )
}
