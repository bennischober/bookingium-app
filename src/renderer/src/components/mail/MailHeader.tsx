import { Lock, SquarePen } from 'lucide-react'
import { mailApi } from '@/lib/mailApi'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { useMailOps } from '@/hooks/useMailOps'
import type { useMailSyncStatus } from '@/hooks/useMailSyncStatus'
import type { AccountUnread } from './unreadBadge'
import { OpJournalPanel } from './OpJournalPanel'
import { SyncIndicator } from './SyncIndicator'
import { UnreadCount } from './UnreadCount'
import { accountName } from './format'
import type { MailAccountDto } from '../../../../main/mailclient/accounts'

/**
 * The mail page's top bar: the account (a picker with several), the read-only note, "Neue E-Mail",
 * the open ops and the sync state
 */
export function MailHeader({
  accounts,
  account,
  accountId,
  folderId,
  inboxUnread,
  canWrite,
  switchAccount,
  startNewMail,
  ops,
  sync,
  failed
}: {
  accounts: MailAccountDto[] | undefined
  account: MailAccountDto
  accountId: string
  /** #156: the open folder, synced first by "Synchronisieren" */
  folderId: string | null
  inboxUnread: AccountUnread[]
  canWrite: boolean
  switchAccount: (id: string) => void
  startNewMail: () => void
  ops: ReturnType<typeof useMailOps>
  sync: ReturnType<typeof useMailSyncStatus>
  failed: (title: string) => (error: unknown) => void
}) {
  const { runningOp, opList, opNow, busyOpId, runOpAction } = ops
  const { syncStatus, folderNameOf, retryFolder } = sync
  return (
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-2">
      <h1 className="text-lg font-semibold">E-Mail</h1>
      {(accounts?.length ?? 0) > 1 ? (
        <Select value={account.id} onValueChange={(id) => switchAccount(id as string)}>
          {/* #95: wide windows show every account in the folder pane; narrow ones have no
                pane, so they keep the picker */}
          <SelectTrigger className="w-64 lg:hidden" aria-label="Postfach">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {accounts?.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {accountName(a, accounts ?? [])}
                <UnreadCount unread={inboxUnread.find((entry) => entry.id === a.id)?.unread} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="text-sm text-muted-foreground">
          {account.email}
          <UnreadCount unread={inboxUnread[0]?.unread} />
        </span>
      )}
      {!canWrite && (
        <span
          className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
          role="note"
          title={
            account?.writeRefusal ??
            'Nichts wird am Server geändert: kein Lesen-Markieren, Löschen oder Verschieben.'
          }
        >
          <Lock className="size-3" />
          Nur lesen
        </span>
      )}
      {canWrite && (
        <Button size="sm" onClick={startNewMail}>
          <SquarePen />
          Neue E-Mail
        </Button>
      )}
      <div className="ml-auto flex items-center gap-3">
        {canWrite && (
          <OpJournalPanel
            entries={opList}
            now={opNow}
            busyId={busyOpId}
            onAction={(entry, action) => void runOpAction(entry, action)}
          />
        )}
        <SyncIndicator
          status={syncStatus.data}
          runningOp={runningOp}
          onPause={() => void mailApi.pauseSync(accountId).then(() => syncStatus.refetch())}
          onResume={() => void mailApi.resumeSync(accountId).then(() => syncStatus.refetch())}
          onSync={() =>
            // #156: the open folder goes first in the change pass
            void mailApi
              .triggerSync(false, accountId, folderId)
              .then(() => syncStatus.refetch())
              .catch(failed('Synchronisierung fehlgeschlagen'))
          }
          onSyncAll={() =>
            void mailApi
              .triggerSync(true, accountId)
              .then(() => syncStatus.refetch())
              .catch(failed('Synchronisierung fehlgeschlagen'))
          }
          folderName={folderNameOf}
          onRetryFolder={retryFolder}
          onDismissErrors={(keys) =>
            void mailApi
              .dismissSyncErrors(keys, accountId)
              .then(() => syncStatus.refetch())
              .catch(failed('Ausblenden fehlgeschlagen'))
          }
        />
      </div>
    </header>
  )
}
