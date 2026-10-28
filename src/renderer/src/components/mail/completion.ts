import type { MessageDetail } from '../../../../main/mailclient/core/types'

/** S1: what an attachment of a message stored without its large parts says about itself */
export const NOT_LOADED_NOTE = 'wird beim Öffnen geladen'

/**
 * S1: runs `action` with the whole message. A message stored as its skeleton is downloaded
 * first (`complete`), with `busy` on for as long as that takes; the result replaces the shown
 * message through `adopt`, so the real attachment sizes appear. A failed download (offline, gone)
 * rejects with the core's message and never runs the action.
 */
export async function withWholeMessage<T>(
  message: MessageDetail,
  deps: {
    complete: () => Promise<MessageDetail>
    busy: (on: boolean) => void
    adopt: (whole: MessageDetail) => void
  },
  action: (whole: MessageDetail) => Promise<T> | T
): Promise<T> {
  if (message.complete) return action(message)
  deps.busy(true)
  let whole: MessageDetail
  try {
    whole = await deps.complete()
  } finally {
    deps.busy(false)
  }
  deps.adopt(whole)
  return action(whole)
}
