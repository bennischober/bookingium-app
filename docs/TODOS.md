# Open items

Done work lives in the git history; this list only holds what is still open.
Mail client, its integration into bookingum and the direction: see `docs/NEXT_STEPS.md`.

## Deadlines

- **E-Rechnung — must be live by 1 Jan 2028.** Built: ZUGFeRD/Factur-X
  (EN 16931) in PDF/A-3b invoice PDFs, XRechnung per invoice,
  Stornorechnung as credit note (see ARCHITECTURE.md › E-invoices). VAT
  cases settled: non-EU buyers „nicht steuerbar“ (the check enforces it),
  § 4 Nr. 20 a UStG via the Steuerhinweis presets, management shares at
  0 % need the reason in the Steuerhinweis. Left to do:
  - Run real invoices through the check before 2028 (waits for the first
    real invoices; none exist yet).
  - KoSIT and veraPDF run on demand with `pnpm validate:einvoice`; wire
    that command into CI once there is one (runner with Java 11+, cache
    `.tools/`; the e2e step needs a display, e.g. xvfb on Linux).

## Product

- **Dokumente sind nicht durchsuchbar** (design settled 2026-10-25, `docs/mail-client-tasks.md` D2). `SearchService`
  covers every business object except documents, so a file can only be found by remembering which record it hangs off.
  Planned: a "Dokumente" group in the `Ctrl+K` palette, matched on the file name, naming the owner.
- **Dokumente: Auffindbarkeit statt Ordnerbaum** (D1). Storage stays flat (`storage/documents/<type>/<id>-<slug>/`),
  no `document_link`, categories reuse the existing `document_type` enum. The work is display: inheritance both ways
  (the band's rider visible on the gig, the gig's files listed on the band) plus a filter by category and event.
  A Tour entity would be its own business object, not part of this.
- **Events werden archiviert, nicht gelöscht** (D3). Today a hard `DELETE` cascades away the itinerary and the
  follow-ups, `rm -rf`s the document folder and nulls `invoice.deal_memo_id` - for a booking agency that is an audit
  trail disappearing on one click. Planned: `deal_memo.archived_at`, one repository-level filter covering every read
  path (list, dashboard, ICS feed, search, contact list, contracts, follow-ups, invoices, band documents), an archive
  view with "Wiederherstellen", and a hard delete that refuses while an invoice is linked. `cancelled` stays a separate
  status: the gig fell through but was real and still needs its paperwork.
- **Code signing** for the Windows installer (SmartScreen warns until the
  installer is signed with a code-signing certificate).
- **Auto-update** (electron-updater) once there is a place to publish
  releases.
- **Mahngebühren / Verzugszinsen** on a Mahnung, if they are wanted: the
  reminders are emails only, with no amount added.
- **Verteiler: local promoters.** Lists draw on venues only (own address,
  Ansprechpartner, Veranstalter); LoPro companies and persons of events
  could be a further recipient type if lists to promoters are needed.
- **Wiedervorlagen:** not in the calendar or the calendar feed yet, and done
  ones have no history view; both if they turn out to be missed.
- **Calendar subscription in Outlook/Google:** the calendar file needs a web
  address there (e.g. a direct download link from OneDrive/Dropbox) — to be
  tried with the real setup.

## Data

- Persons imported before role parsing existed carry the role in the name
  ("Booking: Lea Grötzinger", "Geschäftsführer: Thilo Ziegler"). Decided:
  clean up the data once (move the role onto the membership), the importer
  stays as it is.

## Technical

- `calendar.tsx` and `sidebar.tsx` (generated ui components) still use
  Tailwind v3's `w-[--var]` syntax, which v4 ignores; harmless today, fix
  when touching them (it changes their look).
- Search: FTS5 instead of LIKE once the data gets large.
- Dependabot: close superseded PRs; two moderate dev-only alerts (esbuild via
  drizzle-kit's legacy loader, sprintf-js) until upstream fixes.
