import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { useCallback, useRef } from 'react'
import type { FormMode } from '@/hooks/useFormSheet'
import { confirmAction } from '@/lib/confirm'
import { UnsavedChangesContext } from './formGuard'
import { t } from '../../../main/i18n/translate'

interface FormSheetProps {
  isOpen: boolean
  onClose: () => void
  mode: FormMode
  title?: string
  description?: string
  children: React.ReactNode
}

export function FormSheet({ isOpen, onClose, mode, title, description, children }: FormSheetProps) {
  const defaultTitle = mode === 'create' ? t('Neu anlegen') : t('Bearbeiten')
  const defaultDescription =
    mode === 'create'
      ? t('Details ausfüllen, um einen neuen Eintrag anzulegen.')
      : t('Änderungen am Eintrag vornehmen.')

  // the forms in the sheet that hold unsaved changes (see formGuard.ts)
  const unsavedForms = useRef(new Set<string>())
  const reportUnsaved = useCallback((formId: string, unsaved: boolean) => {
    if (unsaved) unsavedForms.current.add(formId)
    else unsavedForms.current.delete(formId)
  }, [])

  // Esc, a click outside and the close button; saving and "Abbrechen" call onClose directly
  const handleOpenChange = async (open: boolean) => {
    if (open) return
    if (
      unsavedForms.current.size > 0 &&
      !(await confirmAction({
        title: t('Änderungen verwerfen?'),
        description: t('Was hier eingegeben wurde, ist noch nicht gespeichert und geht verloren.'),
        confirmLabel: t('Verwerfen'),
        destructive: true
      }))
    ) {
      return
    }
    onClose()
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => void handleOpenChange(open)}>
      {/* #161: no bottom padding, the sticky FormActions row closes the panel */}
      <SheetContent className="sm:max-w-xl overflow-y-auto pb-0">
        <SheetHeader>
          <SheetTitle>{title || defaultTitle}</SheetTitle>
          <SheetDescription>{description || defaultDescription}</SheetDescription>
        </SheetHeader>
        <UnsavedChangesContext.Provider value={reportUnsaved}>
          <div className="mt-6">{children}</div>
        </UnsavedChangesContext.Provider>
      </SheetContent>
    </Sheet>
  )
}
