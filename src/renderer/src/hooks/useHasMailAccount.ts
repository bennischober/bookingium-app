import { trpcReact } from '@/lib/trpc'

/**
 * #136: whether a mail account is set up. The mail client is always part of the app, but
 * the records' E-Mails tabs only make sense once mail can arrive; false while loading.
 */
export function useHasMailAccount(): boolean {
  return (trpcReact.mail.accounts.list.useQuery().data?.length ?? 0) > 0
}
