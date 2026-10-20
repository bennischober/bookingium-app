// Opens the follow-up dialog from anywhere, e.g. from a toast's action after
// the page or sheet that showed it has closed:
//   openFollowUpDialog({ record, note: 'Entwurf vervollständigen' })
// Rendered by <FollowUpDialogHost />, mounted once at the app root.
import type { FollowUpRecord } from '../../../main/api/schemas/followUp.schema'

export type FollowUpDialogRequest = {
  record: FollowUpRecord & { name: string }
  /** Prefilled note, editable before saving */
  note?: string
}

let request: FollowUpDialogRequest | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function openFollowUpDialog(next: FollowUpDialogRequest): void {
  request = next
  emit()
}

export function closeFollowUpDialog(): void {
  request = null
  emit()
}

export function subscribeFollowUpDialog(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getFollowUpDialogRequest(): FollowUpDialogRequest | null {
  return request
}
