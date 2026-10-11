# Architecture & Developer Guide

How the app is structured, and the step-by-step recipe for adding a new
business object end-to-end.

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 44 (main + preload + renderer processes) |
| Build | electron-vite (vite 7), TypeScript 5.9 |
| UI | React 19, Tailwind 4, shadcn-style components (Radix/Base UI), TanStack Router |
| Data flow | tRPC v10 (electron-trpc over IPC) + TanStack Query v4 |
| Database | SQLite (better-sqlite3) via Drizzle ORM, tsyringe DI |
| Validation | zod v4 (DTOs double as API contracts) |
| Tests | vitest (unit, in-memory SQLite), Playwright (e2e incl. printToPDF) |
| Package manager | pnpm 12 (script allowlisting, see pnpm-workspace.yaml) |

## Process architecture

```
src/main/            Main process
  db/                schema.ts (Drizzle tables), migrations/, seed.ts
  repositories/      SQL + query logic, one class per business object
  services/          Business logic, thin wrappers over repositories
  api/
    schemas/         zod DTOs + inputs (the API contract)
    mappers/         DB entity (snake_case) -> DTO (camelCase)
    routers/         tRPC procedures; resolve services via tsyringe
  utils/             e.g. fileStorage (userData storage, logo/signature files)
  index.ts           Window creation, IPC handlers, app lifecycle

src/preload/         contextBridge API (window.api: document/logo IPC)
src/renderer/        React app
  pages/             Route pages (TanStack Router, hash history)
  components/
    ui/              shadcn-style primitives (generated; do not hand-edit)
    forms/           Business object forms (TanStack Form)
    event-hub/       Tabs of the event detail page
    contract/, invoice/  Print documents
  lib/               trpc client binding, routing constants
  hooks/             useSyncedState, useFormSheet, ...
tests/
  *.test.ts          Unit tests (in-memory SQLite, real migrations)
  e2e/               Playwright: app boot, navigation, printToPDF output
```

## Data flow (read)

```
Component -> trpcReact.<router>.<procedure>.useQuery(input)
          -> tRPC router (src/main/api/routers)
          -> Service (tsyringe container.resolve)
          -> Repository (drizzle query)
          -> SQLite
          <- raw DB entity (snake_case)
          <- Mapper.toDto -> camelCase DTO (zod-validated)
          <- React Query cache -> component
```

**Important:** repositories/services return **raw snake_case DB entities**.
The camelCase conversion happens **only** in the router layer via the mappers.
Unit tests therefore assert snake_case field names.

## Data flow (write)

```
Component (form) -> mutation.useMutation(input)
                 -> tRPC router: input parsed by zod schema (e.g. CreateXInput)
                 -> Service -> Repository -> transaction -> SQLite
```

## Adding a new business object end-to-end (the recipe)

Example: adding a "Rider" object. Follow this order and every layer lines up:

1. **DB schema** — `src/main/db/schema.ts`: add the table (snake_case columns,
   `id` PK, `created_at`/`updated_at` defaults, indexes on name columns,
   FKs with explicit `onDelete`). Export it in the `schema` object at the
   bottom.
2. **Migration** — `pnpm db:generate`. Review the generated SQL (additive
   only for existing tables; never edit an applied migration — generate a
   new one).
3. **zod schemas** — `src/main/api/schemas/<object>.schema.ts`:
   `XDto` (all fields camelCase), `CreateXInput` (`.optional().default(...)`
   for fields with DB defaults — **but never reuse it via `.partial()` for
   updates**, see guidelines below), `UpdateXInput` (explicit object with
   plain `.optional()` keys, no defaults), `PaginatedXResponse`.
4. **Repository** — `src/main/repositories/XRepository.ts`:
   `@injectable()` class, methods `getAllPaginated`, `getById`, `create`,
   `update`, `delete`. Transactions are **synchronous callbacks**
   (`db.transaction((tx) => ...)` with `.run()`/`.all()` on statements —
   better-sqlite3 rejects async callbacks!).
5. **Service** — `src/main/services/XService.ts`: `@injectable()`, ctor
   injection via `@inject(XRepository)`, thin methods.
6. **Mapper** — `src/main/api/mappers/x.mapper.ts`: static `toDto(entity)`,
   `toDtoList(entities)`. Snake→camel here only.
7. **Router** — `src/main/api/routers/x.router.ts`: procedures calling the
   service and mapping with the mapper; register in `src/main/api/router.ts`.
8. **Preload/IPC** (only if the object needs native file operations like
   document/logo uploads) — handlers in `src/main/index.ts`, exposure in
   `src/preload/index.ts` + types in `index.d.ts`.
9. **Form** — `src/renderer/src/components/forms/XForm.tsx` (TanStack Form,
   following BankForm as the minimal example).
10. **Page** — `src/renderer/src/pages/XPage.tsx` using `DataTable` +
    `FormSheet`/`useFormSheet` (see BankPage as the minimal example). Register
    the route in `src/renderer/src/router.tsx` **under the `_app` layout
    route** (chrome-free print pages go under `_print` instead) and add it to
    `src/renderer/src/lib/routing.ts` (title with emoji, group, breadcrumb).
11. **Seed** (optional demo data) — `src/main/db/seed.ts`; real master data
    goes into the gitignored `sample_data/internal-seed.json` instead.
12. **Tests** — `tests/<object>.test.ts`: create/read roundtrip, update
    preserving untouched fields (partial-update regression), delete. Run
    `pnpm test`.
13. **Gates** — `pnpm test && pnpm lint && pnpm typecheck && pnpm build`,
    e2e smoke via `npx playwright test`.

## Coding guidelines (decided)

- **create/update vs upsert:** `create` + `update` is the standard for all
  business objects. `upsert` is allowed only for 1:1 companion tables
  (itinerary per deal memo) and value-settings tables
  (company_invoice_settings) where the row's identity is the parent
  reference, not an id the user picks. Do not convert existing create/update
  pairs to upsert.
- **Transactions:** synchronous callbacks only (better-sqlite3). Never
  `db.transaction(async (tx) => ...)`.
- **Partial updates:** `UpdateXInput` is always an explicit zod object with
  plain `.optional()` keys. `.partial()` on an input schema that uses
  `.optional().default(...)` re-applies the defaults and silently wipes
  fields (bug fixed 2026-10; see tests/company.test.ts).
- **Update merge in repositories:** `input.field ?? existing.field` (not
  `||`, which would drop legitimate empty-string updates).
- **DTO mapping:** only in routers. Repositories return raw entities.
- **Labels for stored enum values** (status, tax codes, doc types...): render
  through label maps (STATUS_LABELS etc.); never translate the stored values
  themselves.
- **UI language:** user-visible strings are German; code, identifiers and
  docs are English. See docs/UI_MIGRATION_GLOSSARY.md for the binding
  glossary and the never-translate list.
- **Sensitive master data** (real names, IBANs, addresses): only in the
  gitignored `sample_data/internal-seed.json`; never in code, seeds or commit
  messages. See docs/SESSION_QUESTIONS.md for the history of this rule.
- **Large components:** pages > ~800 lines should be split when a second
  person works on them; the established split is per concern (table columns,
  form, detail tabs) as in InvoicePage.tsx. Do not preemptively split working
  pages.

## Print documents (invoices, contracts)

- Print routes live under the chrome-free `_print` layout route
  (`/invoices/$invoiceId/print`, `/events/$eventId/contract/print`)
- The document component renders an A4 sheet (`w-[210mm] p-[18..20mm]`,
  `@page { size: A4; margin: 0 }`); a screen-only toolbar (Back/Print) is
  hidden via `print:hidden`
- Invoices render from **frozen snapshots** (invoice_party_snapshot) —
  historically accurate; contracts render from **live master data** — they
  are drafted before the event
- Verification: `npx playwright test` generates the real printToPDF output
  and page PNGs in tests/e2e/__screenshots__/ — always inspect the PDF, not
  just the screenshot (pagination bugs are invisible in screenshots)
