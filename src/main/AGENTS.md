# src/main - Electron Main Process

**Score:** 17 (subtree root) · 143 TS files, ~23k LOC

## OVERVIEW
Electron 44 main process: bootstrap and native IPC in `index.ts`, then a strict
router -> service -> repository -> SQLite stack. Several pure domain modules
here are also imported by the renderer.

## STRUCTURE
| Path | Role |
|---|---|
| `index.ts` | bootstrap: userData pinning, single-instance lock, windows, 14 `ipcMain.handle` channels, tRPC handler |
| `api/` | tRPC routers, zod DTOs, entity -> DTO mappers (the IPC contract) |
| `services/` | `@injectable()` business logic (tsyringe) |
| `repositories/` | Drizzle queries and transactions over `db` |
| `db/` | schema, migrations, lazy db handle, demo seed |
| `mailclient/` | IMAP mail client in a utility process; `core/` is self-contained |
| `einvoice/ import/ mail/ invoice/ calendar/ payment/` | pure feature modules, no Electron |
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
| Spreadsheet import | `import/` + `services/ImportService.ts` |

## CONVENTIONS
- Import direction is one-way: router -> service -> repository -> `db`. Only
  `api/mappers` converts snake_case rows to camelCase DTOs; everything below
  returns raw rows.
- DI: `@injectable()` classes, constructor `@inject(Repo)`; routers resolve
  services at module scope via `container.resolve(...)`. `reflect-metadata` is
  imported once, in `index.ts`.
- `einvoice/`, `import/`, `invoice/`, `calendar/`, `payment/` and the template
  parts of `mail/` are pure: no Electron, and the renderer imports them by
  relative path (there is no `@main` alias).
- Money is integer cents; rounding happens only in `einvoice/amounts.ts`.
- User-visible strings are German, identifiers/comments English; stored enum
  values are never translated - render through label maps (`docs/UI_LANGUAGE.md`).
- Named exports only, no default exports.
- Environment: `BOOKINGIUM_USER_DATA` (data folder), `BOOKINGIUM_NO_LAUNCH=1`
  (no mail program). Tests also read `KOSIT_*` / `VERAPDF`.

## ANTI-PATTERNS (THIS PROJECT)
- An async `db.transaction` callback: better-sqlite3 commits synchronously, so the
  write is silently lost. See `repositories/AGENTS.md` for the `tx` idiom.
- `.partial()` on an `UpdateXInput` whose create input has
  `.optional().default()` - defaults are re-applied and columns are wiped; merge
  with `input.x ?? existing.x` (regression: `tests/company.test.ts`).
- Editing an applied migration or `db/migrations/meta/*` - `db/AGENTS.md` has the
  drizzle-kit pitfalls (`ON DELETE` on `ADD COLUMN`, `PRAGMA foreign_keys`).
- Real master data (names, IBANs, addresses, signatures) in code, seeds, tests or
  commit messages - only the gitignored `sample_data/internal-seed.json`.
- Sending mail from the app: the mail client (`mailclient/`) **does** transmit over SMTP
  for writable accounts. Only the legacy `mail/` path and the `invoice:email` channel
  write files and open the user's mail program.
- Importing `electron` eagerly from `db/` or the pure modules (`db/index.ts` wraps
  it in `try { require('electron') } catch` with a temp-dir fallback).

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
- Error contract: routers throw `TRPCError({ code: 'NOT_FOUND' })`, services
  return `null`; services otherwise report through `console.error`.
