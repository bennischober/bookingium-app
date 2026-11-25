import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
 * Storno of an invoice written in DATEV (#246): the Storno is written in DATEV too, so its
 * Stornorechnung here takes DATEV's number and is not handed over again.
 */
export function DatevCancellationDialog({
  open,
  invoiceNumberLabel,
  pending,
  onOpenChange,
  onConfirm
}: {
  open: boolean
  invoiceNumberLabel: string
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (datevCancellationNumber: number) => void
}) {
  const [number, setNumber] = useState('')
  const typed = number.trim()
  const valid = /^\d+$/.test(typed) && Number(typed) > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setNumber('')
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('Rechnung {{invoiceNumberLabel}} stornieren?', { invoiceNumberLabel })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Diese Rechnung wurde in DATEV erstellt. Bitte stornieren Sie sie auch in DATEV und tragen Sie hier die Nummer der Stornorechnung aus DATEV ein. Die Stornorechnung wird dann nicht von hier an DATEV übergeben. Das lässt sich nicht rückgängig machen.'
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) onConfirm(Number(typed))
          }}
        >
          <Label htmlFor="datev-cancellation-number">
            {t('Nummer der Stornorechnung aus DATEV')}
          </Label>
          <Input
            id="datev-cancellation-number"
            inputMode="numeric"
            autoFocus
            value={number}
            onChange={(e) => setNumber(e.target.value)}
          />
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Abbrechen')}
            </Button>
            <Button type="submit" variant="destructive" disabled={!valid || pending}>
              {t('Stornieren')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
