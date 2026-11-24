import { t } from '../../../main/i18n/translate'
// #253: "Was ist neu" after an update: the highlights of a version, shown once per computer

/** Highlights per minor version ("1.6"); a patch release shows its minor's list */
export const WHATS_NEW: Record<string, string[]> = {
  '1.11': [
    t(
      'Releases (Menü Planung): die Labelcopy jedes Releases an einem Ort – Produkte mit UPC/EAN und Katalognummer, Tracks mit ISRC und Dauer, Credits und die Urheber mit ihren Anteilen. Jede Band hat dazu einen Tab „Releases“.'
    ),
    t(
      'Labelcopy einlesen: Excel-Vorlagen von Labels und der PDF-Report von OpenPlay werden gelesen. Eine Vorschau zeigt, was neu ist und was abweicht; das passende Release wird über UPC, Katalognummer oder ISRC gefunden und die Datei am Release abgelegt.'
    ),
    t(
      'Das Budget aus der Labelcopy wird auf Wunsch zu Marketing-Maßnahmen des Releases – mit „Zahlt: Label“. Die Kosten im Marketing-Tab zeigen eigene Ausgaben und extern Bezahltes jetzt getrennt.'
    )
  ],
  '1.10': [
    t(
      'Abonnierte Kalender: Einstellungen › Kalender nimmt die ICS- oder webcal-Adresse eines Google-, iCloud- oder Outlook-Kalenders. Seine Termine erscheinen im Bookingium-Kalender, nur zum Ansehen, mit eigener Farbe und auch als Serie.'
    ),
    t(
      'Bookingium in Outlook, Google oder Apple abonnieren: Die Kalender-Datei in einem OneDrive- oder Dropbox-Ordner teilen und den Link einfügen – Bookingium macht daraus die Abo-Adresse und prüft, ob die Datei darüber erreichbar und aktuell ist.'
    )
  ],
  '1.9': [
    t(
      'Mitarbeiterzugang: Einstellungen › Allgemein sperrt auf einem Computer die firmeninternen Bereiche (DATEV, eigene Firma und Rechnungseinstellungen, Import von Listen, Sicherung, Abgleich-Einrichtung), auf Wunsch mit PIN zum Entsperren.'
    ),
    t(
      'Mitarbeiter: Einstellungen › Daten › Mitarbeiter gibt jedem Mitarbeiter einen eigenen Abgleich-Ordner mit nur freigegebenen Daten – alle Kontakte, die Events freigegebener Bands und was einzeln freigegeben ist. Rechnungen legt er nur als Entwurf an.'
    ),
    t(
      '„Mitarbeiter“ an Band, Event, Rechnung, Managementvertrag, Abrechnung und Dokument: pro Mitarbeiter freigeben oder als intern markieren. Managementverträge, Rechnungen und Abrechnungen bleiben intern, bis sie freigegeben werden.'
    ),
    t(
      'Booking-Archiv einlesen (Import-Menü): alte Booking-Ordner einer Band auf einmal. Events, Festivals und Firmen werden gefunden oder angelegt, bestehende nur in leeren Feldern ergänzt; wahlweise werden Verträge und Rechnungen abgelegt.'
    ),
    t(
      'Show-Ordner und Vertrag lesen auch eigene Rechnungen (Rechnungsempfänger mit USt-IdNr. wird Rechnungsfirma), Word- und Pages-Dateien sowie KSK- und Steuernummer. Pässe, Tickets und Visa werden nie abgelegt.'
    ),
    t(
      'Verlags- und Labelverträge je Band (Band › Geld), auf Deutsch und Englisch, nach Mustervorlagen.'
    ),
    t(
      'Der englische Auftrittsvertrag folgt jetzt geprüften englischen Vorlagen (Concert Performance Agreement).'
    )
  ],
  '1.8': [
    t(
      'Vertrag einlesen: Einen Vertrag beim Event hochladen, und Veranstalter (Firma, Adresse, USt-IdNr.), Ansprechpartner mit Telefon und E-Mail sowie die Gage werden zum Übernehmen vorgeschlagen. Neue Firmen und Personen werden angelegt und mit dem Event verbunden.'
    ),
    t(
      'Verträge und Dokumente lassen sich Firmen, Personen, Clubs, Festivals, Bands und Events zuordnen („Zuordnen“ am Dokument). Deren Seiten zeigen sie unter „Verträge & Dokumente“, zusammen mit den Dateien ihrer Events – mit Suche.'
    ),
    t(
      'Touren nachträglich bearbeiten: Auf der Tour-Seite umbenennen und per Häkchen Shows hinzufügen oder herausnehmen, „Neue Tour“ stellt eine Tour aus vorhandenen Shows zusammen.'
    ),
    t(
      'Show-Ordner unterscheidet Club und Festival. Hat das Event noch keinen Club und kein Festival, wird das in den Dateien genannte zugeordnet oder mit Adresse und Kapazität angelegt.'
    ),
    t(
      'Konzertabrechnungen in Fremdwährung (z. B. Pfund): Beträge in der Währung der Abrechnung, die Managementbeteiligung in Euro zum eingetragenen Kurs.'
    ),
    t(
      'Auch die Abrechnung lässt sich als „extern erledigt“ abhaken, mit der Datei des Veranstalters.'
    )
  ],
  '1.7': [
    t(
      'Show-Ordner einlesen: Am Event den Ordner der Agentur (Day-/Infosheet, Club-Infos, Mails, Pläne) hineinziehen. Tagesablauf, Ticketpreis, Kapazität, Hotel und Ansprechpartner werden zum Übernehmen vorgeschlagen, die Dateien beim Event oder Club abgelegt.'
    ),
    t(
      'Dateien lassen sich überall hineinziehen, wo man sie auswählen kann: Importe, Abrechnung, Logo und Unterschrift, Mail-Anhänge und Reisebelege.'
    ),
    t(
      'Englische Oberfläche: Einstellungen › Allgemein › Darstellung schaltet je Computer auf Englisch um. Rechnungen und Verträge lassen sich beim Drucken auf Deutsch oder Englisch ausgeben.'
    ),
    t('Eine gespeicherte Abrechnung trägt die abgerechneten Tickets auch als Verkaufsmeldung ein.'),
    t(
      'Events: neue Spalte „Ort“, vergangene Events heller. Vertrag, Vorkasse, Rechnung, Hotel, Advancing und Ticketmeldung lassen sich als „extern erledigt“ abhaken.'
    ),
    t(
      'Clubs zeigen die Ansprechpartner ihrer Firma; eine gleichnamige Firma lässt sich mit einem Klick verknüpfen. Einstellungen › Daten listet doppelte Einträge zum Zusammenführen.'
    ),
    t(
      'Abgleich: Jeder Computer zeigt „zuletzt gesehen“. Kommt von den anderen lange nichts an, weist ein Hinweis auf OneDrive, Dropbox oder Google Drive hin.'
    )
  ],
  '1.6': [
    t(
      'Übersichtlichere Seiten: Events haben nur noch vier Reiter (Übersicht, Ablauf, Geld, Dokumente). Oben auf der Übersicht steht der Stand der Show: Gage, Vertrag, Rechnung, Advancing und Tickets.'
    ),
    t(
      'Bands, Firmen, Personen, Clubs und Festivals zeigen ihre Angaben kompakt in einer Karte, dazu kurze Listen der nächsten Shows, offenen Rechnungen und Verknüpfungen. Leere Reiter verschwinden.'
    ),
    t('Seltene Aktionen (Duplizieren, Zusammenführen, Löschen) liegen im „…“-Menü oben rechts.'),
    t(
      'Das Menü ist neu geordnet: Planung, Finanzen, Kontakte, Kommunikation, Verwaltung. Alt+1 bis Alt+0 führen zu Dashboard, Kalender, Events, Touren, Rechnungen, Bands, Personen, Firmen, Clubs und E-Mail.'
    ),
    t(
      'Karte: „Alle Kreise hervorheben“ füllt jeden Gebietsschutz halb durchsichtig, Überlappungen werden dunkler.'
    ),
    t(
      'Tipps erklären an vielen Stellen, was eine Funktion macht. Weggeklickte Tipps holt Einstellungen › Allgemein zurück.'
    )
  ]
}

/** "1.6.2" → "1.6" */
export function minorOf(version: string): string {
  return version.split('.').slice(0, 2).join('.')
}

/**
 * The highlights to show after starting `current`: those of its minor version, unless that
 * minor was shown already on this computer
 */
export function whatsNewFor(current: string, lastSeen: string | null): string[] {
  const minor = minorOf(current)
  if (lastSeen !== null && minorOf(lastSeen) === minor) return []
  return WHATS_NEW[minor] ?? []
}
