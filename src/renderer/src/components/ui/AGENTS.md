# src/renderer/src/components/ui - KNOWLEDGE BASE

**Score:** 9 (35 files, 145 import refs, own `components.json` config) - the shadcn primitive
layer; the widest fan-in of any directory under `components/`.

## OVERVIEW
shadcn-style primitives (style `new-york`, baseColor `zinc`, `cssVariables: true`, lucide icons;
config in the repo-root `components.json`). Presentational only: no business logic, no page data.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Button / variants | `button.tsx` | `@base-ui/react` primitive + `cva` `buttonVariants` |
| Form field scaffolding | `field.tsx` | `Field*` group, `cva` variants - use for new forms |
| Inputs | `input.tsx`, `textarea.tsx`, `label.tsx`, `input-group.tsx` | |
| Selects / pickers | `select.tsx` (Radix), `combobox.tsx` (`@base-ui`), `entity-combobox.tsx`, `inline-combobox.tsx`, `searchable-select.tsx`, `multi-select.tsx` | `SearchableSelect` is the documented related-record picker |
| Overlays | `dialog.tsx`, `sheet.tsx`, `popover.tsx`, `context-menu.tsx`, `tooltip.tsx` | dialog/sheet wire `keepOpenOnToast` |
| Layout / nav | `sidebar.tsx` (680L), `breadcrumb.tsx`, `tabs.tsx`, `separator.tsx`, `scroll-area.tsx` | `sidebar.tsx` is generated - avoid hand edits |
| Feedback | `sonner.tsx`, `spinner.tsx`, `skeleton.tsx`, `badge.tsx` | `sonner.tsx` suppresses toasts in print |
| Search palette | `search-command-button.tsx` (548L) | the only `ui/` file using `trpcReact` |
| Data table / calendar | `card.tsx`, `calendar.tsx`, `command.tsx` | |

## CONVENTIONS
- Primitives export named components (plus `*Variants` from `cva`); `search-command-button.tsx` is the
  only default export in this directory.
- Every new primitive keeps the generated shape: `data-slot="…"`, `cn(...)` from `@/lib/utils`, local
  props interface, function declaration (no `React.FC`).
- Two headless libraries coexist: most files use `@radix-ui/*` (18), `button.tsx` and `combobox.tsx` use
  `@base-ui/react` (2). Follow the neighbouring file rather than assuming.
- Kebab-case file names are mandatory here (`searchable-select.tsx`), unlike domain components.
- ESLint relaxes `react-refresh/only-export-components`, `react/prop-types` and
  `react/no-unknown-property` for `components/ui/**` only (`eslint.config.mjs`) - do not copy those
  suppressions elsewhere.
- `'use client'` appears in 6 files as a shadcn artifact; this is a Vite renderer with no RSC, so it is
  meaningless. Do not add it to new files.

## ANTI-PATTERNS
- Do not put API calls, page data or business rules in a primitive. `search-command-button.tsx` is the
  one accepted exception.
- Never edit generated primitives (`sidebar.tsx`, `calendar.tsx`) into app-specific components - wrap
  them instead.
- Tailwind 4 variable syntax: `w-(--var)` is correct; the v3 `w-[--var]` form still present in
  `sidebar.tsx` and `calendar.tsx` produces invalid CSS. Do not replicate it.
- Do not re-export primitives from a barrel; import `@/components/ui/<file>` directly.
- Do not add `print:` UI affordances here - print chrome is handled by the `_print` route and
  `sonner.tsx`'s `print:hidden!`.

## HOTSPOTS
- `sidebar.tsx` 680L (largest export surface), `search-command-button.tsx` 548L,
  `combobox.tsx` 275L, `field.tsx` 230L, `context-menu.tsx` 187L.
- Highest fan-in: `button.tsx` (66 files import it), `label.tsx`, `input.tsx`, `select.tsx`, `field.tsx` -
  a change here reaches most of the app.

## COMMANDS
```bash
pnpm dev
pnpm typecheck:web
pnpm lint
```
