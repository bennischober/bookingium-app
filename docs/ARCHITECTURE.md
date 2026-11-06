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
| Files           | CSV in the regional format (own reader/writer), pdf.js (print preview), pdf-lib (e-invoice in PDF)  |
| Tests           | vitest (unit, in-memory SQLite), Playwright (e2e incl. printToPDF)                                  |
| Mail            | imapflow, mailparser, nodemailer, DOMPurify (the experimental mail client)                          |
| Package manager | pnpm 12 (script allowlisting, see pnpm-workspace.yaml)                                              |

The app icon's source is `build/icon.svg`. After changing it, `pnpm icons`
(`scripts/generate-icons.mjs`) rewrites `build/icon.ico`, `.icns`, `.png`
and `resources/icon.png` (the window icon on Windows and Linux). The sidebar
header imports the SVG itself, as the logo that links to the Dashboard.

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
  csv/                 CSV read/write: separator per locale, quoting,
                       encoding detection (pure, unit-tested)
  import/              CSV import: read the file, detect columns,
                       rows -> plan (pure, unit-tested)
  calendar/            iCalendar builder (pure)
  einvoice/            E-invoice (ZUGFeRD/Factur-X): amounts (cent rounding),
                       codes, completeness check, CII XML (pure, shared with
                       the renderer); facturx.ts embeds it with pdf-lib
  invoice/             What printed invoices must say about VAT and the
                       service date (pure, used by the invoice templates)
  payment/             EPC payment QR code text (pure, used by the invoice
                       templates)
  mail/                "Per E-Mail senden": email text from the template
                       (pure), the compose window, emailPdf.ts (the PDF
                       under <userData>/E-Mail)
  mailclient/          The IMAP mail client:
                       MailClientService (host), worker.ts (utility process),
                       core/ (sync, store, write engine); docs/mail-client.md
  utils/               fileStorage (storage root, logos), documentStorage
                       (documents/<type>/<id>-<name>/ folders)
  index.ts             Window, IPC handlers (print, invoice email, files,
                       import picker), startup

src/preload/           contextBridge API (window.api: print, documents, logos,
                       import picker, dropped file paths)
src/renderer/src/      React app
  pages/               List pages, detail pages (/band/:id, /companies/:id,
                       /clubs/:id, /festivals/:id, /persons/:id, /events/:id),
                       Einstellungen
                       (tabs Allgemein, Rechnungen, E-Mail, Kalender, Daten),
                       print pages. The active tab lives in the URL (?tab=)
  components/
    ui/                shadcn-style primitives (+ searchable-select)
    forms/             Business object forms (TanStack Form)
    event-hub/, band/, company/, venue/, person/, settings/, detail/
                       Page tabs and parts
    documents/, import/, export/                    Shared feature panels
    layout/            Top bar: back/forward, breadcrumbs, search, quick create
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
logs/errors.log (+ errors.1/2.log)        Local error log, JSONL, ~1 MB each
mail/accounts.json                        Mail accounts (passwords via safeStorage)
mail/data/<accountId>/                    Mail store (SQLite + FTS5) and .eml files
backup/state.json                         Automatic backup settings and status
backup/before-restore/                    The data as it was before each restore
backup/before-update/                     The database before each update's migrations
                                          (the newest 3) and last-version.txt
```

The error log (`src/main/utils/errorLog.ts`) records unexpected errors only:
crashes and uncaught errors of main, the mail worker and the renderer, render
errors a boundary caught, and the mail core's `log.error`. Offline, rejected
logins and server refusals stay out unless nothing caught them. Addresses and
the home folder are scrubbed, lengths capped, at most 30 entries a minute;
nothing is uploaded. Einstellungen › Daten opens the folder.

Documents belong to an owner by `owner_type` + `owner_id` (no foreign key);
triggers in the initial migration delete the rows with the owner, the owner's
service removes the folder. Settings are key/value rows in `app_setting`,
typed and defaulted by `AppSettings` (settings.schema.ts).

Documents are listed newest first (`uploaded_at` desc) and shown through one
`DocumentTable` (Name · Typ · Quelle · Größe · Hochgeladen · actions), with
`readOnly` for lists that only show files managed elsewhere. Its table formats
come from `components/documents/documentSort.ts`: sizes use the German decimal
comma (`1,5 MB`, whole bytes without a fraction) and dates use
`formatShortDate` (`11.06.2026`) - not a second date style. Deleting a document
moves its file to the OS trash (`shell.trashItem`, so it stays recoverable) and
then removes the row; a file that is already gone is no error.

## Backups

`src/main/backup/` (no Electron: `policy.ts` holds the pure rules, `files.ts`
the file work) and `BackupService` (timers, status). Einstellungen › Daten has
the manual "Sicherung erstellen…" and the card "Automatische Sicherung".

- **A backup folder** is `Bookingium-Sicherung YYYY-MM-DD HH-MM` (local time,
  ` (2)` within the same minute) with `bookingum.db`, `storage/`,
  `LIESMICH.txt` and the marker `bookingium-sicherung.json`
  (`{app, format, kind: auto | manual | before-restore, createdAt, appVersion,
encrypted?}`).
- **Never live data in a synced folder.** The database is snapshotted with
  SQLite's backup API into the local `backup/` folder first, then copied. The
  folder is written as `.bookingium-unfertig-<id>` and renamed when complete
  (retried while OneDrive or Dropbox holds a file), so a folder named like a
  backup is always a whole one.
- **When:** 30 s after start, then hourly, a backup runs once the last success
  is 20 hours old (a day minus slack, so opening the app a little earlier each
  day still gives a daily backup). Not on close: quitting would wait for the
  copy, and a shutdown cuts it off. A run never throws; the error goes to the
  status shown in the settings.
- **Retention:** the newest automatic backup of each of the last 7 days that
  have one, and of each of the last 4 weeks (Monday-based). Days without a
  backup do not count, so a break never empties the folder. Only folders with
  our name AND a marker of kind `auto` are deleted; temp folders only with our
  marker and older than a day. Manual backups and anything else stay.
- **Settings and status** live in `backup/state.json`, not in the database:
  the folder is a path on this computer, and restoring an older database must
  not switch backups off or send them elsewhere.
- **Restore:** "Sicherung wiederherstellen…" copies the chosen backup into
  `backup/restore-incoming/` and checks it (`quick_check`, an `app_setting`
  table). After the confirmation the current state is backed up into
  `backup/before-restore/`, the copy is renamed to `backup/restore-staged/`
  and the app restarts. At the next start, before `runMigrations()` opens the
  database, `applyStagedRestore` moves the current database (with `-wal` and
  `-shm`) and `storage/` aside, moves the staged ones in, and puts everything
  back if a step fails (the staged copy then becomes `restore-failed-<time>`).
  Migrations then bring an older backup up to the current schema.
- **Encryption (#54, off by default):** "Mit Passwort verschlüsseln" derives a
  key with scrypt (N 2^17, r 8, p 1, a fresh salt per password) and keeps it,
  sealed by `safeStorage` (DPAPI), in `backup/state.json`; the password itself
  is never stored and the status never carries the key. Automatic and manual
  backups then hold `daten.bookingium` instead of `bookingum.db` and
  `storage/` (`encryption.ts`): magic `BKSICH01`, a length-prefixed JSON header
  (scrypt parameters, salt, IV, a key check) that is the AES-256-GCM additional
  data, the encrypted archive of the database and every storage file, and the
  tag. The marker says `encrypted: true`. If the sealed key cannot be opened
  the backup fails with a message instead of falling back to plain; the
  before-restore backup stays plain (it is local). A restore asks for the
  password, checks it against the header before copying anything, decrypts to
  a temp file and verifies the tag before unpacking, and refuses paths that
  leave `restore-incoming/`. A changed password applies to new backups only;
  a forgotten one cannot be recovered.
- **Mail is not included.** `mail_link`, `invoice_email` and
  `invoice_email_pending` are app tables, so they are in every backup. The
  per-account stores (`mail/data/<accountId>/`) hold the IMAP cache (it comes
  back from the server), contacts derived from it, and the operation journal,
  whose replay on another computer could send mail twice. `mail/accounts.json`
  holds DPAPI-encrypted passwords that only work for this Windows user. See
  issue #55 for the account ids on a new computer.

## Migrations

All migrations up to 2026-10 were merged into `0000_initial` (pre-release).
Databases from before the merge are taken over by `upgradeLegacyDatabase` in
`migrate.ts` (recorded as applied, band table repaired once).

**The history is frozen at 1.0.0.** Every installed database has run
`0000_initial` … `0017_contact_email`; merging, renaming or editing any of them
would leave real installations unable to update. A schema change after 1.0.0 is
always a new migration at the end. `tests/migration_upgrade.test.ts` pins the
tag, timestamp and SQL hash of each 1.0.0 migration and upgrades a 1.0.0
database with rows in it to the current schema.

At startup (`migrateDatabase` in `index.ts`):

- A database that records a migration this build does not know comes from a
  newer version. Nothing is touched; the user is told to install that version
  again, and the app quits.
- Before pending migrations change an existing database, `VACUUM INTO` copies it
  to `backup/before-update/<version>_<time>.db`, named after the version that
  last opened it (`last-version.txt`, "unbekannt" before one recorded it). The
  newest 3 copies stay. If the copy fails, nothing is migrated.
- If a migration fails, the app shows the error and where the copy is, and
  quits instead of opening on a half-migrated database.

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

    A tab's shape follows what the rows are. Records you open use `RowTable`
    (`components/detail/DetailParts.tsx`); links you edit in place use cards;
    the overview uses `InfoCard`. A `RowTable` is full width, and only a card
    list is narrowed (`max-w-2xl`). Give `RowTable` an `itemLabel` so a long tab
    says how many rows it holds, and a `sortValue` on the columns that should
    sort - without one the table keeps the order the query delivered. Relationship
    tabs look alike: the memberships card on top, the linked records below (the
    Bands, Companies and Spielstätten tabs of the person page).

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
  drafts): main prints the PDF (with e-invoice), fills the fixed text of
  Einstellungen › E-Mail › E-Mail-Vorlagen („Für Rechnungen und Verträge“, by
  the print template's language; {Platzhalter} in `mail/invoiceEmail.ts`),
  keeps the PDF in `<userData>/E-Mail` (kept 30 days) and opens bookingum's
  compose window on the account chosen under „Senden von“. #136: this is the
  only way, the mail program setting and the .eml/mailto: paths are gone.
  Without a writable account it says so and offers „Einstellungen öffnen“.
  The invoice counts as sent only after a real send over SMTP
  (`docs/mail-client.md`): then it is a row in `invoice_email` (time,
  address), listed in the invoice's Verlauf, and the latest is also on the
  invoice (`emailed_at`/`emailed_to`) for the list's envelope.
- **Contract email** (#120, „Per E-Mail senden“ on the print page of a
  concert or management contract, channel `contract:email`): the same way
  as an invoice's, with the fixed text „Vertrag“ ({Platzhalter} in
  `mail/contractEmail.ts`). A concert contract goes to the
  promoter, a management contract to the band's company; the language is
  chosen next to the button, suggested by the recipient's country (German
  for DE/AT/CH/LI and for an empty or unknown one). Nothing is recorded on
  the contract: contracts have no email history.
- **Invoice page** (`/invoices/$invoiceId`, `InvoiceDetailPage`): one per
  issued invoice, with its data, the e-invoice check, the status changes it
  still allows (Stornieren included) and a „Verlauf“ (`lib/invoiceHistory.ts`):
  created, each status change and each email, oldest first. Every status
  an invoice moves to is a row in `invoice_status_change`, written by the
  repository wherever the status changes (create, update, `setStatus`, the
  Stornorechnung); the migration started it with the issue date and the
  current status. Drafts have no page: they are edited in the sheet of the
  invoice list (`/invoices?open=<id>`), and the page sends a draft there;
  `useOpenInvoice` picks the page or the sheet for links to an invoice.
- **Payment reminders:** an invoice is overdue when it is marked
  überfällig, or gestellt with its due date before today (local day;
  `overdueInvoiceWhere` in the repository, `nextReminderKind` in
  `invoice.schema.ts`, Stornorechnungen never). Its next step is a
  Zahlungserinnerung, after any reminder a Mahnung. The Dashboard card
  „Überfällige Rechnungen“ (`invoice.listOverdue`, longest overdue first,
  hidden when empty) and the invoice page offer it; both open the print
  page with `?email=reminder|dunning`, whose button opens the email like
  the invoice email, from its own fixed text ({Frist} is today + 7 days).
  The fixed texts (#136) are `mail_template` rows with `kind` and `lang`,
  one per edited text; without a row `DEFAULT_DOCUMENT_EMAILS` applies
  (`MailTemplateService.documentTemplate`). Migration 0024 copied the texts
  edited in older versions out of `app_setting`. The `invoice_email` row carries its
  `kind` (invoice/reminder/dunning) for the Verlauf; a reminder marks a
  gestellt invoice überfällig and leaves `emailed_at`/`emailed_to` alone.
  Fees and default interest (Mahngebühren, Verzugszinsen) are not part of it.
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

## Import

`main/import/` is pure: `readImportFile` reads the sheet and suggests the
target, the venue kind and the company kind; `detectMapping` maps headers by
synonyms; `buildImportPlan` turns rows into drafts and the preview;
`ImportRepository.apply` writes the plan in one transaction. Records that
already exist (matched by name) only get their empty fields filled.

- **Columns.** A known field the target cannot hold becomes a note.
  Numbered columns (`E-Mail 2`, `Telefon 2`, `Tel 3`) are further columns of
  their field: the first address is the contact's email, the others go to
  `contact_email`; a second phone has no field and becomes a note.
- **Rows.** In venue and company lists a row without a name continues the
  record above. In a person list a row with a company but no person carries
  the company's own data.
- **Radio/Medien.** For companies and persons the dialog asks what the
  companies are (Firma or Radio/Medien, suggested from the sheet name and
  columns like Medienpartner or Radiosender) and takes genres for the whole
  list. In such a list a row with only an address is the outlet of its
  domain, so it reaches the Verteiler; the next rows at that domain are its
  further addresses. A freemail address names the outlet after the person,
  or after the address itself.
- **Genres.** A Genre column fills `venue.genres` or `company.genres`;
  "Genres für alle" is added to every club, festival or media company.

## Mailing lists (Verteiler)

The Verteiler page (`ContactListPage`, `contactList` router,
`ContactListService`) collects email addresses for newsletters and round
mails. Bookingium sends nothing itself: German law (§ 7 UWG) only allows
advertising emails with consent or an existing business relationship, and
bulk sending belongs in a newsletter service that handles unsubscribes.

- **Sources** (`ContactListRepository.loadSources`): every venue and
  festival, and every company of the kind Radio/Medien (`company.kind`
  `'media'`, #80). Recipient types: the source's own address
  (Hauptadresse), its Ansprechpartner (venue members, or the media
  company's members), a venue's Veranstalter (the owning company's own
  email) and the LoPros of the venue's events (#51): the event's LoPro
  company and LoPro person, from every non-archived event there, cancelled
  ones included. Media have no Veranstalter, LoPros, capacity or bookings.
- **Filters** apply to the source (`sourceMatches`): kind (Clubs,
  Festivals, Radio/Medien), recipient type, country, state, PLZ prefixes,
  capacity (a bound excludes sources without capacity, media among them),
  genre and bookings (any choice but "alle" leaves media out). Genres are
  the source's own tags (`venue.genres` or `company.genres`, stored as
  "Rock, Punk" via `normalizeGenres` in `api/schemas/genres.ts`) plus the
  genres of bands with a non-cancelled event there; "gebucht" means such an
  event (of one band, when chosen). Empty filters mean no restriction.
- **One row per address** (case-insensitive): a person's name wins over a
  source name, the row lists all matched sources (with their kind: venue
  and company ids are separate sequences) and the largest capacity.
- **Keine Werbung:** `contact.no_advertising`, a switch in the person,
  company and venue forms and the ⊘ action on the page. Any contact with
  the address marked keeps it off every list; the page shows those as
  excluded and can take them back in.
- **Out of the app:** „E-Mail schreiben“ opens bookingum's compose with the
  list in BCC (#136, `components/mail/pendingCompose.ts`, on a writable
  account; without one it says so). „Adressen kopieren“ copies them; „CSV exportieren“ writes a UTF-8, comma-separated
  file (`contactListCsv`: E-Mail, Vorname, Nachname, Firma,
  Club/Festival/Medium, Ort, Land, Art) for Brevo, CleverReach or Mailchimp. All three rebuild
  the list in main, so the screen can't be stale.
- **Saved lists** (`contact_list`) store the filters as JSON, not the
  addresses: a saved list always shows the current contacts. Unreadable
  filters fall back to "everything".

## Follow-ups (Wiedervorlagen)

A follow-up is a due date with a note (`follow_up`, `followUp` router,
`FollowUpService`), either on one record or general.

- **On a record:** event (deal memo), band, venue, company, person or
  invoice, as
  nullable foreign keys with `ON DELETE CASCADE` (unlike documents'
  `owner_type`/`owner_id`): a follow-up goes with its record. At most one
  is set; none means general.
- **Done** sets `done_at` instead of deleting, so the toast's "Rückgängig"
  brings it back. Lists show open ones; "Erledigte" on the Dashboard card
  opens the history (`listDone`, last ticked off first, 50 at a time, each
  with "Wieder öffnen"). "Löschen" in the edit dialog removes one for good.
- **Where it shows** (`components/follow-ups`): a "Wiedervorlage" button
  and the record's open follow-ups above the tabs on each detail page; the
  Dashboard card (overdue, today, the next 14 days, the rest behind "weitere
  später anzeigen"; "+ Wiedervorlage" for a general one); and the count of
  those due today or earlier on the Dashboard menu item. An invoice's sit
  on its page, a draft's in its sheet; the Dashboard links to the page,
  which hands a draft to the sheet. The calendar page shows open ones on
  their due day (an amber dot in the month, a list under the day and in the
  agenda) and "+ Wiedervorlage" creates one on the selected day.
- **Calendar file** (#52): with "Offene Wiedervorlagen mit aufnehmen"
  (`calendarFeedFollowUps`, off by default, since the file is often shared
  by link) the .ics gets each open one as an all-day, non-blocking entry
  (`UID:follow-up-<id>@bookingium`, "Wiedervorlage: <first line>"). Every
  `FollowUpService` change schedules a rewrite, so a ticked-off one drops
  out of subscribed calendars. Person, company and invoice changes call
  `scheduleFollowUpCalendarUpdate()` (only with the switch on): a rename
  changes the "Zu: ..." line, a delete cascades their follow-ups away.
- **Offered, not made:** saving something unfinished (an invoice draft, an
  event still "Ausstehend") shows "Wiedervorlage setzen" in the success
  toast (`useFollowUpNudge`), unless the record already has an open
  follow-up. The click opens the dialog with a note prefilled, through
  `openFollowUpDialog()` and the `FollowUpDialogHost` at the app root, so it
  works after the sheet or wizard that saved has closed.
- **Waiting for a reply** (#121, mail client only): the compose window's
  "Wiedervorlage" choice (Keine, In 3 Tagen, In 1 Woche, In 2 Wochen;
  `composeFollowUp.ts`) files one after a successful send, with the sending
  account and the sent mail's Message-ID (`mail_account_id`,
  `mail_message_id`, stored without brackets) and the invoice, band (management
  contract) or deal memo (concert contract) the compose window was opened for
  (`record=type:id` in its query). The send is never undone when filing fails.
  The mail linker closes it when a mail from someone else's address names that
  Message-ID in In-Reply-To or References (`answeredMessageIds`,
  `FollowUpService.closeByReplies`): `replied_at` is set once, `done_at` only if
  it was still open, so one reopened by the user stays open on a rescan. The
  `follow-ups-answered` mail event refreshes the renderer through the
  sidebar's always-mounted subscription. An open one due today or earlier
  without a reply shows "Keine Antwort"; the history says "Antwort erhalten am
  …" when the reply closed it. A re-created account adopts them with its
  links (#55).
- **Dates** are local calendar days ("2026-10-21", `lib/followUps.ts`), so
  "Heute" follows the computer's clock, not UTC.

## Mail client

An IMAP mail client in `src/main/mailclient/`, always part of the app since
#136 (the switch „E-Mail (experimentell)“ is gone). Main starts its worker
only once an account exists; the renderer shows the menu entry always and
the E-Mails tabs, mail search and invoice mails card once there is an
account (`useHasMailAccount`). A utility process runs the core (its own
SQLite store per account, apart from the app DB); links to app records live
in `mail_link` in the app DB. Everything else — architecture, sync, the write path, rules
for working on it and what is still open — is in `docs/mail-client.md`.
