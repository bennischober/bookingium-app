# UI-Language Migration: English → German (binding glossary)

Goal: All user-visible strings in the renderer become German. This app is German-only by decision; NO i18n framework — plain inline literals.

## Absolute rules (violations = regression)

1. DO NOT translate stored enum/DB values: `draft`, `issued`, `paid`, `overdue`, `cancelled`, `confirmed`, `pending`, `company`, `band`, `person`, `other`, `deal_memo`, `contract`, `rider`, `invoice`, `standard`, `reduced`, `reverse_charge`, `exempt`, `service`, etc. These are data. Only display labels change (use label maps where a value is rendered, e.g. STATUS_STYLES-style records or ternaries).
2. DO NOT touch: code identifiers, import paths, tRPC route names, CSS classes/Tailwind classes, HTML attributes except `title`/`placeholder`/`aria-label`/`lang`, locale args (`'de-DE'`, `'EUR'`), the AgencyEnTemplate strings in InvoiceDocument.tsx (stays English), AgencyDeTemplate strings (already German).
3. Keep formatting/style: Prettier single quotes, same line-break style, no reordering of props/fields. Change ONLY the strings.
4. `routing.ts` titles keep their emoji prefix; translate the word after it (`'📊 Dashboard'` stays, `'🎸 Events'` stays `Events`, `'📍 Venues'` → `'📍 Spielstätten'` etc.). Group names and breadcrumb labels also German. These titles are used by sidebar AND breadcrumbs AND search — one source.
5. `src/renderer/index.html`: `lang="de"`, `<title>Bookingium</title>`.
6. Toast messages, `confirm()` dialogs, placeholders, button texts, table headers, form labels, empty-state texts, loading texts → German.
7. Do not rename files/components/variables. Do not refactor logic. Strings only.
8. If a string is ambiguous, prefer the music-industry German term used in the glossary; keep common anglicisms the domain uses (Event, Band, Rider, Deal Memo, Booking).

## Binding glossary

### Navigation / layout

- Dashboard → Dashboard
- Calendar → Kalender
- Events → Events
- Invoices → Rechnungen
- Bands → Bands
- Venues → Spielstätten
- Hotels → Hotels
- Persons → Personen
- Companies → Firmen
- Banks → Banken
- Master Data → Stammdaten
- Directory → Verzeichnis
- Production → Produktion
- Main Menu → Hauptmenü
- Home → Start
- Search anything / Search… → Alles suchen / Suchen…
- Recent commands → Letzte Befehle
- Theme / Light / Dark / System → Farbschema / Hell / Dunkel / System
- Settings → Einstellungen

### Generic actions

- Create / New / Add → Anlegen / Neu / Hinzufügen
- Edit → Bearbeiten
- Delete → Löschen
- Save → Speichern
- Cancel → Abbrechen
- Close → Schließen
- Back → Zurück
- Confirm → Bestätigen
- Are you sure…? → Sind Sie sicher…?
- Loading… → Lädt…
- No data yet / empty states → Noch keine Einträge / Keine Daten vorhanden
- Actions → Aktionen
- Search / Filter… → Suchen / Filtern…
- Page X of Y → Seite X von Y
- Print / Save as PDF → Drucken / Als PDF speichern

### Invoice domain

- Invoice → Rechnung
- Invoices → Rechnungen
- Invoice Number / Invoice # → Rechnungsnr.
- Issuer → Rechnungssteller
- Recipient → Rechnungsempfänger
- Who gets the money? (Issuer — their bank details & footer appear on the invoice) → Wer bekommt das Geld? (Rechnungssteller – dessen Bankdaten und Fußzeile erscheinen auf der Rechnung)
- Who gets billed? (Recipient — they pay this invoice) → Wer wird belastet? (Rechnungsempfänger – zahlt diese Rechnung)
- Recipient Type → Empfängertyp
- Issuing Company → Rechnungssteller
- Auto (event/default) → Auto (Event/Standard)
- No explicit override → Keine explizite Auswahl
- Auto fallback → Automatisch
- Invoice created/updated/deleted → Rechnung erstellt/aktualisiert/gelöscht
- Failed to create/update/delete invoice → Rechnung konnte nicht erstellt/aktualisiert/gelöscht werden
- Invoice numbering → Rechnungsnummerierung
- Next invoice number → Nächste Rechnungsnummer
- Company (settings context) → Firma
- Select company → Firma auswählen
- Invoice numbering updated → Rechnungsnummerierung aktualisiert
- Next invoice number must be an integer >= 1 → Nächste Rechnungsnummer muss eine ganze Zahl ≥ 1 sein
- Select a company first → Bitte zuerst eine Firma auswählen
- Status / Stage → Status
- draft → Entwurf (label only!)
- issued → gestellt (label only!)
- paid → bezahlt (label only!)
- overdue → überfällig (label only!)
- cancelled → storniert (label only!)
- Period → Zeitraum
- Event → Event
- Issued →gestellt (column header for issue date: Datum)
- Total → Gesamt
- Total (amount) column → Betrag
- Line items → Positionen
- Add line / Add position → Position hinzufügen
- Description → Beschreibung
- Quantity → Menge
- Unit → Einheit
- Net → Netto
- Gross → Brutto
- VAT → MwSt.
- VAT % → MwSt. %
- Tax rate → Steuersatz
- Tax code (labels only): standard → Regelsatz, reduced → ermäßigt, reverse_charge → Reverse Charge, exempt → steuerfrei, other → sonstig
- Payment terms → Zahlungsbedingungen
- Reverse charge note → Reverse-Charge-Hinweis
- Notes → Anmerkungen
- Issue date → Rechnungsdatum
- Due date → Fälligkeitsdatum
- Recipient kind labels (only): company → Firma, band → Band, person → Person, other → Sonstige
- Currency → Währung
- Please enter a line description → Bitte eine Positionsbeschreibung eingeben
- Please select a recipient band → Bitte eine Empfänger-Band auswählen
- Please select a recipient person → Bitte eine Empfänger-Person auswählen
- Please enter a recipient name → Bitte einen Empfängernamen eingeben
- Invoice not found → Rechnung nicht gefunden
- Back to invoices → Zurück zu den Rechnungen
- Loading invoice… → Rechnung wird geladen…
- Standard template label → Standard
- BMM / Agency (German) → Agentur (Deutsch)
- PWW / Agency (English) → Agentur (Englisch)

### Standard invoice template (rendered document, becomes German)

- INVOICE → RECHNUNG
- No. → Nr.
- Date: → Datum:
- Due: → Fällig:
- From → Rechnungssteller
- Bill to → Rechnungsempfänger
- Service period → Leistungszeitraum
- Subtotal (net) → Zwischensumme (netto)
- Payment terms: → Zahlungsbedingungen:
- Notes: → Anmerkungen:
- Table headers: Pos. / Description / Qty / Unit / Net / VAT % / VAT / Gross → Pos. / Beschreibung / Menge / Einheit / Netto / MwSt. % / MwSt. / Brutto
- IBAN/BIC labels stay

### Event hub / documents

- Overview → Übersicht
- Documents → Dokumente
- Financials → Finanzen
- Itinerary → Tagesablauf
- Select Files → Dateien auswählen
- No documents yet → Noch keine Dokumente
- Upload document(s) → Dokument(e) hochladen
- Document uploaded successfully → Dokument erfolgreich hochgeladen
- Document updated → Dokument aktualisiert
- Document deleted → Dokument gelöscht
- Deal Memo / Contract / Rider / Invoice / Other (doc type LABELS only) → Deal Memo / Vertrag / Rider / Rechnung / Sonstiges
- Open / Reveal in folder → Öffnen / Im Ordner anzeigen
- Confirm deletion: → Soll dieses Dokument wirklich gelöscht werden?
- Event created/updated/deleted → Event erstellt/aktualisiert/gelöscht

### Forms (Band/Person/Company/Bank/Venue/Hotel/Event)

- Company Name _ → Firmenname _
- First name / Last name → Vorname / Nachname
- Birthday → Geburtstag
- Notes → Anmerkungen
- VAT Number → USt-IdNr.
- USt Number → USt-Nr.
- Tax Number (Steuernummer) → Steuernummer
- Commercial Register No. (HR-Nr.) → Registernummer (HR-Nr.)
- Register Court (Amtsgericht) → Registergericht (Amtsgericht)
- Invoice Logo (optional) → Rechnungslogo (optional)
- Choose image... → Bild auswählen…
- Remove → Entfernen
- No logo → Kein Logo
- Bank (Optional) → Bank (optional)
- Street / Street Number / Address Suffix → Straße / Hausnummer / Adresszusatz
- ZIP Code / City / State / Country → PLZ / Stadt / Bundesland / Land
- Email / Phone / Mobile Phone / Homepage → E-Mail / Telefon / Mobil / Homepage
- Genre / Founded → Genre / Gründung
- Capacity → Kapazität
- Person created/updated/deleted → Person erstellt/aktualisiert/gelöscht
- Company created/updated/deleted → Firma erstellt/aktualisiert/gelöscht
- … (same pattern for Band/Bank/Venue/Hotel/Event)
- Failed to … → … konnte nicht … werden
- Loading banks… → Banken werden geladen…
- Loading companies… → Firmen werden geladen…

### Calendar

- Month / Week / Day / Agenda (view tabs if present) → Monat / Woche / Tag / Agenda
- Confirmed / Pending / Cancelled labels → Bestätigt / Ausstehend / Storniert (labels only)
- No events → Keine Events

### Dashboard

- Whatever headline/stats labels exist: translate; keep keys/queries untouched.

## Verification checklist for every file you touch

- [ ] No English remains in user-visible strings (except allowed: AgencyEnTemplate, stored values, domain anglicisms like Event/Band/Rider/Deal Memo)
- [ ] No logic/props/queries changed
- [ ] Typecheck passes for the files' patterns (no renamed identifiers)
