# src/main/api - tRPC Contract Layer

**Score:** 15 · 60 files, 4.5k LOC (routers 22 / schemas 21 / mappers 15)

## OVERVIEW
Everything the renderer can call: one router per business object, zod DTOs and
inputs, and the only snake_case -> camelCase mapping in the app.

## STRUCTURE
| Path | Role |
|---|---|
| `router.ts` | merges 22 sub-routers into `router` + `AppRouter` (the renderer's type) |
| `routers/` | `<object>.router.ts`: procedures call a service, then map the result |
| `schemas/` | zod DTOs, `CreateXInput`/`UpdateXInput`, `PaginatedXResponse`, label maps |
| `mappers/` | static `toDto`/`toDtoList` classes, raw row -> DTO |

## WHERE TO LOOK
| Task | Location |
|---|---|
| Add a procedure | `routers/<object>.router.ts`, then register it in `router.ts` |
| Response/input shape | `schemas/<object>.schema.ts` (const + same-named `z.infer` type) |
| Field name conversion | `mappers/<object>.mapper.ts` |
| Pagination/sorting contract | `schemas/base.schema.ts` |
| Invoice state machine | `schemas/invoice.schema.ts` (`canRemind`, `nextInvoiceStatuses`, `isInvoiceLocked`) |
| Mail IPC surface | `routers/mail.router.ts` (`call`, `status`, `events` subscription) |

## CONVENTIONS
- Every router file calls its own `initTRPC.create()`; there is no shared
  `trpc.ts`, no middleware, no context and no auth. Procedures are plain
  `t.procedure`.
- Services are resolved once at module scope (`const xService =
  container.resolve(XService)`), never per request.
- Every zod const is followed by `export type X = z.infer<typeof X>` in the same
  file; consumers import the type.
- Lists use `PaginationInput` + `createPaginatedResponse(itemSchema)` ->
  `{ items, total, page, pageSize, totalPages }`.
- Mappers are the only snake_case -> camelCase boundary. Unit tests assert
  snake_case because services and repositories return raw rows.
- Schemas are main-process contracts, not router-only: `invoice.schema` is
  imported by 16 modules (repositories, einvoice, import, mail, db). A field
  change there ripples through the whole main process.
- Missing record: router throws `TRPCError({ code: 'NOT_FOUND' })`; services
  return `null` and the router decides.
- File naming is inconsistent by history: `deal_memo.router.ts` (snake) but
  `deal_memo.mapper.ts`; `follow_up.router.ts` but `followUp.mapper.ts`;
  `contact_list.router.ts` vs `contactList.schema.ts`. Match the neighbours of
  the file you touch instead of "fixing" it.
- Five routers import `electron` directly (`calendar`, `contact_list`,
  `document`, `export`, `settings`) for dialogs, clipboard and `shell`. Accepted
  here, not in services.

## ANTI-PATTERNS
- A schema-level default that only exists in the create input: the update path
  then re-applies it. `deal_memo.schema.ts` and `BandRepository.update` show the
  explicit-key pattern this file expects.
- Silent error swallowing: `invoice.router.ts` `previewParties` returns `null`
  on any throw.
- English fallback strings from mappers (`'Unknown company'`) in a German UI.
- Business rules in routers: state transitions belong in schema functions
  (`canChangeInvoiceStatus`) or services.

## HOTSPOTS
- `schemas/invoice.schema.ts` 359 - status/kind/reminder rules, print and
  e-invoice DTOs; the most-imported schema.
- `routers/invoice.router.ts` 16 procedures; `relation` 13; `company` 10.
- `mappers/invoice.mapper.ts` 234 - snapshots, line items, print DTOs.
