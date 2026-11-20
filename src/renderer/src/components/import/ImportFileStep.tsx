import type { ReactNode } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropOverlay } from '@/components/ui/drop-overlay'
import { useFileDrop } from '@/hooks/useFileDrop'
import { t } from '../../../../main/i18n/translate'

/** The files every list import reads (import:pickFile) */
export const LIST_IMPORT_EXTENSIONS = ['xlsx', 'csv', 'txt'] as const

interface ImportFileStepProps {
  picking: boolean
  /** Opens the picker, or reads the dropped file when a path is given */
  onPick: (droppedPath?: string) => Promise<void>
  /** What the list should contain; the contact list's text when missing */
  description?: ReactNode
}

/** Step 1: explains the expected list and opens the file picker; a file can be dropped too */
export function ImportFileStep({ picking, onPick, description }: ImportFileStepProps) {
  const { dragging, dropProps } = useFileDrop({
    extensions: LIST_IMPORT_EXTENSIONS,
    single: true,
    disabled: picking,
    onFiles: ([path]) => onPick(path)
  })
  return (
    <div
      className="relative flex flex-1 flex-col items-center justify-center gap-4 rounded-lg text-center"
      {...dropProps}
    >
      <DropOverlay
        show={dragging}
        title={t('Liste hier ablegen')}
        hint={t('Excel (.xlsx) oder CSV')}
      />
      <FileSpreadsheet className="h-12 w-12 text-muted-foreground" />
      <p className="max-w-md text-sm text-muted-foreground">
        {description ??
          t(
            'Eine Zeile pro Eintrag, mit Spaltenüberschriften wie Name, Firma, Ansprechpartner, E-Mail, Telefon und Anschrift. Im nächsten Schritt wählen Sie, was die Liste enthält, und prüfen die Zuordnung der Spalten. Excel-Dateien (.xlsx, erstes Blatt) und CSV gehen direkt.'
          )}
      </p>
      <Button onClick={() => void onPick()} disabled={picking}>
        {picking ? t('Datei wird gelesen…') : t('Datei auswählen…')}
      </Button>
      <p className="text-xs text-muted-foreground">{t('oder die Datei hierher ziehen')}</p>
    </div>
  )
}
