// ========================================
// Auto-update status (#49): what the updater's events mean for the settings card
// ========================================
// Pure: src/main/app/updates.ts feeds electron-updater's events in, tests feed them directly.
import type { UpdateStatusDto } from '../api/schemas/updates.schema'

export type UpdateEvent =
  | { type: 'checking'; at: string }
  | { type: 'available'; version: string }
  | { type: 'not-available'; at: string }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string; at: string }

export function initialUpdateStatus(currentVersion: string, supported: boolean): UpdateStatusDto {
  return {
    currentVersion,
    phase: supported ? 'idle' : 'unsupported',
    version: null,
    percent: null,
    lastCheckAt: null,
    error: null
  }
}

/** The status after an updater event. A downloaded update stays ready until the app closes */
export function nextUpdateStatus(status: UpdateStatusDto, event: UpdateEvent): UpdateStatusDto {
  if (status.phase === 'unsupported') return status
  switch (event.type) {
    case 'checking':
      // a check while an update waits to be installed does not hide it
      if (status.phase === 'ready') return { ...status, lastCheckAt: event.at }
      return { ...status, phase: 'checking', lastCheckAt: event.at, error: null }
    case 'available':
      if (status.phase === 'ready' && status.version === event.version) return status
      return { ...status, phase: 'downloading', version: event.version, percent: 0, error: null }
    case 'not-available':
      if (status.phase === 'ready') return status
      return { ...status, phase: 'current', version: null, percent: null, lastCheckAt: event.at }
    case 'progress':
      if (status.phase !== 'downloading') return status
      return { ...status, percent: Math.max(0, Math.min(100, Math.round(event.percent))) }
    case 'downloaded':
      return { ...status, phase: 'ready', version: event.version, percent: 100, error: null }
    case 'error':
      // offline or GitHub unreachable: an update already downloaded is still installed on close
      if (status.phase === 'ready') return status
      return {
        ...status,
        phase: 'error',
        percent: null,
        error: event.message,
        lastCheckAt: event.at
      }
  }
}

/** A failed check in plain German; the raw message is often an HTTP dump */
export function updateErrorMessage(raw: string): string {
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR_/i.test(raw))
    return 'Keine Verbindung zu GitHub. Bookingium versucht es später noch einmal.'
  if (/404|latest\.yml/i.test(raw))
    return 'Für die neueste Version liegen noch keine Update-Daten vor.'
  return 'Die Suche nach Updates ist fehlgeschlagen. Bookingium versucht es später noch einmal.'
}
