# src/renderer/src - KNOWLEDGE BASE

**Score:** 5 (3 root files + 165 recursive, 1143 import refs) - subtree root: every renderer
import resolves through here.

## OVERVIEW
Electron renderer: React 19 + TanStack Router (hash history) + TanStack Query v4 over ONE
electron-trpc client. UI copy is German, identifiers/comments English. `../index.html` is the
Vite entry that mounts `main.tsx`.

## STRUCTURE
```
src/renderer/src/
├── main.tsx       # ReactDOM root: QueryClient, tRPC/Query/Theme providers, global hosts
├── router.tsx     # every route; _app (with chrome) and _print (chrome-free) layouts
├── pages/         # one component per route - see pages/AGENTS.md
├── components/    # shared infra + feature dirs - see components/AGENTS.md
├── lib/           # non-hook helpers: trpc, routing, confirm, labels, formatting
├── hooks/         # reusable hooks (list query, form sheet, stored prefs)
└── assets/index.css   # Tailwind 4 import + oklch tokens (:root / .dark)
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Add/rename a route | `router.tsx` + `lib/routing.ts` | `ROUTES` order = menu order AND Alt+<n> shortcut order |
| Call the API | `lib/trpc.ts` | `trpcReact` (hooks), `trpcVanilla` (outside React) |
| List paging/sorting | `hooks/useListQuery.ts` | `LIST_CHUNK_SIZE` 100, `useListSorting`, `infiniteListOptions`, `listRows`, `listTotal` |
| `?create=true` / `?open=<id>` | `hooks/useListSearchActions.ts` | runs once, then strips the search from the URL |
| Create/edit sheet | `hooks/useFormSheet.ts` + `components/form-sheet.tsx` | `FormMode` = `'create' | 'edit'` |
| Confirm dialog | `lib/confirm.ts` + `components/ConfirmDialogHost.tsx` | `confirmAction()` returns a Promise |
| Stored enum labels | `lib/invoiceLabels.ts`, `components/*/constants.ts` | never translate a stored value |
| Dates / money / numbers | `lib/followUps.ts`, `lib/germanNumbers.ts`, `lib/utils.ts` | `de-DE` everywhere |

## CODE MAP
| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| `trpcReact` | const client | `lib/trpc.ts` | 305 | the only API surface used by pages/components |
| `cn` | helper | `lib/utils.ts` | 256 | class merge (`clsx` + `tailwind-merge`) |
| `confirmAction` | helper | `lib/confirm.ts` | 40 | destructive-action gate |
| `ROUTES` | const map | `lib/routing.ts` | 33 | menu, search palette, shortcuts |
| `useFormSheet` | hook | `hooks/useFormSheet.ts` | 27 | sheet open/create/edit state |

## CONVENTIONS
- Aliases: `@/*` -> `src/renderer/src` (use this). `@renderer/*` also resolves but is unused -
  do not revive it.
- Main-process contract is imported directly as types by relative path
  (`../../../main/api/schemas/band.schema`); there is no `@main` alias.
- Query client defaults in `main.tsx`: `staleTime: 60_000`, `refetchOnWindowFocus: false`,
  `retry: 1` (local-first app) - do not re-tune per query without reason.
- Naming: PascalCase for pages/domain components, kebab-case for `components/ui/*` and generic
  infra (`data-table.tsx`, `form-sheet.tsx`), camelCase for helper modules.
- No barrel/`index.ts` anywhere; always import the module path. Tabs of detail pages live in the
  URL (`?tab=`), validated by an `is<Tab>()` guard in the route.
- Tailwind 4: CSS vars in arbitrary values use `w-(--var)`; the v3 form `w-[--var]` is invalid
  (still present in `components/ui/sidebar.tsx` and `calendar.tsx` - do not copy it).

## ANTI-PATTERNS
- Never create a second tRPC client: electron-trpc matches responses by operation id, which
  restarts at 1 per client (`lib/trpc.ts`).
- Never put app chrome on a `_print` route - printToPDF captures the window.
- Modal sheets/dialogs must call `keepOpenOnToast` on outside-interaction handlers, or clicking
  a toast ("Rückgängig") closes them.
- Do not split a working page preemptively; split per concern when you touch it.
- No real master data (names, IBANs, addresses, signatures) in code, seeds or tests - only the
  gitignored `sample_data/`.

## COMMANDS
```bash
pnpm dev                 # electron-vite dev, HMR
pnpm typecheck:web       # tsc -p tsconfig.web.json (covers all renderer files)
pnpm lint                # eslint --cache .
pnpm test                # vitest, node env - pure renderer helpers only
pnpm build               # typecheck + electron-vite build
npx playwright test      # e2e against the built app (needs pnpm build first)
```

## NOTES
- No renderer component tests exist; vitest covers pure helpers (`lib/`, `components/mail/*.ts`).
- Print pages are separate route components, not modes of the detail pages.