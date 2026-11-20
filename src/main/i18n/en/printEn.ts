// #254: English UI texts of print, keyed by the German source string (see ../translate.ts)

export const printEn: Record<string, string> = {
  Ausland: 'Abroad',
  'Firma in der EU mit USt-IdNr.: Üblich ist der Steuerschlüssel „Reverse Charge“ statt deutscher USt.':
    'Company in the EU with VAT ID: the usual tax code is “Reverse charge” instead of German VAT.',
  'Empfänger außerhalb der EU: Üblich ist der Steuerschlüssel „nicht steuerbar“ statt deutscher USt.':
    'Recipient outside the EU: the usual tax code is “not taxable” instead of German VAT.',
  'Empfänger in der EU ohne USt-IdNr.: Für „Reverse Charge“ braucht es die USt-IdNr. des Empfängers.':
    "Recipient in the EU without VAT ID: “Reverse charge” needs the recipient's VAT ID.",
  'Hinweis zur Rechnung ins Ausland': 'Note on the invoice abroad',
  'Rechnung ins Ausland (': 'Invoice abroad (',
  '„Reverse Charge“ ist gewählt, aber beim Empfänger fehlt die USt-IdNr. Sie gehört auf die Rechnung.':
    "“Reverse charge” is chosen, but the recipient's VAT ID is missing. It belongs on the invoice.",
  'Für diesen Empfänger bietet sich eine englische Rechnung an.':
    'An English invoice suits this recipient.',
  'Englisch verwenden': 'Use English',
  'Nur ein Hinweis, die App ändert nichts selbst. Welcher Steuerschlüssel gilt, entscheidet Ihr Steuerberater.':
    'Only a hint; the app changes nothing by itself. Your tax advisor decides which tax code applies.',
  'Deutsch (DE)': 'German (DE)',
  'Englisch (EN)': 'English (EN)',
  'Sprache des Dokuments': 'Document language',
  'PDF konnte nicht gespeichert werden': 'PDF could not be saved',
  'PDF ohne E-Rechnung gespeichert': 'PDF saved without e-invoice',
  'Für die E-Rechnung fehlt: {{missing}}': 'Missing for the e-invoice: {{missing}}',
  'PDF mit E-Rechnung gespeichert': 'PDF saved with e-invoice',
  'PDF gespeichert – Entwurf, ohne E-Rechnung': 'PDF saved – draft, without e-invoice',
  'PDF gespeichert': 'PDF saved',
  'Als PDF speichern': 'Save as PDF',
  'Vertrag wird geladen…': 'Loading contract…',
  'Vertrag nicht gefunden.': 'Contract not found.',
  'XRechnung konnte nicht gespeichert werden': 'XRechnung could not be saved',
  'XRechnung gespeichert': 'XRechnung saved',
  'XRechnung (XML)': 'XRechnung (XML)',
  'In DATEV erstellt': 'Created in DATEV'
}
