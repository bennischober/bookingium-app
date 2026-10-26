# src/renderer/src/pages - KNOWLEDGE BASE

**Score:** 10 (23 files, 27 exports, 387 import refs) - one route component per page, the
largest single fan-in in the renderer.

## OVERVIEW
Flat directory, no subdirectories, no `index.ts`: one `.tsx` per route, all of them default
exported and imported only by `router.tsx` via `@/pages/<Name>Page`.

## WHERE TO LOOK
| Task | Page | Notes |
|------|------|-------|
| Dashboard / Kalender | `DashboardPage.tsx`, `CalendarPage.tsx` | calendar has its own tab list |
| List pages (band, person, company, venue, hotel, bank, event, invoice, contact list) | `BandPage.tsx` … | the shared list recipe below |
| Detail pages (tabs in `?tab=`) | `BandDetailPage`, `PersonDetailPage`, `CompanyDetailPage`, `VenueDetailPage`, `EventHubPage`, `SettingsPage` | tab guards live in `components/<obj>/constants.ts` |
| Invoice detail | `InvoiceDetailPage.tsx` | status changes, e-invoice check, history |
| Print routes (`_print` layout) | `InvoicePrintPage`, `ContractPrintPage`, `ManagementContractPrintPage` | chrome-free; see `components/print/AGENTS.md` |
| Mail | `MailPage.tsx` (1417L, largest), `MailWindowPage.tsx` | mail window is its own root route |
| Contact lists (Verteiler) | `ContactListPage.tsx` (615L) | filters + infinite list + booking history |

## CONVENTIONS
- **List page recipe** (9 pages): `useListSorting(<key>, default)` + `useState` search +
  `trpcReact.<obj>.getAllPaginated.useInfiniteQuery({ pageSize: LIST_CHUNK_SIZE, … }, infiniteListOptions)`,
  rows via `listRows(data)` / `listTotal(data)`, render through `DataTable`, sheet via
  `useFormSheet<Dto>()`, `useListSearchActions({ onCreate, onOpen })`, `confirmAction` before
  delete, `utils.<router>.getAllPaginated.invalidate()` after a mutation.
- Pages own data fetching and pass plain props down (`event`, `isEditing`, `onSaved`); feature
  components below `components/` do not fetch page data.
- Detail pages: `Route.useParams()` for the id, `useSearch` for the tab, one `trpcReact` query
  for the record, sub-tabs composed from `components/<feature>/`.
- Export style: all 23 use `export default`; `CompanyPage`, `EventPage`, `EventHubPage`,
  `PersonPage` additionally export the named function, which nothing imports - follow the default
  export only.
- Mutations surface errors as `toast.error(...)` with the German message; do not add a second
  error channel.

## ANTI-PATTERNS
- `ContractPrintPage.tsx` / `ManagementContractPrintPage.tsx` read live master data with
  `cacheTime: 0` - "never render a cached copy". Invoices are the opposite (frozen snapshot).
  Do not add caching to the contract print pages.
- `EventPage.tsx:25` carries a TODO about hard-coded event status strings; the status maps there
  are local. Do not spread another copy of them - reuse `components/event-hub/constants.ts`.
- Never give a print page app chrome or a shared list header; it prints via `printToPDF`.
- Do not duplicate `DataTable`/`FormSheet` wiring per page - extend the shared components.
- No page-level tRPC client, no direct `trpcVanilla` from a component body during render.

## HOTSPOTS
- `MailPage.tsx` 1417L (list + accounts + compose entry), `ContactListPage.tsx` 615L,
  `PersonDetailPage.tsx` 469L, `CompanyDetailPage.tsx` 406L, `SettingsPage.tsx` 370L.
- Shared infra every list page depends on: `components/data-table.tsx` (9 pages),
  `components/form-sheet.tsx` (11 pages), `components/export/ExportButton.tsx` (8),
  `components/import/ImportButton.tsx` (4), `components/MembersSheet.tsx` (5).

## COMMANDS
```bash
pnpm dev
pnpm typecheck:web
npx playwright test tests/e2e/list.spec.ts tests/e2e/navigation.spec.ts
```
