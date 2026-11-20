import { formatSize } from '@/components/mail/format'
import type { PassSummary, SyncStatus } from '../../../../main/mailclient/core/types'
import { t, uiLocale } from '../../../../main/i18n/translate'

/** "noch ca. 25 Min." from the core's estimate; rounded so it does not flicker each second */
export function remainingText(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 2) return t('noch ca. 1 Min.')
  if (minutes < 60) return t('noch ca. {{minutes}} Min.', { minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('noch ca. {{hours}} Std.', { hours })
  const days = Math.round(hours / 24)
  return `noch ca. ${days} ${days === 1 ? t('Tag') : t('Tage')}`
}

/**
 * The progress behind "Synchronisiere ·" / "Download pausiert ·": during the first download the
 * messages so far, the mailbox's size and the time left (#63) as far as they are known; during the
 * sync button's change pass (#156) its two halves, the priority folders and then the STATUS check
 * of all others; otherwise the folders of the pass
 */
export function syncProgressText(status: SyncStatus): string {
  const folders = `${status.foldersSynced} / ${status.foldersTotal}`
  if (status.changePass === 'priority') return t('Wichtige Ordner · {{folders}}', { folders })
  if (status.changePass === 'check')
    return t('Wichtige Ordner aktuell · {{folders}} Ordner geprüft', { folders })
  const initial = status.phase === 'initial' || status.phase === 'paused'
  if (!initial || status.messagesDone === undefined) return t('{{folders}} Ordner', { folders })
  const parts = [
    `${status.messagesDone.toLocaleString(uiLocale())}${
      status.messagesTotal ? ` / ${status.messagesTotal.toLocaleString(uiLocale())}` : ''
    } E-Mails`
  ]
  if (status.bytesTotal) parts.push(`ca. ${formatSize(status.bytesTotal)}`)
  const left = status.paused ? null : remainingText(status.secondsLeft)
  if (left) parts.push(left)
  return parts.join(' · ')
}

const PASS_KIND: Record<PassSummary['kind'], string> = {
  changes: t('Synchronisieren'),
  all: t('Synchronisieren (alle Ordner, Abgleich noch nicht vollständig)'),
  full: t('Alle Ordner prüfen')
}

/** "1,2 s" */
const seconds = (ms: number): string =>
  `${(ms / 1000).toLocaleString(uiLocale(), { maximumFractionDigits: 1 })} s`

/**
 * #157: what the pacer did in a pass, when it slowed down at all ("Vom Server gebremst: 2 Signale,
 * Pause bis 200 ms"); null for a pass without a signal and without a learned pause.
 */
export function pacingText(pass: PassSummary): string | null {
  const p = pass.pacing
  if (!p || (p.signals === 0 && p.maxPauseMs === 0)) return null
  const signals = p.signals === 1 ? t('1 Signal') : t('{{signals}} Signale', { signals: p.signals })
  return t('Vom Server gebremst: {{signals}}, Pause bis {{maxPauseMs}} ms', {
    signals,
    maxPauseMs: p.maxPauseMs
  })
}

/**
 * #156: the tooltip on "Synchronisiert HH:MM": what the last pass the user started did, to judge
 * the STATUS census pacing against a real server. Counts and times only, never folder names.
 */
export function passSummaryText(pass: PassSummary): string {
  const at = new Date(pass.at).toLocaleTimeString(uiLocale(), {
    hour: '2-digit',
    minute: '2-digit'
  })
  const census = pass.listStatus
    ? t('mit einem LIST-STATUS')
    : t('einzeln per STATUS, Pause {{censusPauseMs}} ms', { censusPauseMs: pass.censusPauseMs })
  const lines = [
    t('Zuletzt: {{value}} um {{at}}', { value: PASS_KIND[pass.kind], at }),
    t('{{foldersChecked}} Ordner geprüft in {{seconds}} ({{census}})', {
      foldersChecked: pass.foldersChecked,
      seconds: seconds(pass.censusMs),
      census
    }),
    t('{{foldersSynced}} Ordner synchronisiert, gesamt {{seconds}}', {
      foldersSynced: pass.foldersSynced,
      seconds: seconds(pass.totalMs)
    }),
    t('{{errors}} Fehler', { errors: pass.errors })
  ]
  const pacing = pacingText(pass)
  if (pacing) lines.push(pacing)
  if (pass.phase !== 'idle') lines.push(t('Vorzeitig beendet'))
  if (pass.connection !== 'online') lines.push(t('Verbindung danach getrennt'))
  return lines.join('\n')
}
