import type {
  PassSummary,
  SyncErrorEntry,
  SyncStatus
} from '../../../../main/mailclient/core/types'
import { pacingText } from './syncProgress'
import { t, uiLocale } from '../../../../main/i18n/translate'

/**
 * #159: the text of the sync activity panel behind the sync bar: the last passes and the sync
 * errors still standing. Counts, times and folder names only, never mail content.
 */

/** What started the pass, in the words of the sync bar's buttons */
export function passTitle(pass: PassSummary): string {
  if (pass.trigger === 'auto') return t('Automatischer Abgleich')
  if (pass.kind === 'full') return t('Alle Ordner prüfen')
  // the sync button while the first download is not complete runs over every folder
  return t('Synchronisieren')
}

const time = (iso: string): string =>
  new Date(iso).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit' })

const dateTime = (iso: string): string =>
  new Date(iso).toLocaleString(uiLocale(), {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

/** "1,2 s", "3 Min. 5 s" */
export function durationText(ms: number): string {
  if (ms < 60_000)
    return `${(ms / 1000).toLocaleString(uiLocale(), { maximumFractionDigits: 1 })} s`
  const total = Math.round(ms / 1000)
  const min = Math.floor(total / 60)
  const sec = total % 60
  return sec ? t('{{min}} Min. {{sec}} s', { min, sec }) : `${min} Min.`
}

const count = (n: number, one: string, many: string): string =>
  `${n.toLocaleString(uiLocale())} ${n === 1 ? one : many}`

/** How the pass ended, when not as planned */
export function passOutcome(pass: PassSummary): string | null {
  if (pass.phase === 'idle')
    return pass.connection === 'online' ? null : t('Verbindung danach getrennt')
  if (pass.phase === 'paused') return t('Pausiert')
  if (pass.phase === 'disk-full') return t('Speicherplatz voll')
  return t('Vorzeitig beendet')
}

/** The facts of one pass, in one line: "12:03 · 4,2 s · 276 Ordner geprüft · …" */
export function passFacts(pass: PassSummary): string {
  const parts = [time(pass.at), durationText(pass.totalMs)]
  if (pass.foldersChecked > 0)
    parts.push(
      t('{{count}} geprüft', { count: count(pass.foldersChecked, t('Ordner'), t('Ordner')) })
    )
  parts.push(`${count(pass.foldersSynced, t('Ordner'), t('Ordner'))} synchronisiert`)
  if (pass.newMessages) parts.push(count(pass.newMessages, t('neue E-Mail'), t('neue E-Mails')))
  if (pass.flagChanges)
    parts.push(count(pass.flagChanges, t('Markierung geändert'), t('Markierungen geändert')))
  if (pass.expunged) parts.push(count(pass.expunged, t('E-Mail entfernt'), t('E-Mails entfernt')))
  if (pass.errors) parts.push(count(pass.errors, t('Fehler'), t('Fehler')))
  return parts.join(' · ')
}

/**
 * The known sync errors in German, by what the server or the socket said. The order matters: the
 * more specific ones first. Unknown messages get no German text; the panel shows them as they are.
 */
const KNOWN_ERRORS: [RegExp, string][] = [
  [
    /login rejected/i,
    t('Der Server hat die Anmeldung abgelehnt. Bitte die Zugangsdaten im Konto prüfen.')
  ],
  [
    /circuit/i,
    t('Zu viele Fehler hintereinander. Bookingium wartet kurz, bevor es den Server wieder fragt.')
  ],
  [/quota|over ?quota/i, t('Der Speicherplatz des Postfachs auf dem Server ist voll.')],
  [
    /doesn'?t exist|does not exist|nonexistent|no such mailbox|mailbox not found|unknown mailbox/i,
    t('Den Ordner gibt es auf dem Server nicht (mehr).')
  ],
  [/timed? ?out|timeout|etimedout/i, t('Der Server hat nicht rechtzeitig geantwortet.')],
  [
    /enotfound|eai_again|econnrefused|ehostunreach|enetunreach|getaddrinfo/i,
    t('Der Server ist nicht erreichbar.')
  ],
  [
    /econnreset|epipe|socket|connection (?:was )?(?:closed|reset|lost|ended)|not connected|closed unexpectedly/i,
    t('Die Verbindung zum Server wurde unterbrochen.')
  ],
  [/no folder answered/i, t('Kein Ordner hat geantwortet.')],
  [/safety gate/i, t('Die Ordnerliste des Servers war leer und wurde nicht übernommen.')],
  [/\b(?:NO|BAD)\b|command failed/, t('Der Server hat einen Befehl abgelehnt.')]
]

/** The German text of a sync error, or null when it is not one of the known ones */
export function syncErrorText(message: string): string | null {
  for (const [pattern, text] of KNOWN_ERRORS) if (pattern.test(message)) return text
  return null
}

/** Where the error happened: the folder's name, or the sync as a whole */
export function syncErrorWhere(
  entry: SyncErrorEntry,
  folderName: (path: string) => string
): string {
  return entry.path === null ? t('Synchronisierung') : folderName(entry.path)
}

/** "seit 12:03, 3×" */
export function syncErrorSeen(entry: SyncErrorEntry): string {
  if (entry.count === 1) return dateTime(entry.lastAt)
  return t('{{count}} seit {{dateTime}}, zuletzt {{time}}', {
    count:
      entry.count === 1
        ? t('1 Mal')
        : t('{{count}} Mal', { count: entry.count.toLocaleString(uiLocale()) }),
    dateTime: dateTime(entry.firstAt),
    time: time(entry.lastAt)
  })
}

/** The sync errors of the status, also for a core that sent only the last pass's (before #159) */
export function syncErrorsOf(status: SyncStatus): SyncErrorEntry[] {
  if (status.syncErrors) return status.syncErrors
  return status.errors.map((line, i) => ({
    key: `legacy:${i}`,
    path: null,
    message: line,
    firstAt: status.lastSyncAt ?? new Date(0).toISOString(),
    lastAt: status.lastSyncAt ?? new Date(0).toISOString(),
    count: 1
  }))
}

/** Path -> message of the folders whose last sync failed, for the marker in the folder tree */
export function folderErrorMap(status: SyncStatus | undefined): Map<string, string> {
  const map = new Map<string, string>()
  for (const e of status?.syncErrors ?? []) {
    if (e.path !== null && !map.has(e.path)) map.set(e.path, syncErrorText(e.message) ?? e.message)
  }
  return map
}

/** One error as text, for "Kopieren" */
export function syncErrorReport(
  entry: SyncErrorEntry,
  folderName: (path: string) => string
): string {
  const german = syncErrorText(entry.message)
  return [
    `${syncErrorWhere(entry, folderName)}: ${german ?? entry.message}`,
    ...(german ? [t('Meldung: {{message}}', { message: entry.message })] : []),
    t('Gesehen: {{syncErrorSeen}}', { syncErrorSeen: syncErrorSeen(entry) })
  ].join('\n')
}

/** The whole panel as text, for a support request ("Alles kopieren") */
export function syncActivityReport(
  status: SyncStatus,
  folderName: (path: string) => string,
  now = new Date()
): string {
  const lines = [
    t('Bookingium E-Mail: Synchronisierung, Stand {{dateTime}}', {
      dateTime: dateTime(now.toISOString())
    })
  ]
  lines.push(
    t('Verbindung: {{connection}}{{value}}', {
      connection: status.connection,
      value: status.lastSyncAt
        ? t(', zuletzt synchronisiert {{when}}', { when: dateTime(status.lastSyncAt) })
        : ''
    })
  )
  const errors = syncErrorsOf(status)
  lines.push('', errors.length ? t('Fehler:') : t('Keine Fehler.'))
  for (const e of errors)
    lines.push(
      ...syncErrorReport(e, folderName)
        .split('\n')
        .map((l, i) => (i ? `  ${l}` : `- ${l}`))
    )
  const passes = status.passHistory ?? (status.lastPass ? [status.lastPass] : [])
  if (passes.length) {
    lines.push('', t('Letzte Durchläufe:'))
    for (const p of passes) {
      const outcome = passOutcome(p)
      const census = p.listStatus
        ? 'LIST-STATUS'
        : t('STATUS, Pause {{censusPauseMs}} ms', { censusPauseMs: p.censusPauseMs })
      const pacing = pacingText(p)
      lines.push(
        `- ${passTitle(p)}: ${passFacts(p)} (${census})${pacing ? ` · ${pacing}` : ''}${outcome ? ` · ${outcome}` : ''}`
      )
    }
  }
  return lines.join('\n')
}
