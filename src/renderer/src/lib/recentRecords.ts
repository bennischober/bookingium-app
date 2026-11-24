import { t } from '../../../main/i18n/translate'
// Records opened lately (event, band, person, ...), newest first, for "Zuletzt geöffnet" in
// the search palette. Detail pages add themselves when they show a record and drop
// themselves when the record is gone. Kept in localStorage, so they survive a restart.

export type RecentRecordKind =
  | 'event'
  | 'band'
  | 'company'
  | 'person'
  | 'venue'
  | 'invoice'
  | 'release'

export type RecentRecord = {
  /** The detail page's path, e.g. "/band/3" (no ?tab=) */
  href: string
  label: string
  kind: RecentRecordKind
}

export const RECENT_RECORD_KIND_LABELS: Record<RecentRecordKind, string> = {
  event: t('Event'),
  band: t('Band'),
  company: t('Firma'),
  person: t('Person'),
  venue: t('Club / Festival'),
  invoice: t('Rechnung'),
  release: t('Release')
}

const STORAGE_KEY = 'bookingium-recent-records'
export const RECENT_RECORDS_LIMIT = 6

const listeners = new Set<() => void>()
let cache: RecentRecord[] | null = null

function isRecentRecord(value: unknown): value is RecentRecord {
  const entry = value as RecentRecord
  return (
    typeof entry?.href === 'string' &&
    entry.href.startsWith('/') &&
    typeof entry.label === 'string' &&
    entry.kind in RECENT_RECORD_KIND_LABELS
  )
}

export function getRecentRecords(): RecentRecord[] {
  if (cache) return cache
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    cache = Array.isArray(parsed)
      ? parsed.filter(isRecentRecord).slice(0, RECENT_RECORDS_LIMIT)
      : []
  } catch {
    cache = []
  }
  return cache
}

function store(next: RecentRecord[]) {
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Kept in memory for this run
  }
  for (const listener of listeners) listener()
}

/** Puts the record first; a renamed record keeps one entry under its new name */
export function rememberRecord(record: RecentRecord): void {
  const current = getRecentRecords()
  const [first] = current
  if (first && first.href === record.href && first.label === record.label) return
  store(
    [record, ...current.filter((entry) => entry.href !== record.href)].slice(
      0,
      RECENT_RECORDS_LIMIT
    )
  )
}

/** A deleted record leaves the list once its page finds it missing */
export function forgetRecord(href: string): void {
  const current = getRecentRecords()
  if (current.some((entry) => entry.href === href)) {
    store(current.filter((entry) => entry.href !== href))
  }
}

export function subscribeRecentRecords(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
