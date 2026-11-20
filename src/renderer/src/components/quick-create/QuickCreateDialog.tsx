import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { t } from '../../../../main/i18n/translate'

/**
 * The shell of a quick-create dialog: a small form with only the essential
 * fields, opened from a combobox's "Neu anlegen" so a record can be created
 * without leaving the form that needs it.
 */
export function QuickCreateDialog({
  isOpen,
  title,
  submitLabel,
  submitDisabled,
  onSubmit,
  onClose,
  children
}: {
  isOpen: boolean
  title: string
  submitLabel: string
  submitDisabled: boolean
  /** Called on submit, with the browser's form submission already prevented */
  onSubmit: () => void
  onClose: () => void
  children: ReactNode
}) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Rendered in a portal, but React bubbles the submit to a form around the dialog
    e.stopPropagation()
    onSubmit()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t('Nur die wichtigsten Angaben – den Rest können Sie später ergänzen.')}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Abbrechen')}
            </Button>
            <Button type="submit" disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
