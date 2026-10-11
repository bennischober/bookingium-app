# Fragen & Entscheidungen (autonome Session)

> Für Benjamin: Diese Datei sammelt alles, wo ich deine Eingabe brauche oder
> eine Entscheidung getroffen habe, die du reviewen solltest. Alles andere
> wurde nach bestem Wissen selbstständig umgesetzt und ist commitweise
> reviewbar (`git log`). Session-Ende: 11.10.2026, ca. 15:00 Uhr.

## Entscheidungen, die ich getroffen habe (reviewen)

1. **Seed-Daten dynamisch** — Demo-Events/Rechnungen liegen jetzt relativ zum
   Seed-Tag (+3/+10/+21 Tage etc.), damit Dashboard/Kalender auf frischen DBs
   Inhalte zeigen statt 0en.

2. **`deal`-Feld-Semantik (alte Prompt-Frage 1):** Das Feld ist korrekt —
   Freitext-Deal-Konditionen („70/30"), angezeigt im Finanzen-Tab und im
   Vertrag §2. Strukturierte Werte liegen zusätzlich in
   `guarantee_amount`/`guarantee_vat_rate`. Kein Schema-Change nötig.

3. **Suche (alte Prompt-Frage 2):** On-demand (debounced, >= 2 Zeichen),
   dedicated `search`-Router mit LIKE-Queries auf indizierten Spalten,
   leichte Result-Modelle, 4 Treffer je Objekt / 24 gesamt, Recent Searches
   in localStorage. FTS5 bewusst nicht eingebaut (Datenmengen zu klein;
   bleibt Option). Rechnungen sind jetzt auch durchsuchbar.

4. **InvoicePage-Split** — InvoiceForm (ca. 700 Zeilen) nach
   `components/forms/InvoiceForm.tsx` extrahiert, gemeinsame Helfer nach
   `lib/invoiceLabels.ts`. Seite jetzt 312 Zeilen. Kein Verhaltenswechsel.

5. **Richtlinien dokumentiert** (docs/ARCHITECTURE.md): create/update als
   Standard (upsert nur für 1:1-Companion-Tables), synchrone Transactions,
   explizite UpdateXInput-Schemas (kein `.partial()` wegen Default-Trap),
   `??`-Merge in Updates, DTO-Mapping nur im Router, Label-Maps für
   Enum-Werte, Deutsch nur in UI-Strings, sensible Daten nur in
   internal-seed.json.

## Offene Punkte für dich

1. **Dependabot-PRs auf GitHub schließen** (16 Stück, alle superseded) —
   braucht Web-UI oder gh CLI; ich habe beides nicht. Die 2 moderate Alerts
   (esbuild via drizzle-kit, sprintf-js) sind dokumentierte dev-only-Befunde.

2. **Vertrags-PDF final reviewen** — `pnpm build && npx playwright test`,
   dann `tests/e2e/__screenshots__/contract.pdf` (5 Seiten) und
   `contract.png`. Insbesondere: Seitenumbrüche (wo Sections brechen),
   Schriftgrößen, die Signature-Blöcke (S. 5).

3. **Signaturen-Semantik bestätigen** — aktuell unterschreibt die **Agentur**
   (BMM/Deville) als VP1 (wie im alten Repo der „workplace"). Falls stattdessen
   die Band-Firma (PWW) unterschreiben soll: kurz Bescheid geben (einzeilige
   Änderung).

4. **README + ARCHITECTURE.md gegenlesen** — Ton/Detailtiefe nach deinem
   Geschmack?

5. **Docs/TODOS.md** — ich habe erledigte Punkte abgehakt und offene Punkte
   strukturiert; die alten Prompt-Fragen sind als beantwortet markiert.

## Was ich bewusst NICHT gemacht habe

- Keine Playwright-Visual-Regression mit Baseline-Vergleich (Screenshot-
  Diffing) — lohnt sich erst, wenn das Layout stabil ist
- Kein FTS5 (Datenmengen rechtfertigen es nicht)
- Keine Änderungen außerhalb des Repos (nur die App-eigene
  %APPDATA%-bookingum-app-Datenbank wurde für Tests gelöscht/neu aufgesetzt)

## Session-Status

Alle Gates grün: typecheck, lint (0 errors, 1 bekannte Warnung),
21 Unit-Tests, 5 e2e-Tests, Build. Working tree sauber (nur diese Datei).
