import { useState, useSyncExternalStore } from 'react'
import {
  closeFollowUpDialog,
  getFollowUpDialogRequest,
  subscribeFollowUpDialog,
  type FollowUpDialogRequest
} from '@/lib/followUpDialog'
import { FollowUpDialog } from './FollowUpDialog'

/** Renders the dialog for openFollowUpDialog(); mount once at the app root */
export function FollowUpDialogHost() {
  const request = useSyncExternalStore(subscribeFollowUpDialog, getFollowUpDialogRequest)

  // Keep the last request while the dialog animates out
  const [shown, setShown] = useState<FollowUpDialogRequest | null>(null)
  if (request && request !== shown) setShown(request)
  const current = request ?? shown

  return (
    <FollowUpDialog
      open={request !== null}
      onOpenChange={(open) => !open && closeFollowUpDialog()}
      record={current?.record}
      initialNote={current?.note}
    />
  )
}
