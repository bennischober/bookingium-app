import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { mailApi } from '@/lib/mailApi'
import { Spinner } from '@/components/ui/spinner'
import { ComposeView } from '@/components/mail/ComposeView'
import {
  type ComposeState,
  emptyCompose,
  forwardCompose,
  parseAddress,
  fromSavedDraft,
  replyCompose,
  withSignature,
  composeTo
} from '@/components/mail/composeDraft'
import { MessageView } from '@/components/mail/MessageView'
import { flattenFolders, isDrafts, isTrash, messageKey } from '@/components/mail/format'
import { readingActions } from '@/components/mail/readingActions'
import type { MessageDetail } from '../../../main/mailclient/core/types'

const failed = (title: string) => (error: unknown) =>
  toast.error(title, { description: error instanceof Error ? error.message : undefined })

/**
 * A mail in its own window (double-click in the list). Answering, forwarding and
 * editing a draft happen in this window; the main window's lists follow through the
 * core's op events.
 */
export default function MailWindowPage() {
  const search = useSearch({ strict: false }) as {
    account?: string
    message?: string | number
    mode?: string
    key?: string
    draft?: string
    pdfPath?: string
  }
  const accountId = search.account ?? ''
  const messageId = Number(search.message)

  // C1: the window opened as bookingum's own editor for a prepared draft. The draft
  // and the PDF travel in the query; a successful send is reported back to main, so
  // the invoice is marked as emailed only then.
  const composeRequest = useMemo(() => {
    if (search.mode !== 'compose') return null
    try {
      // base64 in the URL, decoded here: a raw JSON in the fragment loses characters
      const decoded = atob(search.draft ?? '')
      const draft = JSON.parse(decoded || '{}') as {
        to?: string
        subject?: string
        body?: string
      }
      return {
        key: search.key ?? '',
        pdfPath: search.pdfPath ?? '',
        to: draft.to ?? '',
        subject: draft.subject ?? '',
        body: draft.body ?? ''
      }
    } catch {
      return null
    }
  }, [search.mode, search.key, search.draft, search.pdfPath])
  const queryClient = useQueryClient()

  const accounts = trpcReact.mail.accounts.list.useQuery()
  const account = accounts.data?.find((a) => a.id === accountId)
  // MR-35: the same rule as the mail page - no write action on a read-only account
  const reading = readingActions(account)
  const canWrite = reading.canWrite

  const folders = useQuery({
    queryKey: ['mail', accountId, 'folders'],
    queryFn: () => mailApi.getFolders(accountId),
    enabled: Boolean(accountId)
  })
  const allFolders = useMemo(() => flattenFolders(folders.data ?? []), [folders.data])
  const detail = useQuery({
    queryKey: messageKey(accountId, messageId),
    queryFn: () => mailApi.getMessage(messageId, accountId),
    enabled: Boolean(accountId) && Number.isSafeInteger(messageId)
  })
  const folder = allFolders.find((f) => f.id === detail.data?.folderId)

  // The editor in place of the mail; `closesWindow` when the window was opened for a draft
  const [compose, setCompose] = useState<{
    key: number
    state: ComposeState
    closesWindow?: boolean
  } | null>(null)

  useEffect(() => {
    document.title = detail.data?.subject || 'E-Mail'
  }, [detail.data?.subject])

  // C1: the prepared draft opens straight in the editor. The state is derived, not set
  // from an effect: the editor mounts with it on the first render that has a request.
  const composeInitial = useMemo<ComposeState | null>(
    () =>
      composeRequest
        ? {
            ...emptyCompose(),
            to: composeRequest.to ? [parseAddress(composeRequest.to)] : [],
            subject: composeRequest.subject,
            bodyText: composeRequest.body
          }
        : null,
    [composeRequest]
  )
  // A draft from Drafts opens straight in the editor
  const isSavedDraft = canWrite && Boolean(detail.data?.isDraft) && isDrafts(folder)
  useEffect(() => {
    if (!isSavedDraft) return
    let current = true
    mailApi
      .getDraft(messageId, accountId)
      .then((draft) => {
        if (current)
          setCompose({ key: Date.now(), state: fromSavedDraft(draft), closesWindow: true })
      })
      .catch(failed('Entwurf konnte nicht geöffnet werden'))
    return () => {
      current = false
    }
  }, [isSavedDraft, messageId, accountId])

  // Changes made in the main window (flag, move) show here too
  trpcReact.mail.events.useSubscription(undefined, {
    enabled: Boolean(accountId),
    onData: (event) => {
      // I16 item 18: this used to filter to op-events, so an isDraft or folder change arriving as a
      // sync event left the window showing the old derivation until a refetch. image-progress is
      // MessageView's own business and fires once per remote image: refetching the mail for each
      // would re-parse and re-sanitize it while its images load.
      if (event.accountId !== accountId || event.type === 'image-progress') return
      void queryClient.invalidateQueries({ queryKey: ['mail', accountId, 'folders'] })
      void queryClient.invalidateQueries({ queryKey: messageKey(accountId, messageId) })
    }
  })

  const toggleFlag = (id: number, flagged: boolean) => {
    mailApi
      .markFlagged([id], flagged, accountId)
      .then(() => queryClient.invalidateQueries({ queryKey: messageKey(accountId, id) }))
      .catch(failed('Markierung fehlgeschlagen'))
  }

  // The mail leaves its folder, so its window closes
  const moveAway = (id: number, kind: 'delete' | 'archive') => {
    const move = kind === 'delete' ? mailApi.deleteToTrash : mailApi.archive
    move([id], accountId).then(
      () => window.close(),
      failed(kind === 'delete' ? 'Löschen fehlgeschlagen' : 'Archivieren fehlgeschlagen')
    )
  }

  const composeFrom = (message: MessageDetail, kind: 'reply' | 'replyAll' | 'forward') =>
    setCompose({
      key: Date.now(),
      // B8: a reply and a forward carry the signature too, above the quote
      state: withSignature(
        kind === 'forward'
          ? forwardCompose(message)
          : replyCompose(message, { all: kind === 'replyAll', ownEmail: account?.email ?? '' }),
        account?.signature
      )
    })

  if (!composeRequest && (!accountId || !Number.isSafeInteger(messageId))) {
    return <p className="p-6 text-sm text-destructive">Diese E-Mail gibt es nicht.</p>
  }
  // C1: a compose window needs no message, so it never waits for one
  if (accounts.isLoading || (isSavedDraft && !compose)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }
  // I16 item 17: a compose request for an account that may not send says so - without this it fell
  // through to MessageView with no message id and showed nothing
  if (composeRequest && !canWrite) {
    return (
      <p className="p-6 text-sm text-destructive">Mit diesem Konto kann nicht gesendet werden.</p>
    )
  }

  return (
    <div className="flex h-screen min-h-0 flex-col">
      {composeRequest && composeInitial && canWrite ? (
        <ComposeView
          key={`compose-${composeRequest.key}`}
          accountId={accountId}
          initial={composeInitial}
          onClose={() => window.close()}
          onStored={() => undefined}
          presetPdfPath={composeRequest.pdfPath}
          onSent={(messageId) => void window.api.reportComposeSent(composeRequest.key, messageId)}
        />
      ) : compose ? (
        <ComposeView
          key={compose.key}
          accountId={accountId}
          initial={compose.state}
          onClose={() => (compose.closesWindow ? window.close() : setCompose(null))}
          onStored={() => undefined}
          onSent={
            composeRequest
              ? (messageId) => void window.api.reportComposeSent(composeRequest.key, messageId)
              : undefined
          }
        />
      ) : (
        <MessageView
          accountId={accountId}
          messageId={messageId}
          canWrite={canWrite}
          inTrash={isTrash(folder)}
          onToggleFlag={toggleFlag}
          // F8: the same actions as the reading pane in the main window
          onMarkUnread={(id) =>
            void mailApi
              .markRead([id], false, accountId)
              .catch(failed('Konnte nicht als ungelesen markiert werden'))
          }
          onDelete={(id) => moveAway(id, 'delete')}
          onArchive={
            allFolders.some((f) => f.specialUse?.includes('Archive'))
              ? (id) => moveAway(id, 'archive')
              : undefined
          }
          onCompose={reading.canCompose ? composeFrom : undefined}
          onWriteTo={
            reading.canWriteTo
              ? (address) =>
                  setCompose({ key: Date.now(), state: composeTo(address, account?.signature) })
              : undefined
          }
        />
      )}
    </div>
  )
}
