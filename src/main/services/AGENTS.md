# src/main/services - Business Logic

**Score:** 13 · 22 classes, 2.1k LOC, 134 import references

## OVERVIEW
`@injectable()` classes between the tRPC routers and the repositories: business
rules, orchestration, and the side effects that must follow a mutation.

## WHERE TO LOOK
| Task | Location |
|---|---|
| Object CRUD pass-through | `<Object>Service.ts` (thin wrapper over one repository) |
| Invoice status guards, reminders | `InvoiceService.ts` |
| E-invoice check, XML, PDF embedding | `EInvoiceService.ts` |
| Excel export of 8 lists | `ExportService.ts` |
| Mailing lists (Verteiler) | `ContactListService.ts` |
| Spreadsheet import, remembered mappings | `ImportService.ts` |
| Dashboard aggregates, global search | `DashboardService.ts`, `SearchService.ts` |
| ICS calendar feed | `CalendarFeedService.ts` |
| Settings, backup folder | `SettingsService.ts` |

## CONVENTIONS
- Constructor injection: `constructor(@inject(Repo) private repo: Repo) {}`.
  Exactly one `@singleton()` (`CalendarFeedService`) because it owns a debounce
  timer.
- Most services are thin. Real logic lives in `InvoiceService` (status guards),
  `EInvoiceService`, `ExportService` (column definitions), `ContactListService`
  (filters) and `ImportService`.
- After a mutation on a calendar-visible object (band, venue, deal memo, hotel)
  call `scheduleCalendarUpdate()`: it debounces one ICS rewrite and is a no-op
  without a configured feed path.
- After deleting a document owner (band, company, venue, person, deal memo)
  call `removeOwnerFolder(type, id)`: DB rows go via triggers, folders do not.
- Read-only aggregates bypass repositories on purpose: `DashboardService`,
  `SearchService`, `CalendarFeedService` and `SettingsService` query `db`/
  `schema` (or `getSqlite()`) directly - one IPC round-trip, small payload.
- Pure helpers are exported next to the class and unit-tested directly:
  `venueMatches`/`buildContactList`/`contactListCsv`, `mappingKey`,
  `backupFolderName`.
- Services return raw entities or `null` and throw plain `Error` with German
  messages; they never throw `TRPCError` (that is the router's job).

## ANTI-PATTERNS
- Importing `electron` in a service (none do): dialogs belong in routers or
  `index.ts`.
- Formatting money for display here instead of leaving cents intact.
- `console.error` as the only error channel is this folder's current smell (9
  sites, e.g. `BandService.ts:47`, `DocumentService.ts:97`); new code should
  propagate.
- Translating stored enum values - label maps live in `api/schemas/*`.

## HOTSPOTS
- `ExportService.ts` 375 - imports 8 services + 8 mappers; a new export column
  means editing `ListTable` here.
- `ContactListService.ts` 281 - filter predicates, heavily unit-tested
  (`tests/contact_list.test.ts`).
- `InvoiceService.ts` - the only place enforcing invoice status transitions
  before the repository writes.
