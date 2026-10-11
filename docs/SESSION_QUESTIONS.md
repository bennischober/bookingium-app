# Session Questions & Decisions

> For Benjamin: everything that needs your input or that I decided on my own
> and you should review. English per your instruction (UI strings stay
> German; chat + docs are English).
> Session end: 2026-10-11, ~18:30.

## Decisions I made this session (review these)

1. **Dashboard performance — root cause found and fixed.** SQL was never the
   problem (timing probe: all queries < 11ms). The culprits were in the
   renderer: TanStack Query defaults (`staleTime: 0` +
   `refetchOnWindowFocus: true` → everything refetched on every visit and
   window focus) and shipping 500 invoices + full directory tables over IPC
   to aggregate in JS. Now: `staleTime: 60s`, `refetchOnWindowFocus: false`,
   `retry: 1`, plus a new `dashboard.getStats` endpoint computing everything
   in SQL (one IPC round-trip, < 1 KB payload). Retry-3-with-backoff was also
   the earlier "long loading then error" on contract bugs.

2. **Members from the entity side** — Bands page: "Mitglieder" button per
   row (side sheet with add/edit-role/remove, person picker). Companies:
   "Mitarbeiter". Venues: "Ansprechpartner". Reuses the relation router;
   member queries now resolve person names (previously only personIds were
   returned — that's why the entity-side view didn't exist).

3. **150% zoom resilience** — DataTable now scrolls horizontally instead of
   squeezing (`min-w-[640px]`, `overflow-x-auto`), wrapping search/action
   and pagination rows. New e2e test launches the app at
   `deviceScaleFactor: 1.5` / 1280×720 (≈ 1366×768 laptop at Windows 150%)
   and screenshots dashboard + events to
   `tests/e2e/__screenshots__/zoom150-*.png`. Visually verified: everything
   readable and unclipped.

4. **Search trigger redesign** — "Alles suchen..." is now an input-styled
   element (search icon left, Ctrl+K kbd chip right) integrated into the
   header, matching modern command-palette patterns.

5. **Shortcuts system** — `Alt+1..8` jump to the main pages; `?` opens a
   shortcuts help dialog; help button (keyboard icon) next to the theme
   toggle. Shortcuts defined in one table so bindings and help cannot drift.
   Plain letters deliberately unbound (typing in inputs).

6. **InvoicePage split** — InvoiceForm (700 lines) moved to
   `components/forms/InvoiceForm.tsx`, shared helpers to
   `lib/invoiceLabels.ts`. Page: 312 lines. No behavior change.

7. **Seed data dynamic** — demo dates relative to the seeding day so the
   dashboard/calendar show content on fresh databases.

## Open questions for you (priority order)

1. **CSV import — needs your input before I build it** (next session's main
   item unless you say otherwise):
   - Which objects first? My guess: **persons** and **companies** (most
     portable data), then venues/bands.
   - Do you have real CSV exports? Drop them into `sample_data/` — I'll
     build the importer against your actual data instead of a guessed
     schema.
   - Flow preference: (a) fixed template CSV you fill in, or (b) flexible
     column-mapping UI (upload any CSV, map columns to fields in a preview
     table, import)? I recommend (b).
   - Duplicate handling: skip, update, or create-always? Match on name, or
     VAT id for companies / first+last name+ birthday for persons?

2. **Dependabot PRs on GitHub** — 16 open PRs, all superseded; please close
   them (web UI). The 2 moderate alerts are the documented dev-only findings.

3. **Contract PDF final review** — `pnpm build && npx playwright test` →
   `tests/e2e/__screenshots__/contract.pdf` (5 pages). Check section page
   breaks and the signature blocks (page 5).

4. **Signature semantics** — agency (BMM/Deville) signs as VP1 currently,
   matching the old repo. Flip to the band company if that's wrong.

5. **README/ARCHITECTURE.md tone** — too detailed / too terse?

## Session status

All gates green at session end: typecheck, lint (0 errors, 1 known
informational warning), 21 unit tests, build, 6 e2e tests (incl. 150%-zoom
screenshots). Working tree clean except this file.
