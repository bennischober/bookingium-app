# bookingum-app

A local-first desktop app for concert booking and event management in the
music industry — bands, venues, hotels, deal memos, invoices, contracts and
documents, all on-device.

Built with Electron, React and TypeScript.

## Features

- **Events** (deal memos) with detail hub: overview, documents, financials,
  itinerary
- **Invoices** with per-company numbering, line items, tax handling, and
  print-to-PDF output (German/English agency templates)
- **Contracts** (concert engagement contracts) generated from deal memos as
  print-ready PDFs, incl. signature images
- **Master data**: bands (incl. members, technical director), persons and
  their relations, companies (with logo/signature, legal footer data),
  venues, hotels, banks
- **Calendar** with month/week/day views
- **Search everything** (Ctrl+K): pages, actions and records via dedicated
  LIKE-based search
- **Dashboard** with upcoming events, pending confirmations and open
  invoices
- Local SQLite database (Drizzle ORM), migrations on startup, German UI

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
npx playwright test # e2e (needs pnpm build first): boots the app,
                    # verifies navigation and the contract print output
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
pnpm build:win      # Windows installer (nsis)
pnpm build:mac      # macOS
pnpm build:linux    # Linux (AppImage, snap, deb)
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — process layout, data
flow, the recipe for adding a business object end-to-end, and the coding
guidelines.

## Project docs

- `docs/TODOS.md` — roadmap and open items
- `docs/ARCHITECTURE.md` — developer guide
- `docs/UI_MIGRATION_GLOSSARY.md` — binding German UI terminology
- `docs/SESSION_QUESTIONS.md` — decisions and open questions
- `docs/DOCUMENT_FEATURE.md`, `docs/IMPLEMENTATION_COMPLETE.md`,
  `docs/RELATIONSHIP_PATTERNS.md` — feature notes from earlier iterations
