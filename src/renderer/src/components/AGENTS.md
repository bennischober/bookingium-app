# src/renderer/src/components - KNOWLEDGE BASE

**Score:** 9 (9 shared files + 18 feature dirs, 675 import refs) - the shared UI layer every
page composes from.

## OVERVIEW
Shared primitives live at this root; feature components live in one directory per business object
or cross-cutting concern. `ui/` holds shadcn-style primitives only - nothing else.

## STRUCTURE
```
components/
├── data-table.tsx, form-sheet.tsx, MembersSheet.tsx,   # shared across pages
├── row-action-button.tsx, InfoLabel.tsx, ConfirmDialogHost.tsx,
├── ShortcutsHelp.tsx, app-sidebar.tsx, theme-provider.tsx
├── ui/           # shadcn primitives (see ui/AGENTS.md)
├── forms/        # one TanStack Form per business object + CreateEventWizard
├── invoice/      # invoice document, cards, status badges, edit sheet
├── mail/         # mail client views + pure helpers (see mail/AGENTS.md)
├── event-hub/ contract/ print/   # event tabs, A4 contract docs, printToPDF preview
├── band/ company/ venue/ person/ # per-object panels + constants.ts tab guards
├── follow-ups/ documents/ import/ export/ settings/ detail/  # feature dirs
└── layout/       # root chrome: RootLayout, breadcrumbs, history nav, quick-create
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Any list page's table | `data-table.tsx` | sorting, infinite scroll, pinned actions column, empty state |
| Create/edit sheet chrome | `form-sheet.tsx` | pairs with `useFormSheet` |
| Destructive confirm | `ConfirmDialogHost.tsx` + `lib/confirm.ts` | host mounted once in `main.tsx` |
| Row buttons | `row-action-button.tsx` | `RowActionButton` + `RowActions` wrapper |
| Band/company members | `MembersSheet.tsx` | `MembersPanel` (inline) + `MembersSheet` |
| Detail-page building blocks | `detail/DetailParts.tsx` | `InfoCard`, `Fields`, `AddressLines`, `RowTable`, `EventsTable` |
| Per-object tabs | `<obj>/constants.ts` | `<X>_TABS`, `<X>Tab`, `is<Tab>()` - used by the route's `?tab=` guard |
| A4 print documents | `print/PagedDocument.tsx` | renders the real printToPDF output via pdf.js |

## CONVENTIONS
- Feature dirs mirror routes; each owns its `constants.ts` tab list and exports plain named
  functions (no `React.FC`). Only `layout/root-layout.tsx` uses `export default`.
- Components take their data as props from the page; queries/mutations use `trpcReact` where a panel
  needs them. Never a second client.
- Naming: PascalCase `.tsx` for domain components, kebab-case for generic infra
  (`data-table.tsx`, `form-sheet.tsx`, `app-sidebar.tsx`, all of `layout/`), camelCase `.ts` for
  helpers (`documentFiles.ts`, `useExportToast.ts`).
- Shared cross-feature primitives belong at this root, not in a new `shared/` directory.
- Pure logic that deserves tests goes in a `.ts` module next to the component (see `mail/`), because
  vitest runs in a node environment with no DOM.
- German UI strings are inline; stored enum values go through a label map.

## ANTI-PATTERNS
- `event-hub/PlaceholderTab.tsx` is dead code (no importers). `OverviewTab.tsx` keeps its own
  `STATUS_LABELS` copy instead of importing `event-hub/constants.ts` - import the shared map.
- `event-hub/*Tab.tsx` save/cancel `useEffect`s keyed only on `saveSignal`/`cancelSignal` carry
  `eslint-disable-line react-hooks/exhaustive-deps` plus a Strict-Mode guard ref. Copy the whole
  pattern or none of it.
- Signature blocks in `contract/*Document.tsx` must never split across pages or stand alone.
- `settings/MailAccountsCard.tsx` never re-displays a stored mail password.
- `print/PagedDocument.tsx` prints the real `printToPDF` output; content flows across pages by
  design. Do not "fix" pagination by pinning whole sections.

## HOTSPOTS
- Largest: `forms/InvoiceForm.tsx` 963L, `forms/CreateEventWizard.tsx` 770L,
  `invoice/InvoiceDocument.tsx` 725L, `ui/sidebar.tsx` 680L, `import/ImportDialog.tsx` 655L,
  `contract/ManagementContractDocument.tsx` 552L, `mail/ComposeView.tsx` 538L.
- Widest blast radius: `data-table.tsx` (9 pages), `form-sheet.tsx` (11 pages), `MembersSheet.tsx`
  (6 pages), `row-action-button.tsx` (11 files), `export/ExportButton.tsx` (8 pages).

## COMMANDS
```bash
pnpm dev
pnpm typecheck:web
pnpm test                                    # pure helpers only
npx playwright test tests/e2e/mail-client.spec.ts
```
