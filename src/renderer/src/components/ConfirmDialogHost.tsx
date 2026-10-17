import { useState, useSyncExternalStore } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  getPendingConfirm,
  settleConfirm,
  subscribeConfirm,
  type ConfirmOptions
} from '@/lib/confirm'

/** Renders the dialog for confirmAction(); mount once at the app root */
export function ConfirmDialogHost() {
  const pending = useSyncExternalStore(subscribeConfirm, getPendingConfirm)

  // Keep the last texts while the dialog animates out (state adjustment
  // during render, per "You Might Not Need an Effect")
  const [shown, setShown] = useState<ConfirmOptions | null>(null)
  if (pending && pending !== shown) setShown(pending)
  const options = pending ?? shown

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && settleConfirm(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
          {options?.description && <DialogDescription>{options.description}</DialogDescription>}
        </DialogHeader>
        {/* Cancel comes first, so it holds the initial focus */}
        <DialogFooter>
          <Button variant="outline" onClick={() => settleConfirm(false)}>
            Abbrechen
          </Button>
          <Button
            variant={options?.destructive ? 'destructive' : 'default'}
            onClick={() => settleConfirm(true)}
          >
            {options?.confirmLabel ?? 'Bestätigen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
