// ========================================
// Backups: names, when one is due, which ones to keep
// ========================================
// Pure rules, no file system. `files.ts` applies them to real folders.

/** Every backup folder starts with this; the rest is the local date and time */
export const BACKUP_PREFIX = 'Bookingium-Sicherung '
/**
 * A backup while it is being written. It becomes a backup only by the final rename, so a
 * synced copy of a half-written one is never taken for a complete one.
 */
export const BACKUP_TEMP_PREFIX = '.bookingium-unfertig-'
/** Inside every backup: who wrote it and why; automatic ones are the only ones ever deleted */
export const BACKUP_MARKER = 'bookingium-sicherung.json'

export type BackupKind = 'auto' | 'manual' | 'before-restore'

export type BackupMarker = {
  app: 'bookingium'
  format: 1
  kind: BackupKind
  /** ISO timestamp */
  createdAt: string
  appVersion: string
}

/**
 * A day, minus a few hours of slack: someone who opens the app a little earlier each day
 * still gets one backup a day instead of one every other day
 */
export const BACKUP_DUE_AFTER_MS = 20 * 60 * 60 * 1000

/** Automatic backups kept in the target folder */
export const BACKUP_RETENTION = { daily: 7, weekly: 4 }
export type BackupRetention = typeof BACKUP_RETENTION

const pad = (n: number) => String(n).padStart(2, '0')

/** "Bookingium-Sicherung 2026-10-19 14-30" (local time, sorts by date) */
export function backupFolderName(date = new Date()): string {
  return `${BACKUP_PREFIX}${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )} ${pad(date.getHours())}-${pad(date.getMinutes())}`
}

const NAME_PATTERN = /^Bookingium-Sicherung (\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})(?: \((\d+)\))?$/

/** The local time a backup folder's name stands for, or null for any other name */
export function parseBackupFolderName(name: string): Date | null {
  const match = NAME_PATTERN.exec(name)
  if (!match) return null
  const [year, month, day, hours, minutes] = match.slice(1, 6).map(Number)
  const date = new Date(year, month - 1, day, hours, minutes)
  // 2026-02-31 and the like roll over; such a name was not written by us
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

/** The marker's content, or null when it is not one of ours */
export function parseBackupMarker(raw: string): BackupMarker | null {
  try {
    const value = JSON.parse(raw) as Partial<BackupMarker>
    if (value.app !== 'bookingium' || value.format !== 1) return null
    if (!['auto', 'manual', 'before-restore'].includes(value.kind as string)) return null
    if (typeof value.createdAt !== 'string' || Number.isNaN(Date.parse(value.createdAt)))
      return null
    return { ...value, appVersion: String(value.appVersion ?? '') } as BackupMarker
  } catch {
    return null
  }
}

/**
 * Whether an automatic backup is due: none succeeded yet, the last one is old enough, or it
 * lies in the future (the clock was set back)
 */
export function isBackupDue(lastSuccessAt: string | null, now: Date): boolean {
  if (!lastSuccessAt) return true
  const last = Date.parse(lastSuccessAt)
  if (Number.isNaN(last)) return true
  const age = now.getTime() - last
  return age < 0 || age >= BACKUP_DUE_AFTER_MS
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The Monday of the date's week, so weeks group like the calendar (ISO, local time) */
function weekKey(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return dayKey(monday)
}

export type BackupEntry = { name: string; date: Date }

/**
 * The automatic backups to delete: kept are the newest of each of the last `daily` days that
 * have a backup and the newest of each of the last `weekly` weeks. Days without a backup do not
 * count, so a long break never empties the folder.
 */
export function selectBackupsToDelete(
  entries: BackupEntry[],
  retention: BackupRetention = BACKUP_RETENTION
): string[] {
  const newestFirst = [...entries].sort((a, b) => b.date.getTime() - a.date.getTime())
  const keep = new Set<string>()
  const keepNewestPer = (key: (date: Date) => string, count: number) => {
    const seen = new Set<string>()
    for (const entry of newestFirst) {
      const k = key(entry.date)
      if (seen.has(k)) continue
      if (seen.size >= count) break
      seen.add(k)
      keep.add(entry.name)
    }
  }
  keepNewestPer(dayKey, retention.daily)
  keepNewestPer(weekKey, retention.weekly)
  return newestFirst.filter((entry) => !keep.has(entry.name)).map((entry) => entry.name)
}
