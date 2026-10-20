# Architecture & Developer Guide

How the app is structured, the recipe for adding a business object
end-to-end, and the coding guidelines.

## Tech stack

| Layer           | Technology                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Shell           | Electron 44 (main + preload + renderer processes)                                                   |
| Build           | electron-vite (vite 7), TypeScript 5.9, electron-builder (NSIS)                                     |
| UI              | React 19, Tailwind 4, shadcn-style components (Radix/Base UI, cmdk), TanStack Router (hash history) |
| Data flow       | tRPC v10 (electron-trpc over IPC) + TanStack Query v4                                               |
| Database        | SQLite (better-sqlite3) via Drizzle ORM, tsyringe DI                                                |
| Validation      | zod v4 (DTOs double as API contracts)                                                               |
| Files           | exceljs (import/export), pdf.js (print preview), pdf-lib (e-invoice in the PDF)                     |
| Tests           | vitest (unit, in-memory SQLite), Playwright (e2e incl. printToPDF)                                  |
| Package manager | pnpm 12 (script allowlisting, see pnpm-workspace.yaml)                                              |

## Process architecture

```
src/main/              Main process
  db/                  schema.ts (Drizzle tables), migrations/, migrate.ts, seed.ts
  repositories/        SQL + query logic, one class per business object
  services/            Business logic over repositories (ExportService,
                       CalendarFeedService, SettingsService, ImportService …)
  api/
    schemas/           zod DTOs + inputs (the API contract, shared with the renderer)
    mappers/           DB entity (snake_case) -> DTO (camelCase)
    routers/           tRPC procedures; resolve services via tsyringe
  import/              Spreadsheet import: read workbook, detect columns,
                       rows -> plan (pure, unit-tested)
  calendar/            iCalendar builder (pure)
  einvoice/            E-invoice (ZUGFeRD/Factur-X): amounts (cent rounding),
                       codes, completeness check, CII XML (pure, shared with
                       the renderer); facturx.ts embeds it with pdf-lib
  invoice/             What printed invoices must say about VAT and the
                       service date (pure, used by the invoice templates)
  payment/             EPC payment QR code text (pure, used by the invoice
                       templates)
  mail/                "Per E-Mail senden": email text from the template,
                       .eml writer, mail program choice (pure); openEmail.ts
                       writes the files and opens the mail program
  utils/               fileStorage (storage root, logos), documentStorage
                       (documents/<type>/<id>-<name>/ folders)
  index.ts             Window, IPC handlers (print, invoice email, files,
                       import picker), startup

src/preload/           contextBridge API (window.api: print, documents, logos,
                       import picker, dropped file paths)
src/renderer/src/      React app
  pages/               List pages, detail pages (/band/:id, /companies/:id,
                       /venues/:id, /persons/:id, /events/:id), Einstellungen
                       (tabs Allgemein, Rechnungen, E-Mail, Kalender, Daten),
                       print pages. The active tab lives in the URL (?tab=)
  components/
    ui/                shadcn-style primitives (+ searchable-select)
    forms/             Business object forms (TanStack Form)
    event-hub/, band/, company/, venue/, person/, settings/, detail/
                       Page tabs and parts
    documents/, import/, export/                    Shared feature panels
    layout/            Top bar: back/forward, breadcrumbs, quick create, search
    print/, contract/, invoice/                     A4 print documents
  lib/                 trpc client, routing (ROUTES, menu groups, shortcuts),
                       navigationHistory, confirm dialog, label helpers
  hooks/               useFormSheet, useListSearchActions, useListQuery, …
tests/
  *.test.ts            Unit tests (in-memory SQLite, real migrations)
  e2e/                 Playwright against the built app (fresh temp data folder)
```

## Data flow

```
Component -> trpcReact.<router>.<procedure>.useQuery(input)
          -> tRPC router (src/main/api/routers): input parsed by zod
          -> Service (tsyringe container.resolve)
          -> Repository (drizzle query / transaction)
          -> SQLite
          <- raw DB entity (snake_case)
          <- Mapper.toDto -> camelCase DTO
          <- React Query cache -> component
```

Repositories and services return **raw snake_case DB entities**; the
camelCase conversion happens **only** in the router layer via the mappers.
Unit tests therefore assert snake_case field names.

Native things (dialogs, files, printing) live in main: either as IPC handlers
in `index.ts` exposed through the preload, or directly in tRPC routers that
import `electron` (save dialogs for export/backup, `shell.openPath`).

## Data on disk

`%APPDATA%\bookingum-app` (pinned in `index.ts`, the same for development
and the installed app; tests pass their own folder via
`BOOKINGIUM_USER_DATA`):

```
data/bookingum.db                         SQLite database (WAL)
storage/documents/<type>/<id>-<name>/     Documents of events, bands,
                                          companies, venues, persons
storage/logos/<companyId>/                Company logos and signatures
```

Documents belong to an owner by `owner_type` + `owner_id` (no foreign key);
triggers in the initial migration delete the rows with the owner, the owner's
service removes the folder. Settings are key/value rows in `app_setting`,
typed and defaulted by `AppSettings` (settings.schema.ts).

## Migrations

All migrations up to 2026-10 were merged into `0000_initial` (pre-release).
Databases from before the merge are taken over by `upgradeLegacyDatabase` in
`migrate.ts` (recorded as applied, band table repaired once).

- Change `schema.ts`, then `pnpm db:generate` and review the SQL.
- Never edit an applied migration; add a new one.
- drizzle-kit drops `ON DELETE` for foreign keys added with `ADD COLUMN`:
  check the generated SQL and fix it by hand (rebuild the table if needed).
- Table rebuilds are safe: `runMigrations` turns foreign keys off around the
  migrator (inside its transaction a migration's own PRAGMA has no effect)
  and runs `foreign_key_check` afterwards.
- Triggers and other hand-written SQL go into a custom migration
  (`drizzle-kit generate --custom`); keep the snapshot in sync.

## Adding a new business object end-to-end (the recipe)

1. **DB schema** — `src/main/db/schema.ts`: table (snake_case columns, `id`
   PK, `created_at`/`updated_at` defaults, indexes on name columns, FKs with
   explicit `onDelete`); add it to the `schema` object at the bottom.
2. **Migration** — `pnpm db:generate`, review the SQL (see above).
3. **zod schemas** — `src/main/api/schemas/<object>.schema.ts`: `XDto`,
   `CreateXInput`, `UpdateXInput` (explicit object with plain `.optional()`
   keys — never `.partial()` of an input with defaults), `PaginatedXResponse`.
4. **Repository** — `@injectable()` class with `getAllPaginated` (bounds via
   `listPage`, order via `listOrder` from `listQuery.ts`), `getById`,
   `create`, `update`, `delete`. Transactions are **synchronous callbacks**.
5. **Service** — `@injectable()`, constructor injection, thin methods. Call
   `scheduleCalendarUpdate()` after changes if the object shows up in the
   calendar file; remove the owner's document folder on delete if it can
   own documents.
6. **Mapper** — static `toDto`/`toDtoList`; snake → camel only here.
7. **Router** — procedures calling the service and mapping; register in
   `src/main/api/router.ts`.
8. **Form** — `components/forms/XForm.tsx` (TanStack Form; BankForm is the
   minimal example). Pick related records with `SearchableSelect`.
9. **List page** — `pages/XPage.tsx`: one continuous list. Query with
   `trpcReact.x.getAllPaginated.useInfiniteQuery({ pageSize: LIST_CHUNK_SIZE,
search, ...sortInput }, infiniteListOptions)` and `useListSorting` (order
   remembered per list); pass `listRows`/`listTotal`, `hasNextPage`/
   `fetchNextPage` and the sorting to `DataTable`, which pins toolbar, column
   headers and status line and loads more near the end. Column ids must be
   sort keys of the repository's `listOrder` map (else `enableSorting:
false`). The page root is `flex h-full min-h-0 flex-col` so the table gets
   the remaining height. Add `FormSheet`/`useFormSheet`,
   `useListSearchActions` (`?create`/`?open` from the search palette) and
   `ExportButton` (and an import type if lists of it get imported). Register
   the route under the `_app` layout in `router.tsx` and add it to `ROUTES`
   in `lib/routing.ts`.
10. **Detail page** (records with relations) — `/x/$xId` with tabs kept in
    `?tab=`, built from panels (`MembersPanel`, `DocumentsPanel`, …); row
    click opens it, the pencil keeps the sheet; add the name to the
    breadcrumbs (`layout/app-breadcrumbs.tsx`). Lists of linked records come
    from `listBy*` procedures taking the id (e.g. `dealMemo.listByPerson`,
    `invoice.listByPerson`, `band.listByResponsiblePerson`); the person page
    edits memberships from the person's side (`PersonMembershipsPanel`).
11. **Seed** (optional demo data) — `src/main/db/seed.ts`; real master data
    only in the gitignored `sample_data/internal-seed.json`.
12. **Tests** — unit tests in `tests/`, an e2e spec in `tests/e2e/`.
13. **Gates** — `pnpm test && pnpm lint && pnpm typecheck && pnpm build`,
    then `npx playwright test`.

## Coding guidelines

- **create/update vs upsert:** `create` + `update` for business objects;
  `upsert` only for 1:1 companion tables (itinerary per event) and value
  tables (company_invoice_settings, app_setting).
- **Transactions:** synchronous callbacks only (better-sqlite3); never
  `db.transaction(async (tx) => …)`.
- **Partial updates:** `UpdateXInput` never via `.partial()` of an input that
  uses `.optional().default(…)` — it re-applies the defaults and wipes fields
  (see tests/company.test.ts). Merge with `input.field ?? existing.field`.
- **Stored enum values** are rendered through label maps and never
  translated; see [UI_LANGUAGE.md](UI_LANGUAGE.md).
- **Sensitive master data** (real names, IBANs, addresses, signatures) only
  in the gitignored `sample_data/`; never in code, seeds, tests or commit
  messages. The package allow-list in `electron-builder.yml` keeps it out of
  installers.
- **Dependencies:** `dependencies` = what the main process loads at runtime;
  renderer libraries are devDependencies (Vite bundles them).
- **Tailwind 4:** CSS variables in arbitrary values use `w-(--var)` or
  `max-h-[min(…,var(--var))]`; the v3 form `w-[--var]` produces invalid CSS.
- **Large components:** split per concern (columns, form, tabs) when working
  on them; do not split working pages preemptively.

## Print documents (invoices, contracts)

- Print routes live under the chrome-free `_print` layout route
  (`/invoices/$invoiceId/print`, `/events/$eventId/contract/print`,
  `/management-contracts/$contractId/print`).
- `PagedDocument` renders A4 pages; the preview is the real `printToPDF`
  output drawn with pdf.js, so what you see is what prints.
- Invoices render from **frozen snapshots** (invoice_party_snapshot);
  contracts render from **live master data** (drafted before the event).
- Verification: `npx playwright test` writes the real PDF and page PNGs to
  `tests/e2e/__screenshots__/` — inspect the PDF, not just the screenshot.
- Issuing a draft re-takes both snapshots, so an invoice freezes the
  parties as they are when it gets its number.
- **Payment QR code** (EPC QR, „GiroCode“, setting `paymentQr`):
  `payment/epcQr.ts` builds the text (version 002, BIC optional, gross
  total, „Rechnung 1040“/„Invoice 1040“ as reference, max 331 bytes);
  `PaymentQr` draws it as an inline SVG path, synchronously, so every print
  has it, at 21 mm left of the totals (the whitespace around it is the
  quiet zone). Only issued/paid/overdue invoices in EUR with a valid issuer
  IBAN (mod 97) get one — no drafts, cancelled invoices or
  Stornorechnungen. The e2e test scans the code from the saved PDF.
- **Invoice email** („Per E-Mail senden“ on the print page, not for
  drafts): main prints the PDF (with e-invoice), fills the template from the
  settings (`invoiceEmailDe`/`invoiceEmailEn`, by the print template's
  language; {Platzhalter} in `mail/invoiceEmail.ts`) and writes PDF and
  .eml (`X-Unsent: 1`) to `<userData>/E-Mail` (kept 30 days). The
  setting `mailProgram` (default `auto`: by the program Windows opens
  mailto: with) picks the way: classic Outlook opens the .eml as a draft
  (`OUTLOOK.EXE /eml`), Thunderbird composes with the PDF attached
  (`-compose`), any other program (new Outlook) gets a mailto: link and
  Explorer shows the PDF to drag in, no program: the folder opens. The
  invoice keeps `emailed_at`/`emailed_to`. No email is ever sent by the
  app. e2e runs set `BOOKINGIUM_NO_LAUNCH=1` (files only).
- **Mandatory content** (§ 14 Abs. 4 UStG) comes from
  `invoice/taxSummary.ts`, shared by all templates: VAT per rate and per
  0 % reason with its net amount when there is more than one group, the
  Steuerhinweis (else the standard wording for reverse charge, intra-EU,
  export, not taxable) under the totals, the buyer's VAT ID for reverse
  charge and intra-Community supplies, and the service date (period, else
  event date, else „entspricht Rechnungsdatum“). Check a template change
  against these before shipping it.

## E-invoices (ZUGFeRD/Factur-X)

„Als PDF speichern“ on an invoice sends its id along (`print:savePdf`);
`EInvoiceService.attachToPdf` embeds the XML (CII, profile EN 16931, or
XRechnung when the invoice is flagged) into the printed PDF when the
invoice is issued, complete and the setting `eInvoiceEmbed` is on.
Otherwise the PDF is saved as printed and the toast says what is missing.

- **One source:** the XML is built from the same print data as the PDF
  (snapshots, line items, stored totals) via `eInvoiceInputOf`.
- **Check first:** `prepareEInvoice` returns either the prepared data or
  the list „Für die E-Rechnung fehlt: …“. Everything the XML contains is
  derived there; `buildCiiXml` only writes it. Add a field by adding it to
  the check (with its German message) and then to the XML.
- **Rounding:** `einvoice/amounts.ts` is the only place money is rounded:
  line net = qty × price, VAT once per rate, totals from cents. The
  repository, the invoice form and the XML use it. Stored totals that
  differ (older invoices) block the XML instead of contradicting the PDF.
- **Mapping:** tax codes -> VAT categories, units -> UN/ECE Rec 20, default
  exemption reasons (VATEX), EU countries and the Steuerhinweis presets
  live in `einvoice/codes.ts`. The tax note (`reverse_charge_note`,
  „Steuerhinweis“) is the exemption reason. Reverse charge to a buyer
  outside the EU is refused: those services are „nicht steuerbar“ (O).
- **Drafts** are checked with the parties' current master data
  (`currentParties`); the invoice form checks live via
  `invoice.previewParties`. Drafts and cancelled invoices get no XML.
- **PDF/A-3b:** `facturx.ts` adds what Chromium's output lacks: an sRGB
  output intent (ICC profile built in `srgbIcc.ts`, nothing shipped) and a
  trailer ID, plus the Factur-X XMP. File name `factur-x.xml`, or
  `xrechnung.xml` with conformance level XRECHNUNG.
- **XRechnung** (`invoice.xrechnung`, folded away in the invoice form):
  XRechnung guideline id and business process (BT-23), and the check
  additionally requires Leitweg-ID, seller contact with phone and e-mail,
  IBAN and buyer e-mail. The print page offers the bare XML for portals
  (`einvoice:saveXml`).
- **Stornorechnung:** cancelling an issued invoice (status `cancelled`)
  creates an invoice of kind `cancellation` in the same transaction: next
  number, same snapshots, lines with negated quantities and amounts
  (invoice + Storno = 0 in lists and exports), `cancels_invoice_id` to the
  original. It is issued and never changes; the dashboard does not count
  it as open. As an e-invoice it is a credit note (type 381, positive
  amounts) referring to the original's number and date (BT-25/26).
- **Validation:** unit tests recompute the BR-CO sums. The official
  validators run with `pnpm validate:einvoice` (needs Java 11+ on the
  PATH): `scripts/einvoice-tools.mjs` downloads pinned, SHA-256-checked
  versions into the gitignored `.tools/` (KoSIT validator 1.6.3, XRechnung
  configuration 2026-08-31, veraPDF greenfield 1.30.3 via a headless
  izpack install; about 44 MB, once), builds, runs
  `tests/e2e/einvoice.spec.ts` and then both opt-in tests, and fails
  unless both ran and passed. `tests/einvoice.kosit.test.ts` runs the KoSIT
  validator over the samples in `tests/helpers/einvoiceFixtures.ts` (EN
  16931 and XRechnung scenarios); `tests/einvoice.verapdf.test.ts` checks
  the PDFs the e2e test leaves in `tests/e2e/__screenshots__/einvoice-*.pdf`
  as PDF/A-3b. `node scripts/einvoice-tools.mjs setup` only installs and
  prints `KOSIT_VALIDATOR`, `KOSIT_CONFIG` and `VERAPDF` for running the
  tests by hand. To update a tool, change its URL and hash in the script.
  Java CLIs get `stdio: 'pipe'`: with an inherited stdin they fail on
  Windows („Unzulässige Funktion“). The validators are dev/CI tools: the
  electron-builder `files` allow-list keeps `.tools/` and `scripts/` out
  of the package. We stay with these Java reference implementations on
  purpose: there is no JS veraPDF, and a JS rebuild of KoSIT would drift
  from the official rules.
