# src/main - Electron Main Process

## OVERVIEW
Electron 44 main process: bootstrap and native IPC in `index.ts`, then a strict
router -> service -> repository -> SQLite stack. Several pure domain modules
here are also imported by the renderer. `db/`, `einvoice/`, `mailclient/` and
`mailclient/core/` have their own AGENTS.md; this file covers the rest.

## STRUCTURE
| Path | Role |
|---|---|
| `index.ts` | bootstrap: userData pinning, single-instance lock, windows, `ipcMain.handle` channels, tRPC handler |
| `api/` | tRPC routers, zod DTOs, entity -> DTO mappers (the IPC contract) |
| `services/` | `@injectable()` business logic (tsyringe) |
| `repositories/` | Drizzle queries and transactions over `db` |
| `db/` | schema, migrations, lazy db handle, demo seed |
| `mailclient/` | IMAP mail client in a utility process; `core/` is self-contained |
| `einvoice/ import/ csv/ mail/ invoice/ calendar/ payment/` | pure feature modules, no Electron |
| `backup/` | backup policy (folder names, retention, due) |
| `utils/` | document/logo storage and path guards |

## WHERE TO LOOK
| Task | Location |
|---|---|
| Add/change a tRPC procedure | `api/routers/<object>.router.ts` |
| Change the DTO/input contract | `api/schemas/<object>.schema.ts` |
| Business rule | `services/<Object>Service.ts` |
| New table or migration | `db/schema.ts`, then `pnpm db:generate` |
| Native dialog/print/mail IPC channel | `index.ts` + `src/preload/index.ts` + `index.d.ts` |
| Money, VAT, XML, payment QR | `einvoice/`, `invoice/`, `payment/` |
| CSV import | `import/` + `csv/` + `services/ImportService.ts` |

## CONVENTIONS
- Import direction is one-way: router -> service -> repository -> `db`. Only
  `api/mappers` converts snake_case rows to camelCase DTOs; everything below
  returns raw rows.
- DI: `@injectable()` classes, constructor `@inject(Repo)`. `reflect-metadata` is
  imported once, in `index.ts`. The two `@singleton()`s own timers
  (`CalendarFeedService`, `BackupService`).
- `einvoice/`, `import/`, `invoice/`, `calendar/`, `payment/` and the template
  parts of `mail/` are pure: no Electron, and the renderer imports them by
  relative path (there is no `@main` alias).
- Named exports only, no default exports.
- Environment: `BOOKINGIUM_USER_DATA` (data folder), `BOOKINGIUM_NO_LAUNCH=1`
  (no mail program). Tests also read `KOSIT_*` / `VERAPDF`.

### api/
- Every router file calls its own `initTRPC.create()`; no shared `trpc.ts`, no
  middleware, no context. Services are resolved once at module scope
  (`const xService = container.resolve(XService)`), never per request.
- Every zod const is followed by `export type X = z.infer<typeof X>`. Lists use
  `PaginationInput` + `createPaginatedResponse(itemSchema)`.
- Schemas are main-process contracts, not router-only: a field change in
  `invoice.schema.ts` ripples through repositories, einvoice, import and mail.
- Missing record: the router throws `TRPCError({ code: 'NOT_FOUND' })`; services
  return `null` and throw plain `Error` with German messages, never `TRPCError`.
- File naming is inconsistent by history (`deal_memo.router.ts` but
  `followUp.mapper.ts`). Match the neighbours of the file you touch.
- Routers may import `electron` for dialogs, clipboard and `shell`; services may not.
- Business rules belong in schema functions (`canChangeInvoiceStatus`) or
  services, not in routers. Mapper fallbacks are German.

### services/
- After a mutation on a calendar-visible object (band, venue, deal memo, hotel)
  call `scheduleCalendarUpdate()`.
- After deleting a document owner (band, company, venue, person, deal memo) call
  `removeOwnerFolder(type, id)`: DB rows go via triggers, folders do not.
- Read-only aggregates (`DashboardService`, `SearchService`,
  `CalendarFeedService`, `SettingsService`) query `db` directly on purpose.
- Pure helpers are exported next to the class and unit-tested directly.
- New code propagates errors instead of only calling `console.error`.

### repositories/
- Every list method takes bounds from `listPage(pagination)` and order from
  `listOrder(pagination, columns, fallback, tiebreak)`. The `columns` keys are
  the renderer's column ids - a column missing there cannot be sorted in the UI.
- Transactions are synchronous: `db.transaction((tx) => { ... })`. Shared logic
  takes a `tx` typed `Parameters<Parameters<typeof db.transaction>[0]>[0]`.
- Partial updates merge against the current row (`data.name ?? prev.name`,
  `!== undefined` for nullable foreign keys).
- Upsert (`onConflictDoUpdate`) only for 1:1 companions and value tables;
  business objects get `create` + `update`.
- Repositories never import `electron`, never log, never return DTO-shaped
  objects and never do money arithmetic by hand (`einvoice/amounts`).

## ANTI-PATTERNS
- An async `db.transaction` callback: better-sqlite3 commits synchronously, so the
  write is silently lost.
- `.partial()` on an `UpdateXInput` whose create input has
  `.optional().default()` - defaults are re-applied and columns are wiped; merge
  with `input.x ?? existing.x` (regression: `tests/company.test.ts`).
- Editing an applied migration or `db/migrations/meta/*` - see `db/AGENTS.md`.
- Real master data (names, IBANs, addresses, signatures) in code, seeds, tests or
  commit messages - only the gitignored `sample_data/internal-seed.json`.
- Assuming the app never sends mail: the mail client (`mailclient/`) **does** transmit over
  SMTP for writable accounts, and so does `invoice:email` when the mail program is bookingum
  (it opens the compose window on the chosen sending account). Only the legacy `mail/` path and the
  other mail-program settings write files and open the user's mail program.
- Importing `electron` eagerly from `db/` or the pure modules (`db/index.ts` wraps
  it in `try { require('electron') } catch` with a temp-dir fallback).
- Fetching a whole table into JS for a list the grid paginates; `toFixed` or a
  second rounding helper on money.
- Silent error swallowing in routers (`invoice.router.ts` `previewParties`
  returns `null` on any throw - do not copy it).

## COMMANDS (MAIN PROCESS ONLY)
```bash
pnpm dev                      # also builds mailclient/worker.ts (out/main/mailWorker.js)
pnpm typecheck:node           # tsc over tsconfig.node.json = src/main + src/preload
pnpm validate:einvoice        # KoSIT + veraPDF against tests/e2e/einvoice.spec.ts
pnpm db:generate              # schema.ts -> src/main/db/migrations
```

## NOTES
- `api/router.ts` still registers a demo `greeting` procedure with an
  `EventEmitter`; unused by the UI.
