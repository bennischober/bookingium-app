# UI language

The app is German-only, with no i18n framework: user-visible strings are plain
German literals. Code, identifiers, comments, commit messages and docs are
English.

## Rules

1. **Never translate stored values.** Enum and database values stay as they
   are (`draft`, `issued`, `paid`, `overdue`, `cancelled`, `confirmed`,
   `pending`, `venue`, `festival`, `company`, `band`, `person`, `other`,
   document types like `contract`/`rider`, tax codes like `standard`/
   `reverse_charge`, …). Show them through label maps (`STATUS_LABELS`,
   `VENUE_KIND_LABELS`, `DOCUMENT_TYPE_LABELS`, …).
2. **Translate everything a user reads:** button texts, labels, table
   headers, placeholders, toasts, confirm dialogs, empty states, `title` and
   `aria-label` attributes.
3. **Keep the domain's anglicisms:** Event, Band, Booking, Deal, Deal Memo,
   Rider, Stageplot, Showtime, Local Promoter.
4. **Exception:** the English agency invoice template (`AgencyEnTemplate` in
   `InvoiceDocument.tsx`) stays English.
5. Formal address ("Sie"), German typography: „Anführungszeichen“, `…`, `–`.

## Glossary

### Navigation and general

| English                               | German                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| Settings                              | Einstellungen                                            |
| Venues                                | Spielstätten                                             |
| Persons / Companies / Banks           | Personen / Firmen / Banken                               |
| Search everything                     | Alles suchen                                             |
| Back / Forward                        | Zurück / Vorwärts                                        |
| Create / New / Add                    | Anlegen / Neu / Hinzufügen                               |
| Edit / Delete / Save / Cancel / Close | Bearbeiten / Löschen / Speichern / Abbrechen / Schließen |
| Actions                               | Aktionen                                                 |
| 311 venues / found / loaded           | 311 Spielstätten / … gefunden / … geladen                |
| Import / Export / Backup              | Importieren / Exportieren / Sicherung                    |
| Print / Save as PDF                   | Drucken / Als PDF speichern                              |
| Notes                                 | Anmerkungen                                              |
| Loading …                             | … wird geladen / Lädt …                                  |
| No results                            | Keine Treffer / Keine Ergebnisse gefunden                |

### People and organisations

| English                                     | German                                              |
| ------------------------------------------- | --------------------------------------------------- |
| Venue / Festival (venue kind)               | Spielstätte / Festival                              |
| Promoter (company behind a venue)           | Veranstalter                                        |
| Contact person                              | Ansprechpartner                                     |
| Members (band)                              | Mitglieder                                          |
| Technical lead                              | Technischer Leiter (TL)                             |
| Management company ("represented by")       | Management (vertreten durch)                        |
| Own company (issues invoices)               | Eigene Firma                                        |
| VAT id / tax number                         | USt-IdNr. / Steuernummer                            |
| Street / No. / ZIP / City / State / Country | Straße / Hausnummer / PLZ / Ort / Bundesland / Land |
| Email / Phone / Mobile / Website            | E-Mail / Telefon / Mobil / Website                  |
| Founded / Capacity                          | Gründung / Kapazität                                |

### Events and documents

| English                                       | German                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| Overview / Itinerary / Financials / Documents | Übersicht / Tagesablauf / Finanzen / Dokumente                          |
| Status confirmed / pending / cancelled        | Bestätigt / Ausstehend / Storniert                                      |
| Concert contract                              | Vertrag (Auftrittsvertrag)                                              |
| Management contract / management share        | Managementvertrag / Managementbeteiligung                               |
| Document types                                | Deal Memo, Vertrag, Rider, Stageplot, Presse, Foto, Rechnung, Sonstiges |
| Show in folder / Open folder                  | Im Ordner anzeigen / Ordner öffnen                                      |

### Invoices

| English                                            | German                                                         |
| -------------------------------------------------- | -------------------------------------------------------------- |
| Invoice / invoice number                           | Rechnung / Rechnungsnr.                                        |
| Issuer / recipient                                 | Rechnungssteller / Rechnungsempfänger                          |
| Status draft / issued / paid / overdue / cancelled | Entwurf / gestellt / bezahlt / überfällig / storniert (Storno) |
| Issue date / due date / period                     | Rechnungsdatum / Fällig / Zeitraum                             |
| Line items                                         | Positionen                                                     |
| Net / VAT / gross                                  | Netto / MwSt. (USt.) / Brutto                                  |
| Payment terms                                      | Zahlungsbedingungen                                            |
| Invoice numbering                                  | Rechnungsnummerierung                                          |
