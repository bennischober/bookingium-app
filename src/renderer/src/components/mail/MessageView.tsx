import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ImageOff } from 'lucide-react'
import { toast } from '@/lib/toast'
import { mailApi } from '@/lib/mailApi'
import { trpcReact, trpcVanilla } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { AttachmentToDocumentDialog } from '@/components/mail/AttachmentToDocumentDialog'
import { CreateContactSheet } from '@/components/mail/CreateContactSheet'
import { EventFromMail } from '@/components/mail/EventFromMail'
import { InvitationFromMail, type InvitationToTake } from '@/components/mail/InvitationFromMail'
import { LinkMailDialog } from '@/components/mail/LinkMailDialog'
import { EInvoiceCompanyDialog } from '@/components/company/EInvoiceCompanyDialog'
import type { EInvoicePartySource } from '../../../../main/api/schemas/einvoice_party.schema'
import { ReceiptDialog } from '@/components/receipts/ReceiptDialog'
import type { ReceiptSource } from '../../../../main/api/schemas/receipt.schema'
import type { MessageDetail } from '../../../../main/mailclient/core/types'
import { parseInvitation } from '../../../../main/calendar/invitation'
import { withWholeMessage } from './completion'
import { calendarText, invitationPart, withTitle } from './invitationPrefill'
import { formatSize, messageKey, safeFileName, saveBytes } from './format'
import { MessageActions } from './MessageActions'
import { MessageAttachments } from './MessageAttachments'
import { MessageBody } from './MessageBody'
import { MessageHeaderFields } from './MessageHeaderFields'
import { MailShowsBar } from './MailShowsBar'
import { t } from '../../../../main/i18n/translate'

/**
 * Reading pane. HTML mail is already sanitized by the core and shown in a
 * sandboxed iframe without scripts or same-origin access; its own CSP blocks
 * every remote load. Remote images are only fetched on request.
 */
export function MessageView({
  accountId,
  messageId,
  canWrite,
  inTrash,
  onToggleFlag,
  onDelete,
  onArchive,
  onSpam,
  onNotSpam,
  onMarkUnread,
  onCompose,
  onWriteTo,
  onOpenEvent
}: {
  accountId: string
  messageId: number
  canWrite: boolean
  inTrash: boolean
  onToggleFlag: (id: number, flagged: boolean) => void
  onDelete: (id: number) => void
  onArchive?: (id: number) => void
  /** #214 */
  onSpam?: (id: number) => void
  onNotSpam?: (id: number) => void
  /** Marks the open mail unread again */
  onMarkUnread?: (id: number) => void
  /** Opens the editor with a reply or forward of this mail (writable accounts only) */
  onCompose?: (message: MessageDetail, kind: 'reply' | 'replyAll' | 'forward' | 'editAsNew') => void
  /** F2: opens a NEW mail to one header address (writable accounts only) */
  onWriteTo?: (address: { name: string; email: string }) => void
  /** #122: opens an event made from this mail; the separate mail window has no app pages */
  onOpenEvent?: (eventId: number) => void
}) {
  const detail = useQuery({
    queryKey: messageKey(accountId, messageId),
    queryFn: () => mailApi.getMessage(messageId, accountId)
  })
  // The version with loaded remote images (the parent keys this view by message)
  const [withImages, setWithImages] = useState<MessageDetail | null>(null)
  const [loadingImages, setLoadingImages] = useState(false)
  // G10: how far the image load has got, so a 72-image mail is not an opaque spinner
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number } | null>(null)
  // C5: the attachment the "save as document" dialog is open for
  // F10: the dialog takes one attachment or all of them
  const [toDocument, setToDocument] = useState<{ partId: string; filename: string }[] | null>(null)
  // #222: the attachment "Firma aus E-Rechnung" reads
  const [toCompany, setToCompany] = useState<EInvoicePartySource | null>(null)
  // #225: the attachment "Als Beleg speichern" stores
  const [toReceipt, setToReceipt] = useState<ReceiptSource | null>(null)
  // "Zuordnen…" and "Kontakt anlegen": both change the app's data, never the mailbox, so
  // they work on read-only accounts too
  const [linking, setLinking] = useState(false)
  const [creatingContact, setCreatingContact] = useState(false)
  // #122: "Event anlegen" from a booking request, which also only changes the app's data
  const [creatingEvent, setCreatingEvent] = useState(false)
  // #71: an invitation in the mail taken over as an own appointment, the app's data again
  const [takingInvitation, setTakingInvitation] = useState<InvitationToTake | null>(null)
  // S1: the whole message is being downloaded (stored without its large parts until now)
  const [downloading, setDownloading] = useState(false)
  const queryClient = useQueryClient()
  // G10: the core reports progress per image; only this message's events matter.
  // This hook MUST stay above the early returns below - a hook after them is called on
  // some renders and not others, which is the Rules-of-Hooks violation that crashed the view.
  trpcReact.mail.events.useSubscription(undefined, {
    onData: (event) => {
      if (event.type !== 'image-progress') return
      if (event.accountId !== accountId || event.messageId !== messageId) return
      setImageProgress({ done: event.done, total: event.total })
    }
  })

  if (detail.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (detail.isError || !detail.data) {
    return (
      <p className="p-6 text-sm text-destructive">
        {t('Die E-Mail konnte nicht geladen werden.')}
        {detail.error instanceof Error && ` ${detail.error.message}`}
      </p>
    )
  }

  const message = withImages ?? detail.data

  const loadImages = async () => {
    setLoadingImages(true)
    setImageProgress(null)
    try {
      setWithImages(await mailApi.loadRemoteImages(message.id, message.remoteImages, accountId))
    } catch (error) {
      toast.error(t('Bilder konnten nicht geladen werden'), {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setLoadingImages(false)
      setImageProgress(null)
    }
  }

  // S1: a message stored without its large parts is downloaded once, before anything reads them.
  // The core would do it anyway; going through here shows the wait and the real sizes after it.
  const whole = <T,>(action: (whole: MessageDetail) => Promise<T> | T): Promise<T> =>
    withWholeMessage(
      message,
      {
        complete: () => mailApi.completeMessage(message.id, accountId),
        busy: setDownloading,
        adopt: (done) => {
          queryClient.setQueryData(messageKey(accountId, messageId), done)
          // loaded remote images stay; only what the download changed is taken over
          setWithImages(
            (w) => w && { ...w, complete: done.complete, attachments: done.attachments }
          )
        }
      },
      action
    )

  /** The core's message says why (offline, gone from the server) */
  const failed = (title: string) => (error: unknown) => {
    toast.error(title, { description: error instanceof Error ? error.message : undefined })
  }

  // B6: the main process writes the file; the renderer never gets a path to write to.
  // I11 (MR-23): nor does it name the file - main takes the stored name.
  const attachmentInput = (partId: string) => ({
    accountId,
    messageId: message.id,
    partId
  })

  const openAttachment = async (partId: string) => {
    try {
      // A type that may start programs is never opened; main asks whether to save it instead
      const result = await whole(() =>
        trpcVanilla.mail.attachments.open.mutate(attachmentInput(partId))
      )
      if (result.saved) toast.success(t('Anhang gespeichert'), { description: result.name })
    } catch (error) {
      toast.error(t('Anhang konnte nicht geöffnet werden'), {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  /** F10: every attachment of this mail, one after another through the same save path */
  const saveAllAttachments = () =>
    whole(async (done) => {
      for (const a of done.attachments.filter((a) => !a.isInline)) await saveFile(a.partId)
    }).catch(failed(t('Anhänge konnten nicht geladen werden')))

  const saveAttachmentAs = (partId: string) =>
    whole(() => saveFile(partId)).catch(failed(t('Anhang konnte nicht gespeichert werden')))

  const saveFile = async (partId: string) => {
    try {
      const result = await trpcVanilla.mail.attachments.saveAs.mutate(attachmentInput(partId))
      if (result.saved) toast.success(t('Anhang gespeichert'), { description: result.name })
    } catch (error) {
      toast.error(t('Anhang konnte nicht gespeichert werden'), {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  /** C5 / F10: the dialog reads the files, so they are downloaded before it opens */
  const toDocuments = (pick: (done: MessageDetail) => MessageDetail['attachments']) =>
    whole((done) =>
      setToDocument(pick(done).map((a) => ({ partId: a.partId, filename: a.filename })))
    ).catch(failed(t('Anhang konnte nicht geladen werden')))

  /** #222: main reads the attachment, so the message is downloaded before the dialog opens */
  const companyFromAttachment = (partId: string) =>
    whole(() => setToCompany({ kind: 'attachment', ...attachmentInput(partId) })).catch(
      failed(t('Anhang konnte nicht geladen werden'))
    )

  /** #225: the same for "Als Beleg speichern"; the receipt keeps the mail's Message-ID */
  const receiptFromAttachment = (partId: string) =>
    whole(() =>
      setToReceipt({
        kind: 'attachment',
        ...attachmentInput(partId),
        storeMessageId: message.messageId ?? null
      })
    ).catch(failed(t('Anhang konnte nicht geladen werden')))

  /** A forward carries the files: offline it stops here, never a forward without them */
  const forward = (compose: NonNullable<typeof onCompose>) =>
    whole((done) => compose(done, 'forward')).catch(
      failed(t('Anhänge konnten nicht geladen werden'))
    )

  /** #71: reads the invitation part and opens the appointment dialog with it */
  const takeInvitation = async (partId: string) => {
    try {
      const bytes = await whole(() => mailApi.getAttachment(message.id, partId, accountId))
      const parsed = parseInvitation(calendarText(bytes))
      if (!parsed.ok) {
        toast.error(t('Einladung kann nicht übernommen werden'), { description: parsed.error })
        return
      }
      const existing = parsed.invitation.uid
        ? await trpcVanilla.appointment.byIcalUid.query({ uid: parsed.invitation.uid })
        : null
      setTakingInvitation({ invitation: withTitle(parsed.invitation, message.subject), existing })
    } catch (error) {
      toast.error(t('Einladung konnte nicht gelesen werden'), {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }
  const invitation = invitationPart(message.attachments)

  const saveEml = async () => {
    try {
      const bytes = await whole(() => mailApi.getRawEml(message.id, accountId))
      saveBytes(
        bytes,
        `${safeFileName(message.subject, 'E-Mail').slice(0, 80)}.eml`,
        'message/rfc822'
      )
    } catch (error) {
      toast.error(t('E-Mail konnte nicht gespeichert werden'), {
        description: error instanceof Error ? error.message : undefined
      })
    }
  }

  return (
    <article className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="E-Mail">
      <header className="@container max-h-[50%] shrink-0 space-y-2 overflow-auto border-b px-4 py-3">
        {/* A narrow pane puts the actions above the subject: beside it, they squeezed the
            subject into a column a few letters wide */}
        <div className="flex flex-col-reverse gap-2 @xl:flex-row @xl:items-start">
          <h2 className="min-w-0 flex-1 text-lg font-semibold break-words">
            {message.subject || t('(Kein Betreff)')}
          </h2>
          <MessageActions
            message={message}
            canWrite={canWrite}
            inTrash={inTrash}
            downloading={downloading}
            onCompose={onCompose}
            forward={forward}
            onToggleFlag={onToggleFlag}
            onMarkUnread={onMarkUnread}
            onArchive={onArchive}
            onSpam={onSpam}
            onNotSpam={onNotSpam}
            onDelete={onDelete}
            onLink={() => setLinking(true)}
            onCreateEvent={() => setCreatingEvent(true)}
            takeInvitation={invitation ? () => takeInvitation(invitation.partId) : undefined}
            onCreateContact={() => setCreatingContact(true)}
            saveEml={saveEml}
          />
        </div>

        <MessageHeaderFields message={message} onWriteTo={onWriteTo} />

        <MailShowsBar accountId={accountId} message={message} />

        <MessageAttachments
          message={message}
          downloading={downloading}
          openAttachment={openAttachment}
          saveAttachmentAs={saveAttachmentAs}
          saveAllAttachments={saveAllAttachments}
          toDocuments={toDocuments}
          toCompany={companyFromAttachment}
          toReceipt={receiptFromAttachment}
          accountId={accountId}
        />

        {downloading && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm">
            <Spinner className="shrink-0" aria-hidden />
            <span role="status">
              {t('Nachricht wird geladen (')}
              {formatSize(message.sizeBytes)})…
            </span>
          </div>
        )}

        {message.remoteImageCount > 0 && !withImages && (
          <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-1.5 text-sm">
            <ImageOff className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">
              {message.remoteImageCount}{' '}
              {message.remoteImageCount === 1
                ? t('externes Bild wurde')
                : t('externe Bilder wurden')}{' '}
              blockiert.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadImages()}
              disabled={loadingImages}
            >
              {loadingImages
                ? imageProgress
                  ? t('Lädt… {{done}} von {{total}}', {
                      done: imageProgress.done,
                      total: imageProgress.total
                    })
                  : t('Wird geladen…')
                : t('Bilder laden')}
            </Button>
          </div>
        )}
      </header>

      <MessageBody message={message} />

      {toCompany && (
        <EInvoiceCompanyDialog
          open
          onOpenChange={(open) => {
            if (!open) setToCompany(null)
          }}
          source={toCompany}
        />
      )}
      {toReceipt && (
        <ReceiptDialog
          open
          onOpenChange={(open) => {
            if (!open) setToReceipt(null)
          }}
          source={toReceipt}
        />
      )}
      {toDocument && (
        <AttachmentToDocumentDialog
          open
          onOpenChange={(open) => {
            if (!open) setToDocument(null)
          }}
          accountId={accountId}
          messageId={message.id}
          storeMessageId={message.messageId}
          parts={toDocument}
        />
      )}
      {linking && message.messageId && (
        <LinkMailDialog
          open
          onOpenChange={setLinking}
          accountId={accountId}
          storeMessageId={message.messageId}
          subject={message.subject}
        />
      )}
      {creatingContact && (
        <CreateContactSheet
          open
          onOpenChange={setCreatingContact}
          sender={{ name: message.fromName, email: message.fromEmail }}
        />
      )}
      {creatingEvent && message.messageId && (
        <EventFromMail
          accountId={accountId}
          message={message}
          onClose={() => setCreatingEvent(false)}
          onOpenEvent={onOpenEvent}
        />
      )}
      {takingInvitation && (
        <InvitationFromMail taking={takingInvitation} onClose={() => setTakingInvitation(null)} />
      )}
    </article>
  )
}
