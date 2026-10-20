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
| Settings tabs                         | Allgemein / Rechnungen / E-Mail / Kalender / Daten       |
| Defaults (general settings card)      | Voreinstellungen                                         |
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
| A person's memberships / roles              | Zugehörigkeiten / Rollen                            |
| Member of / assigned to (person page)       | Mitglied in / Zugehörig zu                          |
| Add to band / company / venue               | Zur Band / Firma / Spielstätte hinzufügen           |
| Technical lead                              | Technischer Leiter (TL)                             |
| LoPro contact / TL of the band (event role) | LoPro-Kontakt / TL der Band                         |
| Contract role member / representative       | Mitglied / Bevollmächtigt                           |
| Management company ("represented by")       | Management (vertreten durch)                        |
| Own company (issues invoices)               | Eigene Firma                                        |
| VAT id / tax number                         | USt-IdNr. / Steuernummer                            |
| Street / No. / ZIP / City / State / Country | Straße / Hausnummer / PLZ / Ort / Bundesland / Land |
| Email / Phone / Mobile / Website            | E-Mail / Telefon / Mobil / Website                  |
| Founded / Capacity                          | Gründung / Kapazität                                |
| Genres (venue tags, comma-separated)        | Genres                                              |

### Mailing lists

| English                            | German                                    |
| ---------------------------------- | ----------------------------------------- |
| Mailing list                       | Verteiler                                 |
| New / saved mailing list           | Neuer Verteiler / gespeicherter Verteiler |
| Opted out of advertising           | Keine Werbung                             |
| Take back in (after opting out)    | Wieder aufnehmen                          |
| Recipient (filter)                 | Empfänger                                 |
| Booked / never booked              | Schon gebucht / Noch nie gebucht          |
| Write email (BCC) / Copy addresses | E-Mail schreiben / Adressen kopieren      |
| Export CSV                         | CSV exportieren                           |

### Follow-ups

| English                          | German                                      |
| -------------------------------- | ------------------------------------------- |
| Follow-up / new follow-up        | Wiedervorlage / Neue Wiedervorlage          |
| Due on / note                    | Fällig am / Notiz                           |
| Overdue since / today / tomorrow | Überfällig seit / Heute / Morgen            |
| Done (tick off) / undo           | Erledigt / Rückgängig                       |
| General (not on a record)        | Allgemein                                   |
| Quick picks                      | Morgen, In 3 Tagen, In 1 Woche, In 2 Wochen |

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

| English                                            | German                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| Invoice / invoice number                           | Rechnung / Rechnungsnr.                                           |
| Issuer / recipient                                 | Rechnungssteller / Rechnungsempfänger                             |
| Status draft / issued / paid / overdue / cancelled | Entwurf / gestellt / bezahlt / überfällig / storniert (Storno)    |
| Issue date / due date / period                     | Rechnungsdatum / Fällig / Zeitraum                                |
| Line items                                         | Positionen                                                        |
| Net / VAT / gross                                  | Netto / MwSt. (USt.) / Brutto                                     |
| Payment terms                                      | Zahlungsbedingungen                                               |
| Invoice numbering                                  | Rechnungsnummerierung                                             |
| E-invoice (ZUGFeRD)                                | E-Rechnung                                                        |
| What the e-invoice still needs                     | Für die E-Rechnung fehlt: …                                       |
| Buyer reference / routing id                       | Käuferreferenz / Leitweg-ID                                       |
| Tax note (reverse charge, exemption reason)        | Steuerhinweis                                                     |
| Invoice contact person                             | Ansprechpartner für Rechnungen                                    |
| Payment QR code (EPC QR / GiroCode)                | QR-Code zum Bezahlen; on the invoice „Bequem bezahlen“            |
| XRechnung (public-sector buyer)                    | XRechnung (öffentlicher Auftraggeber)                             |
| Send invoice by email                              | Per E-Mail senden; toast „E-Mail in Outlook geöffnet“ etc.        |
| Mail program (setting)                             | Mailprogramm: Automatisch / Outlook (klassisch) / Thunderbird / … |
| Email template placeholders                        | Platzhalter, e.g. {Rechnungsnummer}, {Betrag}, {Absender}         |
| Invoice was emailed                                | E-Mail erstellt am 20.10.2026 an …                                |
| Cancellation invoice (kind `cancellation`)         | Stornorechnung; badge „Storno zu #1040“                           |
| Tax note presets                                   | Reverse Charge / § 4 Nr. 20 a UStG / Nicht steuerbar              |
| Unit (`service`, `piece`, `hour`, `day`, …)        | Einheit (Pauschale, Stück, Stunde, Tag, Monat, Kilometer)         |
| Tax code (`TAX_CODE_LABELS`)                       | Steuerschlüssel                                                   |
| `standard` / `reduced` / `zero_rated`              | Regelsatz / ermäßigt / Nullsatz                                   |
| `reverse_charge` / `exempt` / `not_taxable`        | Reverse Charge / steuerfrei / nicht steuerbar                     |
| `intra_community` / `export` / `other`             | innergemeinschaftliche Lieferung / Ausfuhr (Drittland) / sonstig  |
