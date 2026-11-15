import { useEffect, useSyncExternalStore } from 'react'
import { useMatch } from '@tanstack/react-router'
import {
  forgetRecord,
  getRecentRecords,
  rememberRecord,
  subscribeRecentRecords,
  type RecentRecord,
  type RecentRecordKind
} from '@/lib/recentRecords'

/** The records opened lately, newest first (see lib/recentRecords.ts) */
export function useRecentRecords(): RecentRecord[] {
  return useSyncExternalStore(subscribeRecentRecords, getRecentRecords)
}

/**
 * A detail page's part in "Zuletzt geöffnet": `shown` once the record is there, `missing`
 * when its page says "nicht gefunden". The entry is the path of the page's own route match,
 * without ?tab=: the location already shows the next page while this one is still on screen.
 */
export function useRecentRecordVisit(
  shown: { kind: RecentRecordKind; label: string } | null,
  missing = false
): void {
  const href = useMatch({ strict: false, shouldThrow: false, select: (match) => match.pathname })
  const kind = shown?.kind
  const label = shown?.label
  useEffect(() => {
    if (href && kind && label) rememberRecord({ href, kind, label })
  }, [href, kind, label])
  useEffect(() => {
    if (href && missing) forgetRecord(href)
  }, [href, missing])
}
