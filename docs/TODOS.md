# Open items

Done work lives in the git history; this list only holds what is still open.

## Deadlines

- **E-Rechnung — start in 2027, must be live by 1 Jan 2028.** From 2028
  every German business has to send domestic B2B invoices as e-invoices
  (2027 only above €800k turnover; Kleinunternehmer under §19 UStG and
  invoices up to €250 are exempt — confirm the status with the
  Steuerberater). Plan:
  - ZUGFeRD/Factur-X, profile EN 16931: the current invoice PDF with
    `factur-x.xml` (CII syntax) embedded via `pdf-lib`; switch in Settings
    ("E-Rechnung in PDF einbetten"). XML and PDF come from the same data.
  - Missing fields: buyer reference / Leitweg-ID, e-mail addresses of
    seller and buyer, seller contact person (name, phone, e-mail), UN/ECE
    unit codes (`C62`, `LS`, …), exemption reason for E/AE lines.
  - Map `tax_code` to the categories S/Z/E/AE/K/G; amounts are `real`, so
    round to cents in one place — validators recompute every total.
  - Check before issuing ("Für die E-Rechnung fehlt: …").
  - Tests against the KoSIT validator (free, Java; dev/CI only).
  - `printToPDF` output is not strict PDF/A-3; fine for receiving software
    (it reads the XML), a strict checker flags it. No Ghostscript (AGPL).
  - Before starting: real invoices as test cases, and the VAT cases in use
    (7 %/19 % on fees, reverse charge for foreign artists/promoters) from
    the Steuerberater.

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
