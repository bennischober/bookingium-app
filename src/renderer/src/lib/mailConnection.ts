// Texts for the mail connection: the account test in the settings and the state on the mail page
import type {
  ConnectionTestResult,
  ConnectionTestStage
} from '../../../main/mailclient/core/connection_test'
import type { ImapSecurity } from '../../../main/mailclient/core/types'
import { t, uiLocale } from '../../../main/i18n/translate'

export const SECURITY_LABELS: Record<ImapSecurity, string> = {
  tls: 'SSL/TLS',
  starttls: 'STARTTLS',
  none: t('Keine (nur auf diesem Computer)')
}

/** The usual IMAP port for each setting */
export const SECURITY_PORTS: Record<ImapSecurity, number> = { tls: 993, starttls: 143, none: 143 }

const PORT_HINT = t('Meist passt die Verschlüsselung nicht zum Port (SSL/TLS: 993, STARTTLS: 143).')

const STAGE_MESSAGES: Record<ConnectionTestStage, string> = {
  dns: t('Server nicht gefunden. Bitte den Servernamen prüfen.'),
  refused: t(
    'Der Server ist erreichbar, aber an diesem Port antwortet kein Mailserver. Bitte den Port prüfen.'
  ),
  unreachable: t('Keine Antwort vom Server. Internetverbindung, Servername und Port prüfen.'),
  greeting: t('Verbunden, aber es meldet sich kein Mailserver. {{PORT_HINT}}', { PORT_HINT }),
  tls: t('Die verschlüsselte Verbindung kam nicht zustande. {{PORT_HINT}}', { PORT_HINT }),
  certificate: t(
    'Das Zertifikat des Servers ist nicht vertrauenswürdig. Bitte den Servernamen prüfen.'
  ),
  starttls: t('Der Server bietet kein STARTTLS an. Bitte SSL/TLS mit Port 993 wählen.'),
  auth: t('Anmeldung abgelehnt: Benutzername oder Passwort stimmt nicht.'),
  timeout: t('Der Server hat nicht rechtzeitig geantwortet.'),
  other: t('Die Verbindung ist fehlgeschlagen.')
}

const seconds = (ms: number): string =>
  `${(ms / 1000).toLocaleString(uiLocale(), { maximumFractionDigits: 1 })} s`

/** One line for the result of "Verbindung testen" */
export function connectionTestMessage(result: ConnectionTestResult): string {
  if (result.ok) {
    const folders =
      result.folderCount === 1
        ? t('1 Ordner')
        : t('{{folderCount}} Ordner', { folderCount: result.folderCount })
    // #158: only when it says something; all folders subscribed is also what a server without
    // subscriptions reports
    const subscribed =
      result.subscribedCount < result.folderCount
        ? t(', davon {{subscribedCount}} abonniert', { subscribedCount: result.subscribedCount })
        : ''
    return t('Verbindung erfolgreich: {{folders}} gefunden{{subscribed}} ({{seconds}}).', {
      folders,
      subscribed,
      seconds: seconds(result.ms)
    })
  }
  return STAGE_MESSAGES[result.stage]
}

/**
 * #156: the capabilities the server advertised, as one line for the account test, so it can be
 * read whether the server offers LIST-STATUS, CONDSTORE and so on. null when there are none.
 */
export function capabilitiesLine(result: ConnectionTestResult): string | null {
  if (!result.ok || !result.capabilities?.length) return null
  return t('Server-Funktionen: {{capabilities}}', { capabilities: result.capabilities.join(', ') })
}

/** "in 40 s", "in 2 min" until `iso`, never negative */
export function retryIn(iso: string, now: number): string {
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000))
  return s < 60 ? `in ${s} s` : `in ${Math.round(s / 60)} min`
}

/**
 * The further own addresses of an account as typed: separated by commas, semicolons or
 * line breaks. `invalid` names the first entry that is no address, for the dialog's hint.
 */
export function parseAliases(text: string): { aliases: string[]; invalid: string | null } {
  const aliases = text
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
  const invalid = aliases.find((entry) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)) ?? null
  return { aliases, invalid }
}
