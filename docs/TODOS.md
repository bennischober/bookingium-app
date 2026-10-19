# Open items

Done work lives in the git history; this list only holds what is still open.

## Deadlines

- **E-Rechnung — must be live by 1 Jan 2028.** Invoice PDFs already carry
  a ZUGFeRD/Factur-X XML (EN 16931) when the invoice is complete (see
  ARCHITECTURE.md › E-invoices). Left to do:
  - Confirm the VAT cases with the Steuerberater: 7 %/19 % on fees;
    reverse charge (AE) for EU promoters vs. „nicht steuerbar“ (O) for
    non-EU ones; § 4 Nr. 20 a UStG exemption (E) for artists; management
    shares at 0 % are created as „steuerfrei“ and need the reason in the
    Steuerhinweis; Kleinunternehmer status (2027: only above €800k
    turnover; invoices up to €250 are exempt).
  - Run real invoices (sample_data) through the check before 2028.
  - `printToPDF` output is not strict PDF/A-3 (no output intent/ICC
    profile); receiving software reads the XML, a strict PDF/A checker
    flags the file. No Ghostscript (AGPL).
  - Cancelled invoices get no XML; a Storno as e-invoice would be a credit
    note (type 381) referring to the original.
  - XRechnung for public-sector buyers only if needed: it additionally
    requires the business process (BT-23), a Leitweg-ID, payment
    instructions and the seller contact (BR-DE-1/2/15, PEPPOL-R001).
  - KoSIT validation runs on demand (`tests/einvoice.kosit.test.ts`); wire
    it into CI once there is one.

## Product

- **Code signing** for the Windows installer (SmartScreen warns until the
  installer is signed with a code-signing certificate).
- **App icon:** `build/icon.*` and `resources/icon.png` are still the
  electron-vite defaults.
- **Auto-update** (electron-updater) once there is a place to publish
  releases.
- **Calendar subscription in Outlook/Google:** the calendar file needs a web
  address there (e.g. a direct download link from OneDrive/Dropbox) — to be
  tried with the real setup.
- **Person detail page** (bands, companies, venues have one; persons still
  use the relations page).

## Data

- Persons imported before role parsing existed carry the role in the name
  ("Booking: Lea Grötzinger", "Geschäftsführer: Thilo Ziegler"); clean up
  by hand or with a one-off fix.

## Technical

- `calendar.tsx` and `sidebar.tsx` (generated ui components) still use
  Tailwind v3's `w-[--var]` syntax, which v4 ignores; harmless today, fix
  when touching them (it changes their look).
- Search: FTS5 instead of LIKE once the data gets large.
- Dependabot: close superseded PRs; two moderate dev-only alerts (esbuild via
  drizzle-kit's legacy loader, sprintf-js) until upstream fixes.
