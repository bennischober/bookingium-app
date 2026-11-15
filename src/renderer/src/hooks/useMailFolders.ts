import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { mailApi } from '@/lib/mailApi'
import { flattenFolders } from '@/components/mail/format'
import type { MailAccountDto } from '../../../main/mailclient/accounts'

/**
 * The mail page's folders: the shown account's tree and, for the folder pane's other sections,
 * every other account's
 */
export function useMailFolders({
  accounts,
  accountId,
  ready
}: {
  accounts: MailAccountDto[] | undefined
  accountId: string
  ready: boolean
}) {
  const folders = useQuery({
    queryKey: ['mail', accountId, 'folders'],
    queryFn: () => mailApi.getFolders(accountId),
    enabled: ready
  })
  const allFolders = useMemo(() => flattenFolders(folders.data ?? []), [folders.data])
  // #95: every other account's folders, for its section in the folder pane. The keys are the
  // ones the account's own page uses, so switching to it shows them at once.
  const otherAccounts = (accounts ?? []).filter((a) => a.id !== accountId)
  const otherFolders = useQueries({
    queries: otherAccounts.map((a) => ({
      queryKey: ['mail', a.id, 'folders'],
      queryFn: () => mailApi.getFolders(a.id),
      enabled: ready
    }))
  })

  return { folders, allFolders, otherAccounts, otherFolders }
}
