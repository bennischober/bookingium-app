import { formatSize } from '@/components/mail/format'
import type { PassSummary, SyncStatus } from '../../../../main/mailclient/core/types'

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

const PASS_KIND: Record<PassSummary['kind'], string> = {
  changes: 'Synchronisieren',
  all: 'Synchronisieren (alle Ordner, Abgleich noch nicht vollständig)',
  full: 'Alle Ordner prüfen'
}

/** "1,2 s" */
const seconds = (ms: number): string =>
  `${(ms / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`

/**
 * #157: what the pacer did in a pass, when it slowed down at all ("Vom Server gebremst: 2 Signale,
 * Pause bis 200 ms"); null for a pass without a signal and without a learned pause.
 */
export function pacingText(pass: PassSummary): string | null {
  const p = pass.pacing
  if (!p || (p.signals === 0 && p.maxPauseMs === 0)) return null
  const signals = p.signals === 1 ? '1 Signal' : `${p.signals} Signale`
  return `Vom Server gebremst: ${signals}, Pause bis ${p.maxPauseMs} ms`
}

/**
 * #156: the tooltip on "Synchronisiert HH:MM": what the last pass the user started did, to judge
 * the STATUS census pacing against a real server. Counts and times only, never folder names.
 */
export function passSummaryText(pass: PassSummary): string {
  const at = new Date(pass.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  const census = pass.listStatus
    ? 'mit einem LIST-STATUS'
    : `einzeln per STATUS, Pause ${pass.censusPauseMs} ms`
  const lines = [
    `Zuletzt: ${PASS_KIND[pass.kind]} um ${at}`,
    `${pass.foldersChecked} Ordner geprüft in ${seconds(pass.censusMs)} (${census})`,
    `${pass.foldersSynced} Ordner synchronisiert, gesamt ${seconds(pass.totalMs)}`,
    `${pass.errors} Fehler`
  ]
  const pacing = pacingText(pass)
  if (pacing) lines.push(pacing)
  if (pass.phase !== 'idle') lines.push('Vorzeitig beendet')
  if (pass.connection !== 'online') lines.push('Verbindung danach getrennt')
  return lines.join('\n')
}
