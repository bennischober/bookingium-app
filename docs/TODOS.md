# Lists of TODOs and future improvements for the app

## Done (2026-10-11 autonomous session)

- PDF creation logic for invoices AND contracts (print-to-PDF via React
  components) — invoice templates unified (one agency layout, DE/EN),
  contract rebuilt from the old repo's proven PDFContract structure incl.
  TL (Technischer Leiter) and signature images
- "Search anything" enhanced: dedicated `search` tRPC router with LIKE
  queries on indexed columns + lightweight result payloads; UI queries on
  demand (no prefetch on Ctrl+K); FTS5 deliberately left as a future option
  for larger datasets
- Architecture/DX: docs/ARCHITECTURE.md with the end-to-end recipe for
  adding a business object + decided coding guidelines; InvoicePage split
  (form -> components/forms/InvoiceForm.tsx, helpers -> lib/invoiceLabels.ts)
- README rewritten with real project information
- Test infrastructure: vitest unit suite (21 tests, in-memory SQLite) and
  Playwright e2e suite (5 tests) incl. real printToPDF output verification
- Dashboard shows content on fresh databases (seed dates relative to today)

## Open

- Further enhance "search anything" (FTS5, per-object hot entries, context
  weighting) — see docs/SESSION_QUESTIONS.md for the strategy notes
- Dependabot PRs on GitHub: 16 open PRs are superseded by our dependency
  commits and should be closed (needs web UI access / gh CLI)
- Dependabot alerts: 2 moderate dev-only findings remain (esbuild via
  drizzle-kit's @esbuild-kit loader — serve mode only, not used; sprintf-js —
  no fixed release). Revisit when drizzle-kit drops the legacy loader.
- Split large components further when working on them (InvoicePage is now
  312 lines; FinancialsTab/ItineraryTab/DocumentsTab are 370-470 lines each,
  acceptable)
- Possibly: drag-and-drop for the documents tab, PDF preview embedded in the
  documents tab, invoice download counter, document version history
  (from docs/IMPLEMENTATION_COMPLETE.md future list)

## Old prompts (answered)

1. `deal` field semantics — ANSWERED: the field stores the deal terms as
   free text (e.g. "70/30") and is displayed in the FinancialsTab
   ("Konditionen") and in the contract (§2). Structured guarantee data lives
   in guarantee_amount/guarantee_vat_rate (added 2026-10). No schema change
   needed.
   The "general edit mode" idea (view vs edit distinction) is partially
   implemented: the event hub has an explicit edit mode with save/discard;
   other pages still use inline FormSheets.
2. Search strategy — ANSWERED: on-demand debounced search (>= 2 chars) via
   the dedicated search router; LIKE on indexed columns; per-type limit 4,
   total cap 24; recent searches persisted; FTS5 as future option.
