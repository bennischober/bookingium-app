// English UI texts of the booking archive import (components/archive), keyed by the German
// source string (see ../translate.ts)

export const archiveEn: Record<string, string> = {
  'Booking-Archiv': 'Booking archive',
  'Booking-Archiv einlesen': 'Read booking archive',
  'Alte Booking-Ordner einer Band auf einmal: je Show ein Ordner. Events, Festivals und Firmen werden gefunden oder angelegt, bestehende nur in leeren Feldern ergänzt. Pässe, Tickets und Kopien werden nie abgelegt.':
    "A band's old booking folders at once: one folder per show. Events, festivals and companies are found or created; existing ones only get their empty fields filled. Passports, tickets and copies are never filed.",
  'Band wählen…': 'Choose band…',
  'Der Ordner mit den Show-Ordnern (auch mit Jahres-Ordnern dazwischen) oder ein einzelner Show-Ordner':
    'The folder with the show folders (year folders in between are fine) or a single show folder',
  'Verträge und Rechnungen ablegen': 'File contracts and invoices',
  'Vertrag und eigene Rechnung kommen zu den Dokumenten des Events, alles andere wird nur gelesen.':
    "The contract and your own invoice go to the event's documents; everything else is only read.",
  'Nur Daten auslesen: Es wird nichts abgelegt, die Ordner bleiben, wo sie sind.':
    'Only read the data: nothing is filed, the folders stay where they are.',
  'Ordner einlesen': 'Read folder',
  'Sucht Show-Ordner…': 'Looking for show folders…',
  'Ordner konnte nicht gelesen werden': 'The folder could not be read',
  'Shows im Archiv': 'Shows in the archive',
  Dateien: 'Files',
  'Festival / Club': 'Festival / club',
  'Rechnung an': 'Invoice to',
  'Datum von {{name}}': 'Date of {{name}}',
  'Name des neuen Events': 'Name of the new event',
  'bis {{date}}': 'until {{date}}',
  neu: 'new',
  vorhanden: 'existing',
  'Wird gelesen…': 'Reading…',
  'Liest Ordner … noch {{count}}': 'Reading folders … {{count}} left',
  '{{name}} übernehmen': 'Take over {{name}}',
  '{{total}} Dateien': '{{total}} files',
  '{{count}} Vertrag/Rechnung': '{{count}} contract/invoice',
  '{{count}} Reiseunterlagen': '{{count}} travel papers',
  '{{count}} doppelt': '{{count}} duplicate',
  '{{count}} ohne lesbaren Text': '{{count}} without readable text',
  '{{count}} Shows übernehmen': 'Take over {{count}} shows',
  'Übernimmt… {{done}} von {{total}}': 'Taking over… {{done}} of {{total}}',
  '{{changes}} Änderungen, {{documents}} Dokumente': '{{changes}} changes, {{documents}} documents',
  '{{done}} Shows übernommen, davon {{created}} Events neu angelegt.':
    '{{done}} shows taken over, {{created}} of them as new events.',
  '{{count}} nicht übernommen.': '{{count}} not taken over.',
  'Früher eingelesene Shows korrigieren': 'Correct shows read before',
  'Shows, die das Booking-Archiv schon einmal angelegt hat, werden neu gelesen: Festival, Veranstalter und Rechnungsfirma werden neu zugeordnet, wenn der Import sie angelegt hat, Name, Tagesablauf und Deal ersetzt. Was danach nichts mehr nutzt, wird entfernt. Eigene Einträge bleiben, auch Änderungen von Hand an diesen Shows werden aber überschrieben.':
    'Shows the booking archive created before are read again: festival, promoter and billing company are assigned anew when the import created them, name, schedule and deal are replaced. What nothing uses any more is removed. Your own records stay, but manual changes to these shows are overwritten too.',
  'Bestehende Shows werden nur in leeren Feldern ergänzt.':
    'Existing shows only get their empty fields filled.',
  'wird korrigiert': 'will be corrected',
  '{{count}} korrigiert, {{removed}} alte Einträge entfernt.':
    '{{count}} corrected, {{removed}} old records removed.',
  // show file kinds (showfolder/extract.ts)
  'Reiseunterlagen (nicht abgelegt)': 'Travel papers (not filed)'
}
