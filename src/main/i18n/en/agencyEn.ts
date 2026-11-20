// #254: English UI texts of agency, keyed by the German source string (see ../translate.ts)

export const agencyEn: Record<string, string> = {
  Agenturbuchungen: 'Agency bookings',
  Agenturbuchung: 'Agency booking',
  'Agenturbuchung entfernt': 'Agency booking removed',
  'Agenturbuchung konnte nicht entfernt werden': 'Agency booking could not be removed',
  'Agenturbuchungen konnten nicht entfernt werden': 'Agency bookings could not be removed',
  'Agenturbuchung vom {{germanDate}} entfernen?': 'Remove agency booking of {{germanDate}}?',
  Entfernen: 'Remove',
  'Alle Buchungen von „{{name}}“ entfernen?': 'Remove all bookings of “{{name}}”?',
  '{{count}} {{value}} entfernt. Das lässt sich nicht rückgängig machen, außer durch einen neuen Import.':
    '{{count}} {{value}} removed. This cannot be undone, except by a new import.',
  'Alle entfernen': 'Remove all',
  Datum: 'Date',
  Band: 'Band',
  'Club / Festival': 'Club / Festival',
  Ort: 'City',
  Agentur: 'Agency',
  Status: 'Status',
  Aktionen: 'Actions',
  'Shows Ihrer Bands, die andere Agenturen gebucht haben. Sie sind schreibgeschützt und zählen für Terminkonflikte, den Kalender und den Gebietsschutz auf der Karte, aber nie für Rechnungen, Verträge, Abrechnungen, Verteiler oder Wiedervorlagen. Ändern lassen sie sich nur durch einen neuen Import.':
    'Shows of your bands that other agencies have booked. They are read-only and count for date conflicts, the calendar and the radius clauses on the map, but never for invoices, contracts, statements, mailing lists or follow-ups. They can only be changed by a new import.',
  'Agenturbuchungen filtern…': 'Filter agency bookings…',
  'Alle Agenturen': 'All agencies',
  'Agentur entfernen': 'Remove agency',
  Importieren: 'Import',
  geändert: 'changed',
  unverändert: 'unchanged',
  übersprungen: 'skipped',
  'Datei konnte nicht gelesen werden': 'File could not be read',
  'Keine Daten gefunden': 'No data found',
  'Die Datei enthält keine Kopfzeile mit Datenzeilen darunter.':
    'The file contains no header row with data rows below it.',
  'Import fehlgeschlagen': 'Import failed',
  'Agenturbuchungen importieren': 'Import agency bookings',
  'Shows Ihrer Bands, die eine andere Agentur gebucht hat, aus deren Export übernehmen.':
    "Take over shows of your bands that another agency has booked from that agency's export.",
  'Agentur angeben und die Spalten prüfen. Band und Datum sind Pflicht; die Band muss angelegt sein.':
    'Enter the agency and check the columns. Band and date are required; the band must exist.',
  'Bekannte Buchungen (gleiche Agentur und Buchungs-Nr., sonst Band, Datum und Ort) werden aktualisiert.':
    'Known bookings (same agency and booking no., otherwise band, date and city) are updated.',
  'Der Import ist abgeschlossen.': 'The import is complete.',
  'Eine Zeile pro Show, mit Spalten wie Band, Datum, Club, PLZ, Ort und Status. Agenturbuchungen sind schreibgeschützt: Sie zählen für Terminkonflikte und den Gebietsschutz, aber nie für Rechnungen, Verträge, Abrechnungen, Verteiler oder Wiedervorlagen. Excel-Dateien (.xlsx, erstes Blatt) und CSV gehen direkt.':
    'One row per show, with columns such as band, date, club, postcode, city and status. Agency bookings are read-only: they count for date conflicts and radius clauses, but never for invoices, contracts, statements, mailing lists or follow-ups. Excel files (.xlsx, first sheet) and CSV work directly.',
  'Datei wird gelesen…': 'Reading file…',
  'Datei auswählen…': 'Choose file…',
  'Name der Agentur': 'Name of the agency',
  'Art, wenn keine angegeben': 'Type, if none is given',
  Datei: 'File',
  Zeile: 'Row',
  Zeilen: 'Rows',
  'Agentur und Zuordnung vom letzten Import eines Exports mit diesen Spalten übernommen.':
    'Agency and mapping taken over from the last import of an export with these columns.',
  'Noch keine Spalte für:': 'No column yet for:',
  Spalte: 'Column',
  Beispielwerte: 'Sample values',
  'Übernehmen als': 'Take over as',
  '(ohne Überschrift)': '(no heading)',
  'Spalte {{columnLetter}} übernehmen als': 'Take over column {{columnLetter}} as',
  Neu: 'New',
  Geändert: 'Changed',
  Unverändert: 'Unchanged',
  Übersprungen: 'Skipped',
  'Buchung dieser Agentur steht nicht mehr in der Datei – entfernen':
    'Booking of this agency is no longer in the file – remove',
  'Buchungen dieser Agentur stehen nicht mehr in der Datei – entfernen':
    'Bookings of this agency are no longer in the file – remove',
  'Vorschau wird erstellt…': 'Creating preview…',
  Import: 'Import',
  'neu ·': 'new ·',
  'aktualisiert ·': 'updated ·',
  'Andere Datei': 'Other file',
  'Weiter zur Vorschau': 'Continue to preview',
  Zurück: 'Back',
  'Wird importiert…': 'Importing…',
  Schließen: 'Close'
}
