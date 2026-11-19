import { useEffect } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'

/**
 * The tab a detail page shows, from `?tab=`. The E-Mails tab exists only once a mail account is
 * set up (#136): until the accounts have loaded, a link to it keeps it (the tab stays empty for a
 * moment instead of flashing Übersicht); after that a tab that doesn't exist is dropped from the URL.
 *
 * `aliases`: tabs that became a section of another tab (Advancing in Ablauf). A link to the old
 * tab opens the new one and scrolls to the section with the id `section-<old tab>`.
 */
export function useDetailTab<T extends string>(
  isTab: (value: unknown) => value is T,
  fallback: T,
  aliases?: Partial<Record<string, T>>
): T {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { tab?: string }
  const accounts = trpcReact.mail.accounts.list.useQuery()
  const hasMailAccount = (accounts.data?.length ?? 0) > 0
  const alias = search.tab === undefined ? undefined : aliases?.[search.tab]
  const requested = alias ?? search.tab
  const exists = isTab(requested) && (requested !== 'mails' || hasMailAccount)
  const stale = requested !== undefined && !exists && accounts.isSuccess

  useEffect(() => {
    if (stale)
      void navigate({ to: '.', search: (prev) => ({ ...prev, tab: undefined }), replace: true })
  }, [stale, navigate])

  useEffect(() => {
    if (!alias || !search.tab) return
    // after the tab has rendered
    const timer = setTimeout(
      () =>
        document
          .getElementById(`section-${search.tab}`)
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      150
    )
    return () => clearTimeout(timer)
  }, [alias, search.tab])

  if (exists) return requested
  if (isTab(requested) && accounts.isLoading) return requested
  return fallback
}
