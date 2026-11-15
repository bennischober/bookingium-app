import { type ReactNode, useState } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'
import type { AccountUnread } from './unreadBadge'
import { FolderTree } from './FolderTree'
import { UnreadCount } from './UnreadCount'
import { accountName } from './format'
import type { MailAccountDto } from '../../../../main/mailclient/accounts'
import type { FolderNode } from '../../../../main/mailclient/core/types'

/** The mail page's folder pane (wide windows only): the shown account's tree, or one section per account */
export function FolderPane({
  folderWidth,
  accounts,
  accountId,
  otherAccounts,
  otherFolders,
  inboxUnread,
  shownTree,
  switchAccount
}: {
  folderWidth: number
  accounts: MailAccountDto[] | undefined
  accountId: string
  otherAccounts: MailAccountDto[]
  /** In the order of `otherAccounts` */
  otherFolders: UseQueryResult<FolderNode[]>[]
  inboxUnread: AccountUnread[]
  /** The shown account's tree, the one that can be dragged onto and edited */
  shownTree: ReactNode
  switchAccount: (id: string, folderId: string) => void
}) {
  // The account sections the user folded away
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const toggleSection = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return (
    <nav
      className="hidden shrink-0 overflow-auto p-2 lg:block"
      style={{ width: folderWidth }}
      aria-label="Ordnerliste"
    >
      {otherAccounts.length === 0
        ? shownTree
        : // #95: one section per account, one under the other, as mail programs do. Only the
          // shown account's tree can be dragged onto or edited; a folder of another account
          // switches to it.
          accounts?.map((a) => {
            const open = !collapsed.has(a.id)
            const name = accountName(a, accounts ?? [])
            const other = otherFolders[otherAccounts.findIndex((o) => o.id === a.id)]
            return (
              <section key={a.id} className="mb-2" aria-label={name}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleSection(a.id)}
                  className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-left text-sm font-medium hover:bg-muted"
                >
                  <ChevronRight
                    className={cn('size-4 shrink-0 transition-transform', open && 'rotate-90')}
                  />
                  <span className="truncate" title={name}>
                    {name}
                  </span>
                  {/* Open, the INBOX row shows the same count */}
                  {!open && (
                    <UnreadCount unread={inboxUnread.find((entry) => entry.id === a.id)?.unread} />
                  )}
                </button>
                {open &&
                  (a.id === accountId ? (
                    shownTree
                  ) : other?.isLoading ? (
                    <Spinner className="m-2" />
                  ) : (
                    <FolderTree
                      label={name}
                      folders={other?.data ?? []}
                      selectedId={null}
                      onSelect={(folderId) => switchAccount(a.id, folderId)}
                    />
                  ))}
              </section>
            )
          })}
    </nav>
  )
}
