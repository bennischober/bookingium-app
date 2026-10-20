# Bookingium

A local-first desktop app for concert booking and band management —
events, contracts, invoices, bands, venues and contacts, all on-device.
German UI.

Built with Electron, React and TypeScript.

## Features

- **Events** with detail page: overview, itinerary, financials, documents;
  concert contracts as print-ready PDFs (incl. signature images)
- **Invoices** with per-company numbering on issue, line items, tax handling,
  Storno, print-to-PDF (German/English agency templates) with embedded
  e-invoice (ZUGFeRD/XRechnung) and a payment QR code for banking apps
- **Bands** with detail page: members, events, management contracts (print)
  and quarterly management-share invoices, documents
- **Companies and venues/festivals** with detail pages (contacts, bands,
  events, invoices, documents); **persons** with their relations
- **Documents** for events, bands, companies and venues in readable folders
  (`documents/bands/3-pretty-wild/…`), drag and drop
- **Import** of Excel lists (venues/festivals, bands, companies, persons)
  with detected column mapping, preview and duplicate matching
- **Export** of every list to Excel, a **calendar file** (.ics) of all events
  kept up to date, **backups** of database and documents
- **Calendar**, **dashboard**, **search everything** (Ctrl+K), back/forward
  navigation (Alt+←/→), searchable pickers, lists that scroll as one
  table (pinned headers, sortable columns, more rows load while scrolling)
- Local SQLite database (Drizzle ORM), migrations on startup

## Development

Requirements: Node.js 24 (nvm-windows works), pnpm 12 (activated via
`corepack enable pnpm` once per node version).

```bash
pnpm install        # install dependencies
pnpm dev            # start the app in dev mode (HMR)
```

The database is created and migrated automatically on first launch
(`%APPDATA%\bookingum-app\data\bookingum.db`). Demo data is seeded on first
run; dates are relative to the seeding day so the dashboard shows content.

Real issuer master data (agency address, tax numbers, bank details,
signatures) is loaded from `sample_data/internal-seed.json` when present —
that file is gitignored; see `sample_data/internal-seed.example.json` for
the format.

## Quality gates

```bash
pnpm test           # unit tests (vitest, in-memory SQLite)
pnpm lint           # eslint (0 errors expected)
pnpm typecheck      # tsc for node and web configs
pnpm build          # typecheck + electron-vite build
npx playwright test # e2e (needs pnpm build first): the built app with the
                    # main workflows (import, export, documents, print, …)
```

Each e2e app launch gets a fresh, temporary data folder that the app migrates
and seeds on start, so tests never touch your real database
(`%APPDATA%/bookingum-app`) and always see the same seed data. To run them
against a specific folder (e.g. a copy of real data), set
`BOOKINGIUM_E2E_USER_DATA` to it; that folder is used as-is and never deleted.

E2E artifacts land in `tests/e2e/__screenshots__/` (the generated
`contract.pdf` is the real print output — inspect it, not just the
screenshot, since pagination bugs are invisible in screenshots).

## Packaging

```bash
pnpm build:win      # Windows installer: dist/Bookingium-Setup-<version>.exe
pnpm build:mac      # macOS (dmg)
pnpm build:linux    # Linux (AppImage)
```

The Windows installer installs per user (no admin rights), lets you choose
the folder and creates desktop and start menu shortcuts. Nothing else needs
to be installed: SQLite is part of the app (`better-sqlite3`, built for
Electron by `pnpm install`).

- Data stays in `%APPDATA%\bookingum-app` (database, documents), the same
  folder as in development; uninstalling keeps it.
- Only the built app goes into the package (`files` allow-list in
  `electron-builder.yml`): never `sample_data`, docs, tests or local keys.
- `dependencies` holds only what the main process loads at runtime; renderer
  libraries are devDependencies (Vite bundles them), which keeps the package
  small.
- The installer is not code-signed: Windows SmartScreen warns on first start
  ("Weitere Informationen" › "Trotzdem ausführen") until it is signed with a
  code-signing certificate.
- Bump `version` in `package.json` for a new release; the installer updates
  an existing installation in place.

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — process layout, data
flow, the recipe for adding a business object end-to-end, and the coding
guidelines.

## Project docs

- `docs/ARCHITECTURE.md` — developer guide: structure, data on disk,
  migrations, the end-to-end recipe, coding guidelines
- `docs/UI_LANGUAGE.md` — German UI rules and glossary
- `docs/TODOS.md` — open items
