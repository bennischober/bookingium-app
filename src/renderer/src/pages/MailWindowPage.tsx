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
  forwardCompose,
  fromSavedDraft,
  replyCompose
} from '@/components/mail/composeDraft'
import { MessageView } from '@/components/mail/MessageView'
import { flattenFolders, isDrafts, isTrash, messageKey } from '@/components/mail/format'
import type { MessageDetail } from '../../../main/mailclient/core/types'

const failed = (title: string) => (error: unknown) =>
  toast.error(title, { description: error instanceof Error ? error.message : undefined })

/**
 * A mail in its own window (double-click in the list). Answering, forwarding and
 * editing a draft happen in this window; the main window's lists follow through the
 * core's op events.
 */
export default function MailWindowPage() {
  const search = useSearch({ strict: false }) as { account?: string; message?: string | number }
  const accountId = search.account ?? ''
  const messageId = Number(search.message)
  const queryClient = useQueryClient()

  const accounts = trpcReact.mail.accounts.list.useQuery()
  const account = accounts.data?.find((a) => a.id === accountId)
  const canWrite = account?.kind === 'sandbox'

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
      if (event.accountId !== accountId || event.type !== 'op-event') return
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
      state:
        kind === 'forward'
          ? forwardCompose(message)
          : replyCompose(message, { all: kind === 'replyAll', ownEmail: account?.email ?? '' })
    })

  if (!accountId || !Number.isSafeInteger(messageId)) {
    return <p className="p-6 text-sm text-destructive">Diese E-Mail gibt es nicht.</p>
  }
  if (accounts.isLoading || (isSavedDraft && !compose)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 flex-col">
      {compose ? (
        <ComposeView
          key={compose.key}
          accountId={accountId}
          initial={compose.state}
          onClose={() => (compose.closesWindow ? window.close() : setCompose(null))}
          onStored={() => undefined}
        />
      ) : (
        <MessageView
          accountId={accountId}
          messageId={messageId}
          canWrite={canWrite}
          inTrash={isTrash(folder)}
          onToggleFlag={toggleFlag}
          onDelete={(id) => moveAway(id, 'delete')}
          onArchive={
            allFolders.some((f) => f.specialUse?.includes('Archive'))
              ? (id) => moveAway(id, 'archive')
              : undefined
          }
          onCompose={composeFrom}
        />
      )}
    </div>
  )
}
