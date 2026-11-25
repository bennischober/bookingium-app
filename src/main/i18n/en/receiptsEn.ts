// #254: English UI texts of receipts, keyed by the German source string (see ../translate.ts)

export const receiptsEn: Record<string, string> = {
  'Datei kann kein Beleg werden': 'File cannot become a receipt',
  'Beleg konnte nicht gespeichert werden': 'Receipt could not be saved',
  '{{companyName}}: {{length}} Angaben aus der Rechnung':
    '{{companyName}}: {{length}} details from the invoice',
  'Beleg gespeichert': 'Receipt saved',
  'Beleg geändert': 'Receipt changed',
  'Beleg bearbeiten': 'Edit receipt',
  'Beleg speichern': 'Save receipt',
  'Belege gehen unter ihrer Belegart an die DATEV-Adresse der eigenen Firma. Fotos werden als PDF gespeichert.':
    "Receipts go to the own company's DATEV address under their receipt type. Photos are saved as PDF.",
  'wird als PDF gespeichert': 'saved as PDF',
  'aus dem PDF gelesen, bitte prüfen': 'read from the PDF, please check',
  Dateiname: 'File name',
  'Unter diesem Namen erscheint der Beleg in DATEV.':
    'The receipt appears in DATEV under this name.',
  Belegart: 'Receipt type',
  'Eigene Firma': 'Own company',
  'Unverändert ({{value}})': 'Unchanged ({{value}})',
  'Standardfirma{{value}}': 'Default company{{value}}',
  Belegdatum: 'Receipt date',
  'Betrag (brutto)': 'Amount (gross)',
  'Lieferant (Firma)': 'Supplier (company)',
  'Keine Firma': 'No company',
  'Lieferant (Name, falls abweichend)': 'Supplier (name, if different)',
  'Lieferant (Name)': 'Supplier (name)',
  'z. B. Deutsche Bahn': 'e.g. Deutsche Bahn',
  'Rechnungs- / Belegnummer': 'Invoice / receipt number',
  'Der Rechnungssteller ist noch keine Firma in Bookingium.':
    'The invoicing party is not yet a company in Bookingium.',
  'Firma aus E-Rechnung anlegen…': 'Create company from e-invoice…',
  'Schon direkt in DATEV hochgeladen': 'Already uploaded directly to DATEV',
  'Der Beleg steht dann nicht mehr unter „Noch nicht an DATEV übergeben“.':
    'The receipt then no longer appears under “Not handed over to DATEV yet”.',
  'Bitte einen Dateinamen angeben': 'Please enter a file name',
  'Der Betrag ist keine Zahl': 'The amount is not a number',
  'Bitte ein gültiges Datum angeben': 'Please enter a valid date',
  'Währung mit 3 Buchstaben (z. B. EUR)': 'Currency with 3 letters (e.g. EUR)',
  'Nicht an DATEV übergeben': 'Not handed over to DATEV',
  'Belege noch nicht an DATEV übergeben': 'Receipts not handed over to DATEV yet',
  'Alle Belege': 'All receipts'
}
