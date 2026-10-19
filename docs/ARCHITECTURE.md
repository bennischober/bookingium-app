# Architecture & Developer Guide

How the app is structured, the recipe for adding a business object
end-to-end, and the coding guidelines.

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 44 (main + preload + renderer processes) |
| Build | electron-vite (vite 7), TypeScript 5.9, electron-builder (NSIS) |
| UI | React 19, Tailwind 4, shadcn-style components (Radix/Base UI, cmdk), TanStack Router (hash history) |
| Data flow | tRPC v10 (electron-trpc over IPC) + TanStack Query v4 |
| Database | SQLite (better-sqlite3) via Drizzle ORM, tsyringe DI |
| Validation | zod v4 (DTOs double as API contracts) |
| Files | exceljs (import/export), pdf.js (print preview) |
| Tests | vitest (unit, in-memory SQLite), Playwright (e2e incl. printToPDF) |
| Package manager | pnpm 12 (script allowlisting, see pnpm-workspace.yaml) |

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
  utils/               fileStorage (storage root, logos), documentStorage
                       (documents/<type>/<id>-<name>/ folders)
  index.ts             Window, IPC handlers (print, files, import picker), startup

src/preload/           contextBridge API (window.api: print, documents, logos,
                       import picker, dropped file paths)
src/renderer/src/      React app
  pages/               List pages, detail pages (/band/:id, /companies/:id,
                       /venues/:id, /events/:id), Einstellungen, print pages
  components/
    ui/                shadcn-style primitives (+ searchable-select)
    forms/             Business object forms (TanStack Form)
    event-hub/, band/, company/, venue/, detail/   Detail page tabs and parts
    documents/, import/, export/                    Shared feature panels
    layout/            Top bar: back/forward, breadcrumbs, quick create, search
    print/, contract/, invoice/                     A4 print documents
  lib/                 trpc client, routing (ROUTES, menu groups, shortcuts),
                       navigationHistory, confirm dialog, label helpers
  hooks/               useFormSheet, useListSearchActions, useTablePagination, …
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
4. **Repository** — `@injectable()` class with `getAllPaginated`, `getById`,
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
9. **List page** — `pages/XPage.tsx` with `DataTable`, `useTablePagination`,
   `FormSheet`/`useFormSheet`, `useListSearchActions` (`?create`/`?open` from
   the search palette); add `ExportButton` (and an import type if lists of
   it get imported). Register the route under the `_app` layout in
   `router.tsx` and add it to `ROUTES` in `lib/routing.ts`.
10. **Detail page** (records with relations) — `/x/$xId` with tabs kept in
    `?tab=`, built from panels (`MembersPanel`, `DocumentsPanel`, …); row
    click opens it, the pencil keeps the sheet; add the name to the
    breadcrumbs (`layout/app-breadcrumbs.tsx`).
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
