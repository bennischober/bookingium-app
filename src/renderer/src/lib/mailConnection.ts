// Texts for the mail connection: the account test in the settings and the state on the mail page
import type {
  ConnectionTestResult,
  ConnectionTestStage
} from '../../../main/mailclient/core/connection_test'
import type { ImapSecurity } from '../../../main/mailclient/core/types'

export const SECURITY_LABELS: Record<ImapSecurity, string> = {
  tls: 'SSL/TLS',
  starttls: 'STARTTLS',
  none: 'Keine (nur auf diesem Computer)'
}

/** The usual IMAP port for each setting */
export const SECURITY_PORTS: Record<ImapSecurity, number> = { tls: 993, starttls: 143, none: 143 }

const PORT_HINT = 'Meist passt die Verschlüsselung nicht zum Port (SSL/TLS: 993, STARTTLS: 143).'

const STAGE_MESSAGES: Record<ConnectionTestStage, string> = {
  dns: 'Server nicht gefunden. Bitte den Servernamen prüfen.',
  refused:
    'Der Server ist erreichbar, aber an diesem Port antwortet kein Mailserver. Bitte den Port prüfen.',
  unreachable: 'Keine Antwort vom Server. Internetverbindung, Servername und Port prüfen.',
  greeting: `Verbunden, aber es meldet sich kein Mailserver. ${PORT_HINT}`,
  tls: `Die verschlüsselte Verbindung kam nicht zustande. ${PORT_HINT}`,
  certificate:
    'Das Zertifikat des Servers ist nicht vertrauenswürdig. Bitte den Servernamen prüfen.',
  starttls: 'Der Server bietet kein STARTTLS an. Bitte SSL/TLS mit Port 993 wählen.',
  auth: 'Anmeldung abgelehnt: Benutzername oder Passwort stimmt nicht.',
  timeout: 'Der Server hat nicht rechtzeitig geantwortet.',
  other: 'Die Verbindung ist fehlgeschlagen.'
}

const seconds = (ms: number): string =>
  `${(ms / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} s`

/** One line for the result of "Verbindung testen" */
export function connectionTestMessage(result: ConnectionTestResult): string {
  if (result.ok) {
    const folders = result.folderCount === 1 ? '1 Ordner' : `${result.folderCount} Ordner`
    return `Verbindung erfolgreich: ${folders} gefunden (${seconds(result.ms)}).`
  }
  return STAGE_MESSAGES[result.stage]
}

/** "in 40 s", "in 2 min" until `iso`, never negative */
export function retryIn(iso: string, now: number): string {
  const s = Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000))
  return s < 60 ? `in ${s} s` : `in ${Math.round(s / 60)} min`
}
