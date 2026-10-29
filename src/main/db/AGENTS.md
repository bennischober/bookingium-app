# src/main/db - Schema, Migrations, Seed

**Score:** 9 (distinct domain: every table and migration lives here) · 4 modules + 10 migrations

## OVERVIEW
Drizzle schema for 27 tables, the append-only migration chain, a lazy/overridable
database handle, and the demo seed.

## WHERE TO LOOK
| Task | Location |
|---|---|
| Add/change a table | `schema.ts`, then `pnpm db:generate` |
| Lazy handle, WAL, test swap | `index.ts` (`getDb`, `getSqlite`, `getDbPath`, `useTestDb`, `db` proxy) |
| Migration runner, legacy adoption | `migrate.ts` (`runMigrations`, `upgradeLegacyDatabase`, `setMigrationsFolder`) |
| Demo data | `seed.ts` |
| Generated SQL | `migrations/0000_initial.sql` .. `0009_invoice_email_kind.sql` |
| Generated snapshots | `migrations/meta/*` (do not touch) |

## CONVENTIONS
- `db` is a `Proxy` resolving `getDb()` on first property access, so importing a
  repository has no side effects - this is what makes `useTestDb` work. Outside
  Electron the path falls back to `$TMP/bookingum-test`.
- Tables are snake_case (`deal_memo`, `invoice_party_snapshot`), integer
  autoincrement `id`, `created_at` default `datetime('now')`, explicit FK
  `onDelete`, indexes on name columns, booleans as
  `integer(..., { mode: 'boolean' })`. Add every new table to the `schema` object
  at the bottom of `schema.ts`; both `schema.x` and direct table imports are in use.
- Migrations are generated from `schema.ts` (`drizzle.config.ts`: sqlite, out
  `./src/main/db/migrations`). Pre-2026-10 migrations were squashed into
  `0000_initial`; `upgradeLegacyDatabase` adopts older databases via
  `LEGACY_FINAL_MIGRATION_MILLIS`.
- Document ownership has no FK: `owner_type` + `owner_id`, with triggers in the
  initial migration deleting rows when the owner goes.
- Seeding runs only on an empty database and reads demo data; real master data
  comes from the gitignored `sample_data/internal-seed.json`.
- `seed.ts` is the only file here that logs (`console.log` progress).

## ANTI-PATTERNS
- Touching an already-shipped file in `migrations/` or its `meta/*.json`
  snapshot: the whole chain is append-only, so the fix is always the next number.
  The 1.0.0 history is pinned by `tests/migration_upgrade.test.ts`; never update that list.
- Accepting generated SQL unreviewed: drizzle-kit drops `ON DELETE` for foreign
  keys added with `ADD COLUMN`; rebuild the table or repair by hand.
- Relying on `PRAGMA foreign_keys=OFF` inside a migration - it is a no-op inside
  the migrator transaction; `runMigrations` disables FK enforcement around it and
  runs `foreign_key_check` afterwards.
- Hand-written SQL (triggers, data backfills) outside a custom migration
  (`drizzle-kit generate --custom`), leaving the snapshot out of sync.
- Importing `electron` eagerly - `index.ts` and `migrate.ts` use
  `try { require('electron') } catch` so tests can import them.

## COMMANDS
```bash
pnpm db:generate   # schema.ts -> new migration, then review the SQL
pnpm db:migrate
pnpm db:push       # dev only, no migration file
pnpm db:studio
pnpm test          # tests/migrations.test.ts + tests/list_query.test.ts
```
