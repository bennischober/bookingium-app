# src/renderer/src - KNOWLEDGE BASE

## OVERVIEW
Electron renderer: React 19 + TanStack Router (hash history) + TanStack Query v4 over ONE
electron-trpc client. UI copy is German, identifiers/comments English. `../index.html` is the
Vite entry that mounts `main.tsx`.

## STRUCTURE
```
src/renderer/src/
├── main.tsx       # ReactDOM root: QueryClient, tRPC/Query/Theme providers, global hosts
├── router.tsx     # every route; _app (with chrome) and _print (chrome-free) layouts
├── pages/         # one component per route
├── components/    # shared infra at the root, one feature dir per object or concern
│   ├── ui/        # shadcn-style primitives only
│   ├── mail/      # mail client views + pure helpers
│   └── layout/    # root chrome: RootLayout, breadcrumbs, history nav, quick-create
├── lib/           # non-hook helpers: trpc, routing, confirm, labels, formatting
├── hooks/         # reusable hooks (list query, form sheet, stored prefs) + MailPage's hooks
└── assets/index.css   # Tailwind 4 import + oklch tokens (:root / .dark)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add/rename a route | `router.tsx` + `lib/routing.ts` | `ROUTES` order = menu order AND Alt+<n> shortcut order |
| Call the API | `lib/trpc.ts` | `trpcReact` (hooks), `trpcVanilla` (outside React) |
| List paging/sorting | `hooks/useListQuery.ts` | `LIST_CHUNK_SIZE`, `useListSorting`, `infiniteListOptions`, `listRows`, `listTotal` |
| `?create=true` / `?open=<id>` | `hooks/useListSearchActions.ts` | runs once, then strips the search from the URL |
| Create/edit sheet | `hooks/useFormSheet.ts` + `components/form-sheet.tsx` | `FormMode` = `'create' | 'edit'` |
| Any list page's table | `components/data-table.tsx` | sorting, infinite scroll, pinned actions column |
| Confirm dialog | `lib/confirm.ts` + `components/ConfirmDialogHost.tsx` | `confirmAction()` returns a Promise |
| Detail-page building blocks | `components/detail/DetailParts.tsx` | `InfoCard`, `Fields`, `AddressLines`, `RowTable` |
| Per-object tabs | `components/<obj>/constants.ts` | `<X>_TABS`, `is<Tab>()` - used by the route's `?tab=` guard |
| A4 print documents | `components/print/PagedDocument.tsx` | renders the real printToPDF output via pdf.js |
| Stored enum labels | `lib/invoiceLabels.ts`, `components/*/constants.ts` | never translate a stored value |
| Dates / money / numbers | `lib/followUps.ts`, `lib/germanNumbers.ts`, `lib/utils.ts` | `de-DE` everywhere |

## CONVENTIONS
- Aliases: `@/*` -> `src/renderer/src` (use this). `@renderer/*` also resolves but is unused -
  do not revive it.
- Main-process contract is imported directly as types by relative path
  (`../../../main/api/schemas/band.schema`); there is no `@main` alias.
- Query client defaults in `main.tsx`: `staleTime: 60_000`, `refetchOnWindowFocus: false`,
  `retry: 1` (local-first app) - do not re-tune per query without reason.
- Naming: PascalCase `.tsx` for pages/domain components, kebab-case for `components/ui/*` and
  generic infra (`data-table.tsx`, `form-sheet.tsx`, `layout/`), camelCase `.ts` for helpers.
- No barrel/`index.ts` anywhere; always import the module path. Tabs of detail pages live in the
  URL (`?tab=`), validated by an `is<Tab>()` guard in the route.
- Tailwind 4: CSS vars in arbitrary values use `w-(--var)`; the v3 form `w-[--var]` is invalid
  (a freshly generated shadcn primitive may still carry it - convert it on the way in).
- Pages own data fetching and pass plain props down; list pages follow the same recipe
  (`useListSorting` + `useInfiniteQuery` + `DataTable` + `useFormSheet` + `confirmAction`).
  Pages use `export default`; components use named function exports (no `React.FC`).
- Mutations surface errors as `toast.error(...)` with the German message.
- Pure logic that deserves tests goes in a `.ts` module next to the component, because vitest
  runs in a node environment with no DOM.
- Shared cross-feature components belong at the `components/` root, not in a new `shared/` dir.
- `components/ui/`: keep the generated shape (`data-slot`, `cn(...)`, function declaration),
  no API calls or business rules (`search-command-button.tsx` is the one exception). Wrap
  generated primitives (`sidebar.tsx`, `calendar.tsx`) instead of editing them into app
  components. Radix and `@base-ui/react` coexist - follow the neighbouring file.
- `components/mail/`: data goes through `mailApi` (`@/lib/mailApi`), not `trpcReact`, with
  `accountId` as the last argument. `MailPage` and the standalone `MailWindowPage` reuse these
  views, so keep them free of page-level state. Read `docs/mail-client.md` first.

## ANTI-PATTERNS
- Never create a second tRPC client: electron-trpc matches responses by operation id, which
  restarts at 1 per client (`lib/trpc.ts`).
- Never put app chrome on a `_print` route - printToPDF captures the window.
- Modal sheets/dialogs must call `keepOpenOnToast` on outside-interaction handlers, or clicking
  a toast ("Rückgängig") closes them.
- Do not split a working page preemptively; split per concern when you touch it.
- No real master data (names, IBANs, addresses, signatures) in code, seeds or tests - only the
  gitignored `sample_data/`.
- Mail content never becomes HTML in the app's own DOM: no `dangerouslySetInnerHTML` (there is
  none in the renderer). Search hits are split into text parts by `snippetParts()`.
- Stored mail passwords are never shown again (`settings/MailAccountsCard.tsx`); no reveal path.
- `mail/FolderTree.tsx` drop handlers must tolerate foreign drags (files).
- Signature blocks in `contract/*Document.tsx` must never split across pages or stand alone.
- `print/PagedDocument.tsx` prints the real `printToPDF` output; content flows across pages by
  design. Do not "fix" pagination by pinning whole sections.
- `ContractPrintPage.tsx` / `ManagementContractPrintPage.tsx` read live master data with
  `cacheTime: 0`; invoices print a frozen snapshot. Do not add caching to the contract prints.
- `event-hub/*Tab.tsx` save/cancel effects keyed on `saveSignal`/`cancelSignal` carry an
  `exhaustive-deps` suppression plus a Strict-Mode guard ref. Copy the whole pattern or none of it.
- Event status maps: reuse `components/event-hub/constants.ts`; do not add another copy.

## COMMANDS
```bash
pnpm dev                 # electron-vite dev, HMR
pnpm typecheck:web       # tsc -p tsconfig.web.json (covers all renderer files)
pnpm lint                # eslint --cache .
pnpm test                # vitest, node env - pure renderer helpers only
pnpm build               # typecheck + electron-vite build
```

## NOTES
- No renderer component tests exist; vitest covers pure helpers (`lib/`, `components/mail/*.ts`).
- Print pages are separate route components, not modes of the detail pages.
- ESLint relaxes `react-refresh/only-export-components` and two `react/*` rules for
  `components/ui/**` only - do not copy those suppressions elsewhere.
