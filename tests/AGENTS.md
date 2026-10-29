# tests/ - KNOWLEDGE BASE

## OVERVIEW
Vitest unit/integration suites (~6.1k LOC) that drive services, repositories and
pure helpers against an in-memory SQLite built by the REAL drizzle migrations.
Browser-level coverage lives in `e2e/` (Playwright, separate runner).

## STRUCTURE
```
tests/
├── *.test.ts     # one suite per business subject; no index/barrel
├── helpers/      # setupTestDb + e-invoice fixtures (shared)
└── e2e/          # Playwright specs (see e2e/AGENTS.md)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Invoice / payment QR / documents | `invoice*.test.ts`, `payment_qr.test.ts`, `document.test.ts` | largest cluster |
| E-invoice validators | `einvoice.kosit.test.ts`, `einvoice.verapdf.test.ts` | env-gated, skip without tools |
| Mail client core | `mail_*.test.ts` | store, migrations, write queue, compose |
| CRUD + relations | `company*.test.ts`, `person_relations`, `contact_list`, `management_*` | service-level roundtrips |
| Import / export / search | `import*.test.ts`, `export.test.ts`, `list_query`, `search` | normalizer + mapping |
| Schema + settings | `migrations.test.ts`, `settings.test.ts` | real migration chain |
| Pure helpers | `germanNumbers.test.ts`, `parseAmount.test.ts` | no DB |
| DB bootstrap | `helpers/setup.ts` | `setupTestDb` / `getTestDb` |
| E-invoice fixtures | `helpers/einvoiceFixtures.ts` | `party`, `buyer`, `invoice`, `EINVOICE_SAMPLES` |

## CONVENTIONS
- DB suites start with `import 'reflect-metadata'`, then `setupTestDb()` at MODULE
  top level (it registers `beforeAll`/`afterAll`). Never call it inside a `describe`.
- Resolve services from the tsyringe `container`; a few suites import repositories directly.
- Assert snake_case column names and raw stored enum strings - DTO camelCase only
  appears where a service/router returns a DTO.
- Factories are local `Partial<T>` override helpers (`fullInput`, `event`, `party`)
  with the override spread last.
- Fixtures are fictitious and German; German UI labels (`Rechnungen`, `Drucken / Als
  PDF speichern`) appear literally in assertions.
- Temp dirs: `mkdtempSync(join(tmpdir(), 'bookingum-<area>-'))` with `afterAll` cleanup.
- vitest: `tests/**/*.test.ts` only, node env, 15s timeout, `@` alias -> renderer src.
- No snapshot testing, no custom matchers, no `tests/index.ts`.

## ANTI-PATTERNS
- Never `describe.skip`/`it.skip` to silence a red suite. `skipIf` exists only for absent
  external validators (KoSIT jar+config, veraPDF binary); mail skips are sandbox-absence guards.
- Never edit an applied migration to make a test pass - add a new migration.
- `einvoice.verapdf.test.ts` reads `e2e/__screenshots__/einvoice-*.pdf` from an earlier
  `playwright test tests/e2e/einvoice.spec.ts` run; without it the suite self-skips - not a pass.
- Never real master data (names, IBANs, addresses) - only gitignored `sample_data/`.
- Do not add a second `setupTestDb()` per file or a per-`describe` DB reset.

## HOTSPOTS
- `src/main/db/schema` and `src/main/db/index` are imported by most DB suites - schema and
  migration edits ripple widest.

## COMMANDS
```bash
pnpm test                                      # vitest run
npx vitest run tests/einvoice.test.ts          # one suite
KOSIT_VALIDATOR=… KOSIT_CONFIG=… pnpm vitest run tests/einvoice.kosit.test.ts
VERAPDF=… pnpm vitest run tests/einvoice.verapdf.test.ts   # after the e2e run
```
Gate order: `pnpm test && pnpm lint && pnpm typecheck && pnpm build`, then the e2e suite.
