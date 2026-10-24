# PROJECT KNOWLEDGE BASE

**Generated:** 2026-10-24
**Commit:** 5dd65f6
**Branch:** feat/mail-client

## OVERVIEW
Bookingium - local-first Electron desktop app for concert booking and band management (events, contracts, invoices, bands, venues, contacts). Electron 44 main process + React 19 renderer, SQLite via Drizzle, tRPC over IPC, German UI. `docs/ARCHITECTURE.md` is the long-form guide; the files below are the index agents need.

## STRUCTURE
```
bookingum-app/
├── src/main/          # main process: bootstrap, api/, services/, repositories/, db/, mailclient/
├── src/preload/       # contextBridge API (window.api) + electron-trpc
├── src/renderer/src/  # React app: router, pages/, components/, lib/, hooks/
├── tests/             # vitest suites (in-memory SQLite) + e2e/ Playwright specs
├── docs/              # ARCHITECTURE, UI_LANGUAGE, TODOS, mail-client notes
├── scripts/           # dev-only .mjs CLIs (e-invoice validators, icons, mail sandbox)
└── sample_data/       # gitignored real master data (see ANTI-PATTERNS)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| New business object, end to end | `docs/ARCHITECTURE.md` | 13-step recipe: schema -> migration -> zod -> repo -> service -> mapper -> router -> form -> list page -> detail page -> seed -> tests -> gates |
| Add a tRPC procedure | `src/main/api/routers/` | input parsed by zod in `api/schemas/` |
| Renderer route | `src/renderer/src/router.tsx` + `lib/routing.ts` | `ROUTES` drives menu order and Alt+<n> shortcuts |
| Print / PDF output | `src/renderer/src/components/print/`, `contract/`, `invoice/` | `_print` layout is chrome-free |
| E-invoice (ZUGFeRD/XRechnung) | `src/main/einvoice/` | check-first, then XML |
| IMAP mail client | `src/main/mailclient/` | host service + utility-process worker |
| German UI wording | `docs/UI_LANGUAGE.md` | label maps, never translate stored values |

## CODE MAP
Refs = files referencing the symbol, measured with grep -rl (module importers for `db`/`schema`, test suites for `setupTestDb`).

Only the symbols that cross a subtree boundary are listed here; per-area tables live in the child files.

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `PaginationInput` | zod schema | `src/main/api/schemas/base.schema.ts` | 27 | list/search/sort input every list procedure takes |
| `db` | lazy Proxy | `src/main/db/index.ts` | 23 | every repository's handle; `useTestDb` swaps it in tests |
| `schema` | 27-table registry | `src/main/db/schema.ts` | 34 | drizzle tables used by repositories, services, seed |
| `setupTestDb` | function | `tests/helpers/setup.ts` | 18 | in-memory SQLite + real migrations |

## CONVENTIONS
- Layer flow is one-way and camelCase conversion happens at exactly one seam: renderer -> router (zod input) -> service (tsyringe) -> repository (drizzle) -> SQLite, with `api/mappers` producing DTOs. Unit tests assert snake_case.
- Main-process contract reaches the renderer as TYPES by relative path (`../../../main/api/schemas/*`); there is no `@main` alias. Pure main modules (`einvoice/`, `import/`, `invoice/`, `calendar/`, `payment/`) are imported directly by the renderer and must stay free of Electron and Node.
- Money is integer cents. `src/main/einvoice/amounts.ts` is the only place rounding happens.
- English identifiers, comments, docs and commits; German user-facing copy inline, with no i18n framework.
- pnpm 12 / Node 24. `pnpm-workspace.yaml` allowlists install scripts - add a package there only when it genuinely needs a build step.

## ANTI-PATTERNS (THIS PROJECT)
- `db.transaction(async (tx) => ...)` - better-sqlite3 is synchronous, so the write is silently lost.
- `.partial()` on an `UpdateXInput` whose create input uses `.optional().default()` - defaults are re-applied and columns wiped. Merge with `input.x ?? existing.x`.
- Editing an applied migration or `src/main/db/migrations/meta/*`. Add a new migration and review the generated SQL: drizzle-kit drops `ON DELETE` on `ADD COLUMN`.
- Real master data (names, IBANs, addresses, signatures) in code, seeds, tests or commit messages - only the gitignored `sample_data/internal-seed.json`.
- Sending mail from the app. `mail/` and the `invoice:email` channel write files and open the user's mail program; nothing is transmitted.
- Translating stored enum values. Render them through label maps.
- A second tRPC client in the renderer - electron-trpc keys responses by operation id.

## UNIQUE STYLES
- Tab state of detail pages lives in the URL (`?tab=`), guarded by an `is<Tab>()` check in the route.
- Lists scroll as one table: `useInfiniteQuery` + `useListSorting` + `DataTable` pins toolbar, headers and status line.
- No barrel files in the renderer - always import the module path. The one deliberate entry module is `src/main/mailclient/core/index.ts`, the mail core's public factory surface.
- Two main-process entry points are built (`index.ts` and `mailclient/worker.ts`), which is why `pnpm dev` emits `out/main/mailWorker.js`.

## COMMANDS
```bash
pnpm dev                 # electron-vite dev with HMR
pnpm test                # vitest (in-memory SQLite, real migrations)
pnpm lint                # eslint --cache .
pnpm typecheck           # tsc for node and web configs
pnpm build               # typecheck + electron-vite build
npx playwright test      # e2e; requires pnpm build first
pnpm db:generate         # schema.ts -> src/main/db/migrations
pnpm validate:einvoice   # KoSIT + veraPDF, needs Java 11+
```

## NOTES
- Quality gate order: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`, then `npx playwright test`.
- E2E runs get a fresh temporary data folder per launch; `BOOKINGIUM_E2E_USER_DATA` points them at a copy, `BOOKINGIUM_NO_LAUNCH=1` suppresses mail-program launches.
- Print verification means inspecting the generated PDF in `tests/e2e/__screenshots__/`, not the screenshot: pagination bugs are invisible in PNGs.
- `docs/ARCHITECTURE.md` covers migrations, print documents, e-invoices, mailing lists and follow-ups in depth. Read it before touching those areas.
