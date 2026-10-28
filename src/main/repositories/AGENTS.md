# src/main/repositories - Data Access

**Score:** 10 · 20 files, 4.9k LOC, 120 import references

## OVERVIEW
Drizzle queries over better-sqlite3, one `@injectable()` class per table group.
Every method returns raw snake_case rows; no DTO mapping happens here.

## WHERE TO LOOK
| Task | Location |
|---|---|
| Grid paging + sorting for any list | `listQuery.ts` (`listPage`, `listOrder`) |
| Invoice CRUD, snapshots, Storno, history | `InvoiceRepository.ts` (1.3k LOC) |
| Company/person/venue create with address+contact+bank | `CompanyRepository.ts`, `PersonRepository.ts`, `VenueRepository.ts` |
| Contract parties (own company, representatives) | `contractParties.ts` |
| Invoices created by a management share | `ManagementShareRepository.ts` |
| Settings key/value | `SettingsRepository.ts` |
| Import matching against existing records | `ImportRepository.ts` |

## CONVENTIONS
- Every list method takes bounds from `listPage(pagination)` (an infinite-query
  `cursor` overrides `page`) and order from
  `listOrder(pagination, columns, fallback, tiebreak)`. The `columns` keys are
  the renderer's column ids - a column missing there cannot be sorted in the UI.
- `import { db } from '../db'` + `import { schema } from '../db/schema'` is the
  default; older modules import individual tables (`CompanyRepository`).
- Transactions are synchronous: `db.transaction((tx) => { ... })`. Shared logic
  takes a `tx`; the local type idiom is
  `type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]`.
- Partial updates merge against the current row (`data.name ?? prev.name`, and
  `!== undefined` for nullable foreign keys); no `.partial()` default
  re-application.
- `create` + `update` for business objects; upsert (`onConflictDoUpdate`) only
  for 1:1 companions (`itinerary`) and value tables (`company_invoice_settings`,
  `app_setting`).
- Repositories never import `electron`, never log, and never do money arithmetic
  by hand (`computeInvoiceAmounts`/`fromCents` from `einvoice/amounts`).
- Cross-repository use is constructor injection; only
  `ManagementShareRepository` injects another repository (`InvoiceRepository`).

## ANTI-PATTERNS
- Async transaction callbacks and `.partial()` defaults (parent rules) hurt here
  most: a lost write or a wiped column surfaces as a silent data bug.
- Returning camelCase or DTO-shaped objects from a repository.
- Fetching a whole table into JS for a list the grid paginates.
- A second rounding helper, or `toFixed` on money.
- Editing an applied migration instead of adding one (see `db/AGENTS.md`).

## HOTSPOTS
- `InvoiceRepository.ts` 1305 - the largest file in the repo: CRUD, party
  snapshots, line-item normalization, Stornorechnung, status history, emails and
  `overdueInvoiceWhere` (also used by `DashboardService`).
- `ImportRepository.ts` 403 / `CompanyRepository.ts` 380 - multi-table
  transaction logic.
- `listQuery.ts` is tiny but every paginated endpoint depends on it.
