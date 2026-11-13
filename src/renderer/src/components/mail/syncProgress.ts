import { formatSize } from '@/components/mail/format'
import type { SyncStatus } from '../../../../main/mailclient/core/types'

/** "noch ca. 25 Min." from the core's estimate; rounded so it does not flicker each second */
export function remainingText(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 2) return 'noch ca. 1 Min.'
  if (minutes < 60) return `noch ca. ${minutes} Min.`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `noch ca. ${hours} Std.`
  const days = Math.round(hours / 24)
  return `noch ca. ${days} ${days === 1 ? 'Tag' : 'Tage'}`
}

/**
 * The progress behind "Synchronisiere ·" / "Download pausiert ·": during the first download the
 * messages so far, the mailbox's size and the time left (#63) as far as they are known; during the
 * sync button's change pass (#156) its two halves, the priority folders and then the STATUS check
 * of all others; otherwise the folders of the pass
 */
export function syncProgressText(status: SyncStatus): string {
  const folders = `${status.foldersSynced} / ${status.foldersTotal}`
  if (status.changePass === 'priority') return `Wichtige Ordner · ${folders}`
  if (status.changePass === 'check') return `Wichtige Ordner aktuell · ${folders} Ordner geprüft`
  const initial = status.phase === 'initial' || status.phase === 'paused'
  if (!initial || status.messagesDone === undefined) return `${folders} Ordner`
  const parts = [
    `${status.messagesDone.toLocaleString('de-DE')}${
      status.messagesTotal ? ` / ${status.messagesTotal.toLocaleString('de-DE')}` : ''
    } E-Mails`
  ]
  if (status.bytesTotal) parts.push(`ca. ${formatSize(status.bytesTotal)}`)
  const left = status.paused ? null : remainingText(status.secondsLeft)
  if (left) parts.push(left)
  return parts.join(' · ')
}
