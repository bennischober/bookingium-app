// #254: English UI texts of lib, keyed by the German source string (see ../translate.ts)

export const libEn: Record<string, string> = {
  'Diese Aktion kann nicht rückgängig gemacht werden.': 'This action cannot be undone.',
  'Component stack:{{componentStack}}': 'Component stack:{{componentStack}}',
  Morgen: 'Tomorrow',
  'Überfällig seit {{germanDate}}': 'Overdue since {{germanDate}}',
  Heute: 'Today',
  'Erledigt am {{germanDate}}': 'Done on {{germanDate}}',
  'Antwort erhalten am {{germanDate}}': 'Reply received on {{germanDate}}',
  'Wieder offen (gestellt)': 'Open again (issued)',
  Gestellt: 'Issued',
  'Gestellt als Storno zu': 'Issued as cancellation of',
  'Als bezahlt markiert': 'Marked as paid',
  'Stornorechnung {{invoiceNumberLabel}}': 'Cancellation invoice {{invoiceNumberLabel}}',
  Entwurf: 'Draft',
  'Übergabe an DATEV wird bestätigt': 'Handover to DATEV being confirmed',
  '{{value}}, an {{to}}': '{{value}}, to {{to}}',
  Angelegt: 'Created',
  überfällig: 'overdue',
  'Rechnung #{{invoiceNumber}}': 'Invoice #{{invoiceNumber}}',
  'E-Mail erstellt am {{day}}{{value}}': 'Email created on {{day}}{{value}}',
  'E-Mail erstellt': 'Email created',
  'Zahlungserinnerung erstellt': 'Payment reminder created',
  'Mahnung erstellt': 'Overdue notice created',
  'Zahlungserinnerung senden…': 'Send payment reminder…',
  'Mahnung senden…': 'Send overdue notice…',
  'Keine (nur auf diesem Computer)': 'None (this computer only)',
  'Meist passt die Verschlüsselung nicht zum Port (SSL/TLS: 993, STARTTLS: 143).':
    'Usually the encryption does not match the port (SSL/TLS: 993, STARTTLS: 143).',
  'Server nicht gefunden. Bitte den Servernamen prüfen.':
    'Server not found. Please check the server name.',
  'Der Server ist erreichbar, aber an diesem Port antwortet kein Mailserver. Bitte den Port prüfen.':
    'The server is reachable, but no mail server answers on this port. Please check the port.',
  'Keine Antwort vom Server. Internetverbindung, Servername und Port prüfen.':
    'No answer from the server. Check the internet connection, server name and port.',
  'Verbunden, aber es meldet sich kein Mailserver. {{PORT_HINT}}':
    'Connected, but no mail server responds. {{PORT_HINT}}',
  'Die verschlüsselte Verbindung kam nicht zustande. {{PORT_HINT}}':
    'The encrypted connection could not be established. {{PORT_HINT}}',
  'Das Zertifikat des Servers ist nicht vertrauenswürdig. Bitte den Servernamen prüfen.':
    "The server's certificate is not trusted. Please check the server name.",
  'Der Server bietet kein STARTTLS an. Bitte SSL/TLS mit Port 993 wählen.':
    'The server does not offer STARTTLS. Please choose SSL/TLS with port 993.',
  'Anmeldung abgelehnt: Benutzername oder Passwort stimmt nicht.':
    'Sign-in rejected: user name or password is wrong.',
  'Die Verbindung ist fehlgeschlagen.': 'The connection failed.',
  '1 Ordner': '1 folder',
  '{{folderCount}} Ordner': '{{folderCount}} folders',
  ', davon {{subscribedCount}} abonniert': ', {{subscribedCount}} of them subscribed',
  'Verbindung erfolgreich: {{folders}} gefunden{{subscribed}} ({{seconds}}).':
    'Connection successful: {{folders}} found{{subscribed}} ({{seconds}}).',
  'Server-Funktionen: {{capabilities}}': 'Server capabilities: {{capabilities}}',
  'Rechnung (Druckansicht)': 'Invoice (print view)',
  'Vertrag (Druckansicht)': 'Contract (print view)',
  'Managementvertrag (Druckansicht)': 'Management contract (print view)',
  gelöscht: 'deleted',
  '{{name}} wurde {{value}}.': '{{name}} was {{value}}.',
  '„{{name}}“ löschen?': 'Delete “{{name}}”?',
  'Schneller ans Ziel': 'Get there faster',
  'Alt+1 bis Alt+0 springen zu den wichtigsten Seiten, Strg+K sucht alles (Einträge, Seiten und Aktionen). Die Übersicht aller Tastenkürzel öffnet das Tastatur-Symbol oben rechts.':
    'Alt+1 to Alt+0 jump to the most important pages, Ctrl+K searches everything (entries, pages and actions). The keyboard icon at the top right opens the overview of all shortcuts.',
  'Der Stand der Show auf einen Blick': "The show's status at a glance",
  'Die Kacheln oben zeigen Gage, Vertrag, Rechnung, Advancing und Tickets. Ein Klick führt zum Bereich, wo man es ändert. „Bearbeiten“ schaltet alle Bereiche zugleich in den Bearbeitungsmodus, „Alles speichern“ sichert sie gemeinsam.':
    'The tiles at the top show fee, contract, invoice, advancing and tickets. A click leads to the section where you change it. “Edit” switches all sections into edit mode at once, “Save all” saves them together.',
  'Erinnern und aufräumen': 'Remind and tidy up',
  '„Wiedervorlage“ legt eine Erinnerung zu diesem Eintrag an, sie erscheint am Tag auf dem Dashboard. Ist ein Eintrag doppelt angelegt, führt „…“ › „Zusammenführen“ beide zusammen, mit allen Events, Rechnungen und Dokumenten.':
    '“Follow-up” creates a reminder for this entry; it appears on the dashboard on the day. If an entry exists twice, “…” › “Merge” combines both, with all events, invoices and documents.',
  'Wo passt noch eine Show?': 'Where does another show fit?',
  '„Alle Kreise hervorheben“ füllt jeden Gebietsschutz halb durchsichtig. Wo sich Kreise überlappen, wird es dunkler; wo die Karte frei bleibt, blockiert keine Show. „Anfrage prüfen“ zeigt für einen Club und ein Datum, was eine Buchung blockieren würde.':
    '“Highlight all circles” fills every radius clause semi-transparently. Where circles overlap, it gets darker; where the map stays clear, no show blocks. “Check request” shows for a club and a date what a booking would block.',
  'Atlas und Maßnahmen': 'Atlas and actions',
  'Der Atlas ist die Recherche (Radios, Presse, Festivals …), er wird aus einer Datei eingespielt und über „Atlas aktualisieren…“ erneuert, ohne Status und Notizen zu verlieren. Maßnahmen sind, was gebucht ist (Radiospots, Plakate …), mit Kosten, Beleg und Rechnung.':
    'The atlas is the research (radios, press, festivals …); it is loaded from a file and renewed via “Update atlas…” without losing status and notes. Actions are what is booked (radio spots, posters …), with costs, receipt and invoice.',
  'Rechnungen aus DATEV': 'Invoices from DATEV',
  'Ist eine Rechnung schon in DATEV geschrieben, im Formular „Rechnung schon in DATEV erstellt“ wählen und die DATEV-Nummer eintragen. Bookingium zählt danach oberhalb weiter, so gibt es keine Nummer doppelt.':
    'If an invoice has already been written in DATEV, choose “Invoice already created in DATEV” in the form and enter the DATEV number. Bookingium then continues counting above it, so no number appears twice.',
  'Import ohne Dopplungen': 'Import without duplicates',
  'Vorhandene Firmen und Personen werden am Namen bzw. an der E-Mail erkannt und nur ergänzt. Die Vorschau zeigt vorher, was neu angelegt und was ergänzt wird; „Vorhandene Angaben überschreiben“ ersetzt auch gefüllte Felder.':
    'Existing companies and people are recognised by name or email and only completed. The preview shows beforehand what is created and what is completed; “Overwrite existing details” also replaces filled fields.',
  'Übersichtlichere Seiten: Events haben nur noch vier Reiter (Übersicht, Ablauf, Geld, Dokumente). Oben auf der Übersicht steht der Stand der Show: Gage, Vertrag, Rechnung, Advancing und Tickets.':
    "Clearer pages: events now have only four tabs (Overview, Schedule, Money, Documents). At the top of the overview is the show's status: fee, contract, invoice, advancing and tickets.",
  'Bands, Firmen, Personen, Clubs und Festivals zeigen ihre Angaben kompakt in einer Karte, dazu kurze Listen der nächsten Shows, offenen Rechnungen und Verknüpfungen. Leere Reiter verschwinden.':
    'Bands, companies, people, clubs and festivals show their details compactly in a card, plus short lists of the next shows, open invoices and links. Empty tabs disappear.',
  'Seltene Aktionen (Duplizieren, Zusammenführen, Löschen) liegen im „…“-Menü oben rechts.':
    'Rare actions (duplicate, merge, delete) are in the “…” menu at the top right.',
  'Das Menü ist neu geordnet: Planung, Finanzen, Kontakte, Kommunikation, Verwaltung. Alt+1 bis Alt+0 führen zu Dashboard, Kalender, Events, Touren, Rechnungen, Bands, Personen, Firmen, Clubs und E-Mail.':
    'The menu has been reordered: Planning, Finance, Contacts, Communication, Administration. Alt+1 to Alt+0 lead to Dashboard, Calendar, Events, Tours, Invoices, Bands, People, Companies, Clubs and Email.',
  'Karte: „Alle Kreise hervorheben“ füllt jeden Gebietsschutz halb durchsichtig, Überlappungen werden dunkler.':
    'Map: “Highlight all circles” fills every radius clause semi-transparently; overlaps get darker.',
  'Tipps erklären an vielen Stellen, was eine Funktion macht. Weggeklickte Tipps holt Einstellungen › Allgemein zurück.':
    'Tips explain in many places what a feature does. Settings › General brings back dismissed tips.'
}
