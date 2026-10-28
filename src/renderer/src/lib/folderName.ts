/**
 * B1: asks for a folder name, like lib/confirm.ts does for a confirmation.
 * Kept apart from the component so fast refresh stays happy.
 */
export type FolderNameRequest = {
  title: string
  initial?: string
  resolve: (name: string | null) => void
}

let pending: FolderNameRequest | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function askFolderName(request: {
  title: string
  initial?: string
}): Promise<string | null> {
  // A newer request replaces an open one, which counts as cancelled
  pending?.resolve(null)
  return new Promise((resolve) => {
    pending = { ...request, resolve }
    emit()
  })
}

export function subscribeFolderName(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getPendingFolderName(): FolderNameRequest | null {
  return pending
}

export function settleFolderName(name: string | null): void {
  const current = pending
  pending = null
  emit()
  current?.resolve(name)
}
