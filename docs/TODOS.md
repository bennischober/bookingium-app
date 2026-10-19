# Open items

Done work lives in the git history; this list only holds what is still open.

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
