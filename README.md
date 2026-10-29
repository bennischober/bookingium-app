<div align="center">

<img src="build/icon.svg" alt="Bookingium logo" width="112" height="112" />

# Bookingium

**Concert booking and band management — local-first, on your desktop.**

Events, contracts, invoices, bands, venues and contacts, all on-device.
German UI.

![Electron](https://img.shields.io/badge/Electron-47848F?logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white)
![Platforms](https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-lightgrey)
[![CI](https://github.com/bennischober/bookingium-app/actions/workflows/ci.yml/badge.svg)](https://github.com/bennischober/bookingium-app/actions/workflows/ci.yml)

[Features](#features) · [Getting started](#getting-started) · [Quality gates](#quality-gates) · [Packaging](#packaging) · [Docs](#documentation) · [Issues](https://github.com/bennischober/bookingium-app/issues)

</div>

---

## Why Bookingium

- **Local-first** — one SQLite file and plain folders on your machine. No account, no cloud, no subscription.
- **Built for German booking agencies** — concert contracts, invoices with ZUGFeRD/XRechnung and payment QR codes, German UI.
- **Everything in one place** — from the first inquiry to the signed contract, the invoice and the follow-up.

## Features

- **Events** with detail page: overview, itinerary, financials, documents;
  concert contracts as print-ready PDFs (incl. signature images)
- **Invoices** with per-company numbering on issue, line items, tax handling,
  Storno, print-to-PDF (German/English agency templates) with embedded
  e-invoice (ZUGFeRD/XRechnung) and a payment QR code for banking apps;
  „Per E-Mail senden“ opens the email with the PDF in Outlook, Thunderbird
  or the built-in mail client
- **Bands** with detail page: members, events, management contracts (print)
  and quarterly management-share invoices, documents
- **Companies and venues/festivals** with detail pages (contacts, bands,
  events, invoices, documents); **persons** with their relations
- **Documents** for events, bands, companies and venues in readable folders
  (`documents/bands/3-pretty-wild/…`), drag and drop
- **Import** of Excel lists (venues/festivals, bands, companies, persons)
  with detected column mapping, preview and duplicate matching
- **Mail client** (experimental, off by default; Einstellungen › E-Mail):
  IMAP/SMTP accounts to read, search, file and send mail, an „E-Mails“ tab on
  the detail pages for the mail linked to that band, company, venue, person
  or event, and an unread count in the menu
- **Export** of every list to Excel, a **calendar file** (.ics) of all events
  kept up to date
- **Backups** of database and documents: manual, and automatic once a day
  into a folder of your choice (a synced OneDrive/Dropbox folder works),
  keeping one per day for a week and one per week for a month; restore from
  Einstellungen › Daten
- **Calendar**, **dashboard**, **search everything** (Ctrl+K), back/forward
  navigation (Alt+←/→), searchable pickers, lists that scroll as one
  table (pinned headers, sortable columns, more rows load while scrolling)
- Local SQLite database (Drizzle ORM), migrations on startup

## Getting started

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

CI ([`ci.yml`](.github/workflows/ci.yml)) runs test, lint, typecheck and build
on Ubuntu and Windows for every push to `main` and every pull request, and in
a second job the e-invoice validators (KoSIT, veraPDF) on the generated
invoices. The other e2e specs and the mail sandbox suites stay a local gate.

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

## Releasing

A release is a tag. Pushing `v<version>` runs
[`.github/workflows/release.yml`](.github/workflows/release.yml): it checks
that the tag matches `version` in `package.json`, runs the full CI gate on
the tagged commit, builds the Windows installer and publishes it as a GitHub
Release with notes generated from the PRs merged since the previous tag.

1. Bump `version` in `package.json` in a PR (`1.0.0` → `1.0.1` for fixes,
   `1.1.0` for features) and merge it.
2. Tag the merge commit on `main` and push the tag:

   ```bash
   git checkout main && git pull
   git tag v1.0.1
   git push origin v1.0.1
   ```

3. When the run is green, the release has `Bookingium-Setup-<version>.exe`.
   Installing it over an existing installation updates it in place; the data
   in `%APPDATA%\bookingum-app` is kept.

A red gate or a tag that does not match the version publishes nothing. Delete
the tag (`git push origin :v1.0.1`, `git tag -d v1.0.1`), fix, and tag again.
The installer is unsigned (#48) and there is no auto-update (#49): users
download the new installer from the release.

## Architecture

Electron main process (SQLite via Drizzle, tRPC over IPC) and a React
renderer. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the process
layout, data flow, the recipe for adding a business object end-to-end, and
the coding guidelines.

## Documentation

| Document | What's in it |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Structure, data on disk, migrations, the end-to-end recipe, coding guidelines |
| [UI_LANGUAGE.md](docs/UI_LANGUAGE.md) | German UI rules and glossary |
| [mail-client.md](docs/mail-client.md) | The mail client: architecture, sync, write path, rules for working on it |

Open work (bugs, features, decisions, chores) is tracked in
[GitHub issues](https://github.com/bennischober/bookingium-app/issues), labelled
by area (`area:mail`, `area:calendar`, `area:einvoice`, `area:backup`,
`area:ui`, `area:build`).
The docs describe what is built and why; they hold no to-do lists.
