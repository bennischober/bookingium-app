import { toast } from '@/lib/toast'
import { trpcReact, trpcVanilla } from '@/lib/trpc'
import { localIsoDate } from '@/lib/followUps'
import { CreateEventWizard } from '@/components/forms/CreateEventWizard'
import type { MessageDetail } from '../../../../main/mailclient/core/types'
import { eventPrefillFromMail } from './eventPrefill'
import { contactPrefillFromSender } from './senderContact'

/** The words of an HTML-only mail, for finding a date in it. An inert document: nothing loads. */
const textOfHtml = (html: string | null): string | null =>
  html ? (new DOMParser().parseFromString(html, 'text/html').body.textContent ?? null) : null

/**
 * #122: "Event anlegen" from a booking request. The wizard opens prefilled from the mail
 * (subject, the first date from today on, the sender's person, company or venue) and the
 * mail is linked to the new event, so it shows on the event's "E-Mails" tab. Like
 * "Zuordnen…", only the app's data changes, so read-only accounts offer it too.
 */
export function EventFromMail({
  accountId,
  message,
  onClose,
  onOpenEvent
}: {
  accountId: string
  message: MessageDetail
  onClose: () => void
  /** Opens the new event; the separate mail window has no app pages to open */
  onOpenEvent?: (eventId: number) => void
}) {
  const utils = trpcReact.useUtils()
  const owners = trpcReact.mailLink.senderOwners.useQuery(
    { email: message.fromEmail },
    { enabled: Boolean(message.fromEmail) }
  )
  // The wizard takes its prefill when it opens, so it waits for the sender's records
  const ready = !message.fromEmail || !owners.isLoading
  const senderOwners = owners.data ?? []
  const prefill = eventPrefillFromMail({
    subject: message.subject,
    text: message.text ?? textOfHtml(message.html),
    senderOwners,
    today: localIsoDate()
  })
  const sender = contactPrefillFromSender({ name: message.fromName, email: message.fromEmail })
  const knownSender = senderOwners.some((owner) => owner.entityType === 'person')

  // The wizard closes before it reports the new event, which unmounts this component:
  // the link goes through the vanilla client, which does not depend on it staying mounted
  const linkMail = async (event: { id: number; name: string }): Promise<void> => {
    if (!message.messageId) return
    try {
      await trpcVanilla.mailLink.link.mutate({
        accountId,
        messageId: message.messageId,
        entityType: 'event',
        entityId: event.id
      })
      void utils.mailLink.invalidate()
      toast.success('Mail dem Event zugeordnet', {
        description: event.name,
        action: onOpenEvent
          ? { label: 'Event öffnen', onClick: () => onOpenEvent(event.id) }
          : undefined
      })
    } catch (error) {
      toast.error('Mail konnte dem Event nicht zugeordnet werden', {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  return (
    <CreateEventWizard
      isOpen={ready}
      onClose={onClose}
      onSuccess={(memo) => void linkMail(memo)}
      prefill={prefill}
      newPersonPrefill={!knownSender && sender.email ? sender : undefined}
      description="Aus der E-Mail vorausgefüllt – bitte prüfen. Die Mail wird dem Event zugeordnet."
    />
  )
}
