import { useEffect } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { trpcReact } from '@/lib/trpc'

/**
 * The tab a detail page shows, from `?tab=`. The E-Mails tab exists only with the mail client on:
 * until the settings have loaded, a link to it keeps it (the tab stays empty for a moment instead
 * of flashing Übersicht); after that a tab that doesn't exist is dropped from the URL.
 */
export function useDetailTab<T extends string>(
  isTab: (value: unknown) => value is T,
  fallback: T
): T {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { tab?: string }
  const settings = trpcReact.settings.get.useQuery()
  const mailClientEnabled = settings.data?.mailClient === true
  const requested = search.tab
  const exists = isTab(requested) && (requested !== 'mails' || mailClientEnabled)
  const stale = requested !== undefined && !exists && settings.isSuccess

  useEffect(() => {
    if (stale)
      void navigate({ to: '.', search: (prev) => ({ ...prev, tab: undefined }), replace: true })
  }, [stale, navigate])

  if (exists) return requested
  if (isTab(requested) && settings.isLoading) return requested
  return fallback
}
