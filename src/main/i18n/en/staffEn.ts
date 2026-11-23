// #262: English UI texts of employees and grants (components/staff, settings/EmployeesCard),
// keyed by the German source string (see ../translate.ts)

export const staffEn: Record<string, string> = {
  // Grants on the detail pages
  'Alle Mitarbeiter': 'All staff',
  'Freigabe konnte nicht gespeichert werden': 'Sharing could not be saved',
  Freigegeben: 'Shared',
  'Freigegeben, mit Events und Booking': 'Shared, with events and booking',
  'Für Mitarbeiter freigeben': 'Share with staff',
  Intern: 'Internal',
  'Mitarbeiter bekommen nur, was hier freigegeben ist. Änderungen gehen mit dem nächsten Abgleich hinaus.':
    'Staff only get what is shared here. Changes go out with the next sync.',
  'Sieht es': 'Sees it',
  'Sieht es nicht': 'Does not see it',
  'sieht es': 'sees it',
  'sieht es nicht': 'does not see it',
  'Standard: intern': 'Default: internal',
  'Standard: nur die Band als Kontakt': 'Default: only the band as a contact',
  'Standard: wie das Event': 'Default: like the event',
  'Standard: wie die Band': 'Default: like the band',
  'Wie für alle': 'Same as for all',
  '{{seeing}} von {{total}} Mitarbeitern sehen das': '{{seeing}} of {{total}} staff see this',
  'Im Mitarbeiterzugang bleiben Rechnungen Entwürfe; gestellt werden sie von einem Admin.':
    'In staff access, invoices stay drafts; an admin issues them.',
  // Einstellungen › Daten › Mitarbeiter
  'Jeder Mitarbeiter bekommt einen eigenen Abgleich-Ordner, den dieser Computer nur mit freigegebenen Daten füllt: alle Kontakte, die Events freigegebener Bands und was einzeln freigegeben ist. Rechnungen legt er nur als Entwurf an, löschen kann er nur Eigenes.':
    'Each staff member gets a sync folder of their own, which this computer fills with shared data only: all contacts, the events of shared bands and whatever is shared individually. They create invoices as drafts only and can only delete their own entries.',
  'Noch keine Mitarbeiter.': 'No staff yet.',
  'Mitarbeiter hinzufügen': 'Add staff member',
  'Mitarbeiter hinzufügen…': 'Add staff member…',
  'Mitarbeiter konnte nicht entfernt werden': 'Staff member could not be removed',
  'Mitarbeiter konnte nicht hinzugefügt werden': 'Staff member could not be added',
  'Zugang entziehen': 'Revoke access',
  'Zugang entzogen': 'Access revoked',
  'Zugang entzogen am {{date}}': 'Access revoked on {{date}}',
  'Zugang konnte nicht entzogen werden': 'Access could not be revoked',
  'Zugang von {{name}} entziehen?': 'Revoke access for {{name}}?',
  'Der Ordner wird nicht mehr befüllt, und Bookingium entfernt die Daten der Firma beim nächsten Abgleich vom Computer des Mitarbeiters. Was er angelegt hat, bleibt hier erhalten.':
    "The folder is no longer filled, and Bookingium removes the company's data from the staff member's computer at the next sync. What they created stays here.",
  'Wird von einem anderen Computer der Firma bedient.':
    "Served by another of the company's computers.",
  'Wartet darauf, dass der Mitarbeiter dem Ordner auf seinem Computer beitritt.':
    'Waiting for the staff member to join the folder on their computer.',
  Verbunden: 'Connected',
  'Verbunden, zuletzt geändert am {{date}}': 'Connected, last change on {{date}}',
  '{{name}} hinzugefügt': '{{name}} added',
  'Jetzt den Ordner mit dem Mitarbeiter teilen. Auf seinem Computer: Einstellungen › Daten › Abgleich › diesen Ordner wählen und beitreten.':
    'Now share the folder with the staff member. On their computer: Settings › Data › Sync › choose this folder and join.',
  'Wählen Sie einen leeren Ordner, den Sie mit dem Mitarbeiter teilen (OneDrive, Dropbox, Google Drive) – nicht den Abgleich-Ordner der Firma.':
    "Choose an empty folder that you share with the staff member (OneDrive, Dropbox, Google Drive) – not the company's sync folder.",
  'Noch kein Ordner gewählt': 'No folder chosen yet',
  'Wählen…': 'Choose…',
  'Wird eingerichtet…': 'Setting up…'
}
