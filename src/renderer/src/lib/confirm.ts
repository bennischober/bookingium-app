// Promise-based confirmation dialog, replacing window.confirm():
//   if (await confirmAction({ title: 'Löschen?', destructive: true })) { ... }
// Rendered by <ConfirmDialogHost />, mounted once at the app root.

export type ConfirmOptions = {
  title: string
  description?: string
  /** Label of the confirming button (default "Bestätigen") */
  confirmLabel?: string
  /** Red confirm button for irreversible actions (delete, Storno) */
  destructive?: boolean
}

type PendingConfirm = ConfirmOptions & { resolve: (confirmed: boolean) => void }

let pending: PendingConfirm | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  // A newer request replaces an open one, which counts as cancelled
  pending?.resolve(false)
  return new Promise((resolve) => {
    pending = { ...options, resolve }
    emit()
  })
}

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPendingConfirm(): PendingConfirm | null {
  return pending
}

export function settleConfirm(confirmed: boolean): void {
  const current = pending
  pending = null
  emit()
  current?.resolve(confirmed)
}
