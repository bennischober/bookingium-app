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
   Write the ellipsis as one character (`Suchen…`, `Lädt…`, „Zuordnen…“), never
   three dots; `...` stays only in code (spread syntax).

## Glossary

### Navigation and general

| English                               | German                                                   |
| ------------------------------------- | -------------------------------------------------------- |
| Settings                              | Einstellungen                                            |
| Settings tabs                         | Allgemein / Rechnungen / E-Mail / Kalender / Daten       |
| Defaults (general settings card)      | Voreinstellungen                                         |
| Venues (two lists, by venue kind)     | Clubs / Festivals                                        |
| Persons / Companies / Banks           | Personen / Firmen / Banken                               |
| Search everything                     | Alles suchen                                             |
| Back / Forward                        | Zurück / Vorwärts                                        |
| Create / New / Add                    | Anlegen / Neu / Hinzufügen                               |
| Edit / Delete / Save / Cancel / Close | Bearbeiten / Löschen / Speichern / Abbrechen / Schließen |
| Actions                               | Aktionen                                                 |
| 311 clubs / found / loaded            | 311 Clubs / … gefunden / … geladen                       |
| Import / Export / Backup              | Importieren / Exportieren / Sicherung                    |
| Automatic backup / Restore            | Automatische Sicherung / Wiederherstellen                |
| Print / Save as PDF                   | Drucken / Als PDF speichern                              |
| Notes                                 | Anmerkungen                                              |
| Loading …                             | … wird geladen / Lädt …                                  |
| No results                            | Keine Treffer / Keine Ergebnisse gefunden                |

### People and organisations

| English                                     | German                                              |
| ------------------------------------------- | --------------------------------------------------- |
| Venue / Festival (venue kind)               | Club / Festival                                     |
| Any venue, either kind (not „Spielstätte“)  | Club / Festival, Clubs und Festivals                |
| Promoter (company behind a venue)           | Veranstalter                                        |
| Contact person                              | Ansprechpartner                                     |
| Members (band)                              | Mitglieder                                          |
| A person's memberships / roles              | Zugehörigkeiten / Rollen                            |
| Member of / assigned to (person page)       | Mitglied in / Zugehörig zu                          |
| Add to band / company / venue               | Zur Band / Firma / Zu Club / Festival hinzufügen    |
| Technical lead                              | Technischer Leiter (TL)                             |
| LoPro contact / TL of the band (event role) | LoPro-Kontakt / TL der Band                         |
| Contract role member / representative       | Mitglied / Bevollmächtigt                           |
| Management company ("represented by")       | Management (vertreten durch)                        |
| Own company (issues invoices)               | Eigene Firma                                        |
| VAT id / tax number                         | USt-IdNr. / Steuernummer                            |
| Street / No. / ZIP / City / State / Country | Straße / Hausnummer / PLZ / Ort / Bundesland / Land |
| Email / Phone / Mobile / Website            | E-Mail / Telefon / Mobil / Website                  |
| Founded / Capacity                          | Gründung / Kapazität                                |
| Genres (venue/company tags, comma list)     | Genres                                              |

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
| Done history / reopen            | Erledigte Wiedervorlagen / Wieder öffnen    |
| General (not on a record)        | Allgemein                                   |
| Set a follow-up (toast action)   | Wiedervorlage setzen                        |
| Quick picks                      | Morgen, In 3 Tagen, In 1 Woche, In 2 Wochen |
| Follow-up on send (compose)      | Wiedervorlage ohne Antwort                  |
| Filed / not filed (send toast)   | Wiedervorlage angelegt / nicht angelegt     |
| Due, no reply came               | Keine Antwort                               |
| Closed by a reply (history)      | Antwort erhalten am …                       |

### Events and documents

| English                                       | German                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| Overview / Itinerary / Financials / Documents | Übersicht / Tagesablauf / Finanzen / Dokumente                                      |
| Status confirmed / pending / cancelled        | Bestätigt / Ausstehend / Storniert                                                  |
| Concert contract                              | Vertrag (Auftrittsvertrag)                                                          |
| Management contract / management share        | Managementvertrag / Managementbeteiligung                                           |
| Document types                                | Deal Memo, Vertrag, Rider, Stageplot, Presse, Foto, Rechnung, Abrechnung, Sonstiges |
| Show settlement (from the Veranstalter)       | Abrechnung                                                                          |
| Show in folder / Open folder                  | Im Ordner anzeigen / Ordner öffnen                                                  |
| Event from a mail (reader toolbar)            | Event aus dieser Mail anlegen                                                       |
| Unknown sender as LoPro person (wizard)       | Absender als Person anlegen                                                         |
| Mail linked to the new event (toast)          | Mail dem Event zugeordnet; action „Event öffnen“                                    |

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
| Send contract by email (language of the email)     | Per E-Mail senden; Sprache der E-Mail: Deutsch / Englisch         |
| Mail program (setting)                             | Mailprogramm: Automatisch / Outlook (klassisch) / Thunderbird / … |
| Email template placeholders                        | Platzhalter, e.g. {Rechnungsnummer}, {Betrag}, {Absender}         |
| Invoice was emailed                                | E-Mail erstellt am 20.10.2026 an …                                |
| Open an invoice (Dashboard, management share)      | Rechnung öffnen; page header „Per E-Mail senden…“ (to print page) |
| Invoice history on its page                        | Verlauf                                                           |
| History entries                                    | Angelegt / Gestellt / E-Mail erstellt / Als bezahlt markiert      |
| History entries (cont.)                            | Als überfällig markiert / Wieder offen (gestellt) / Storniert     |
| Payment reminder / dunning letter                  | Zahlungserinnerung / Mahnung (2. Mahnung, …)                      |
| Offer the next one (page header, Dashboard)        | Zahlungserinnerung senden… / Mahnung senden…                      |
| Its button on the print page                       | Zahlungserinnerung per E-Mail senden / Mahnung per E-Mail senden  |
| Dashboard card / overdue since                     | Überfällige Rechnungen / Fällig seit 14.10.2026                   |
| Payment deadline in the reminder text              | Frist ({Frist}: in 7 Tagen)                                       |
| History entries for reminders                      | Zahlungserinnerung erstellt / Mahnung erstellt                    |
| Stornorechnung's first entry                       | Gestellt als Storno zu Rechnung #1040                             |
| Back to the list from a detail page                | Alle Rechnungen (Alle Firmen, …)                                  |
| Draft sheet title                                  | Entwurf bearbeiten                                                |
| Cancellation invoice (kind `cancellation`)         | Stornorechnung; badge „Storno zu #1040“                           |
| Tax note presets                                   | Reverse Charge / § 4 Nr. 20 a UStG / Nicht steuerbar              |
| Unit (`service`, `piece`, `hour`, `day`, …)        | Einheit (Pauschale, Stück, Stunde, Tag, Monat, Kilometer)         |
| Tax code (`TAX_CODE_LABELS`)                       | Steuerschlüssel                                                   |
| `standard` / `reduced` / `zero_rated`              | Regelsatz / ermäßigt / Nullsatz                                   |
| `reverse_charge` / `exempt` / `not_taxable`        | Reverse Charge / steuerfrei / nicht steuerbar                     |
| `intra_community` / `export` / `other`             | innergemeinschaftliche Lieferung / Ausfuhr (Drittland) / sonstig  |

### Mail templates

| English                                | German                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| Mail templates (settings card)         | E-Mail-Vorlagen                                                                      |
| Fixed texts / own templates (sections) | Für Rechnungen und Verträge / Eigene Vorlagen                                        |
| Reset a fixed text                     | Zurücksetzen; „Standardtext wiederherstellen?“                                       |
| Sending account (settings card)        | Per E-Mail senden; „Senden von“                                                      |
| No sending account (toast action)      | Zum Senden zuerst ein E-Mail-Konto hinzufügen. / Einstellungen öffnen                |
| New / edit / add template              | Neue Vorlage / Vorlage bearbeiten / Vorlage hinzufügen…                              |
| Insert template (compose toolbar)      | Vorlage einfügen; button „Einfügen“                                                  |
| Event for the placeholders / no event  | Event für die Platzhalter / Ohne Event                                               |
| Placeholders                           | {Event}, {Datum}, {Beginn}, {Band}, {Veranstaltungsort}, {Ort}, {LoPro}, {Empfänger} |
