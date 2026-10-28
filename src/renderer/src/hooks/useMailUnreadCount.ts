import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { trpcReact } from '@/lib/trpc'
import { mailApi } from '@/lib/mailApi'
import { refreshBatcher } from '@/components/mail/mailRefresh'
import { UNREAD_BADGE_KEY, inboxUnreadTotal, unreadBadgePlan } from '@/components/mail/unreadBadge'
import { useMailClientEnabled } from './useMailClientEnabled'

/**
 * Unread mails in the INBOX of every account, for the menu badge; 0 while the mail client is off
 * or has no account. Refreshed by the mail client's events, batched like the mail page's lists.
 */
export function useMailUnreadCount(): number {
  const queryClient = useQueryClient()
  const mailEnabled = useMailClientEnabled()
  const accounts = trpcReact.mail.accounts.list.useQuery(undefined, { enabled: mailEnabled })
  // Without an account the worker does not start, and a call would only fail
  const enabled = mailEnabled && (accounts.data?.length ?? 0) > 0
  const accountIds = (accounts.data ?? []).map((a) => a.id)

  const counts = useQuery({
    queryKey: [...UNREAD_BADGE_KEY, accountIds],
    queryFn: () => mailApi.getInboxUnread(),
    enabled,
    retry: false
  })

  const [refresher] = useState(() =>
    refreshBatcher((key) => void queryClient.invalidateQueries({ queryKey: [...key] }))
  )
  useEffect(() => () => refresher.dispose(), [refresher])
  trpcReact.mail.events.useSubscription(undefined, {
    enabled,
    onData: (event) => {
      const plan = unreadBadgePlan(event)
      if (plan) refresher.add(plan)
    }
  })

  return enabled ? inboxUnreadTotal(counts.data) : 0
}
