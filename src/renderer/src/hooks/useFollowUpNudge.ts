import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { openFollowUpDialog, type FollowUpDialogRequest } from '@/lib/followUpDialog'

/**
 * A success toast that offers "Wiedervorlage setzen" for a record saved
 * unfinished (an invoice draft, a pending event). Nothing is created unless
 * the button is clicked, and the offer is left out when the record already
 * has an open follow-up.
 */
export function useFollowUpNudge() {
  const utils = trpcReact.useUtils()
  return async (message: string, request: FollowUpDialogRequest) => {
    const { type, id } = request.record
    const open = await utils.followUp.listOpenByRecord.fetch({ type, id }).catch(() => [])
    toast.success(
      message,
      open.length > 0
        ? undefined
        : {
            action: {
              label: 'Wiedervorlage setzen',
              onClick: () => openFollowUpDialog(request)
            }
          }
    )
  }
}
