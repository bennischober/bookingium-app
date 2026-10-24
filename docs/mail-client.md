# Mail client (IMAP) — design and decisions

Status: **spike, branch `feat/mail-client`**. The core was built and proven in a standalone prototype
(`D:\Projects\Arbeit\Brainstorm\email-prototype`, tasks 1–5, reports `REPORT*.md`). This document records the decisions
so the integration does not re-litigate them. Not in the release until the canary and pilot gates below are passed.

**Source of truth:** since 2026-10-23 the core is developed here, in `src/main/mailclient/core/`. The prototype is a test
bench; changes made there are ported by hand, never copied over the core.

## Why
Outlook with a large IMAP account (~32k mails, 276 folders, ~13.5 GB, IONOS) is slow and its search is unusable.
Goal: a purpose-specific client — fast local search, correspondence tied to customers/events/invoices — not a general mail client.

## Architecture
- **IMAP is the source of truth.** Locally: one `.eml` per message plus SQLite with FTS5. The index is rebuildable from the `.eml` files.
- **Separate mail DB** (own SQLite file and folder), not the app DB. Reasons: size, rebuildability, independent backup/lifecycle.
  Link to app entities through a `mail_link` table in the **app DB** (it must survive a rebuild of the mail store), keyed by
  mail account + Message-ID, not by UID and not by the store's `message_key` (that is `sha1(account|folder|uidValidity|uid)` and
  changes on every move). Mails without a Message-ID get a fallback key (see `docs/mail-client-tasks.md`, C2).
- **Schema versions:** each account DB counts its schema in `PRAGMA user_version` (`core/migrations.ts`). Migrations are append-only and
  run one per transaction; a DB written by a newer build is refused instead of opened. Migration 1 adopts the unversioned DBs from before.
- **Bodies apart from headers:** `messages` holds what lists, sorting and filters need; text and HTML live in `message_bodies` (same id,
  deleted with the message). Search still covers the body: the FTS index reads it through the `fts_source` view.
- **Mail core** lives in `src/main/mailclient/core/` and has no Electron or bookingum imports. It talks to the host only through
  `createMailCore(options)` (data dir, account config, credentials provider, logger, clock) and the `Api` interface in `core/types.ts`.
- **Process model:** the core runs in an Electron utility process (better-sqlite3 is synchronous; sync and indexing must not block the
  main process or UI). The renderer talks to it via IPC: `mailApi` (`src/renderer/src/lib/mailApi.ts`) → tRPC `mail.call` → main → worker.
- **Single instance:** `app.requestSingleInstanceLock()` plus an exclusive lock on the mail data dir. Two cores on one store must be impossible.
- **Password:** Electron `safeStorage` (DPAPI on Windows); never in the mail DB, logs or `.env`.
- **Legally relevant mail** (e.g. sent invoice mails) is stored as a copy together with the document, independent of the mailbox.

## Sync
IONOS has no CONDSTORE/QRESYNC. Sync is UID-list sweeps plus tiered FLAGS sweeps (INBOX/open folder: IDLE, recently active: short poll,
cold folders: slow). IDLE works on IONOS (~8 s propagation). UIDVALIDITY change: resync that folder, never apply stale UIDs.
Deletion of local data based on a server listing is gated (three gates; an empty or truncated LIST must never prune).

**Connections have hard limits** (`core/imap_options.ts`): 15 s to connect, 10 s for the greeting, 120 s of silence mid-command.
An unreachable server shows "Offline · nächster Versuch in …" and the next poll retries. **A rejected login is never retried:**
the engine stops all server contact for that account until the account is saved again (a lockout on the live account
is worse than a stale inbox). Accounts are only saved after "Verbindung testen" passes (one attempt, at most 15 s, with
the worker paused so a live server never sees more than two connections). Encryption is set explicitly (SSL/TLS or
STARTTLS, which is required, never opportunistic), never guessed from the port; a login without encryption is
allowed only to loopback (the sandbox, or a local tunnel).

## Write path (never lose mail, never send twice)
- Every action is written to a persistent **op journal** before anything touches the server; ops resume or are safely abandoned after a crash.
- Before every mutating command: fresh SELECT, UIDVALIDITY check, UID addressing only, identity check against the local record.
- **Delete = move to Trash.** Permanent delete only from Trash, only by explicit action, only with UID EXPUNGE (UIDPLUS); refuse otherwise.
- **Send is a state machine:** `queued -> sending -> sent -> filed_in_sent -> done`. Final MIME built once and stored. On ambiguity after SMTP
  DATA: state `unknown`, resolved by the user via Message-ID probe in Sent; **never auto-resend**. Bcc never in headers.
- Undo for flag/move/delete within a window.
- A write guard allowlists accounts explicitly. Production accounts are read-only until the rollout stages below are passed.

## Security
Mail HTML is sanitized (DOMPurify), rendered in an iframe sandbox without `allow-scripts`/`allow-same-origin`, CSP `default-src 'none'`,
remote content blocked by default (opt-in per mail). In Electron: `contextIsolation` on, `nodeIntegration` off, `setWindowOpenHandler`
for links (open externally after showing the real URL), no custom protocol exposing files. Attachment filenames sanitized on save; never auto-open.

## Lessons that cost us time (keep)
- Selected-mailbox views can be stale; always re-SELECT before a mutating command.
- Search bugs hide at small scale: test against an independent oracle on a store >= 30k messages.
- FTS5 external-content tables: no UPDATE trigger; guard prefix queries (fuzzy/prefix cost probe via `fts5vocab`).
- Do not couple file names to keys; the DB owns the path.
- Windows is case-insensitive: folder names that differ only by case collide on disk.
- Double-instance incidents: swallow no `EADDRINUSE`/lock errors.
- Do not copy GPL (isync, Mailspring sync) or MPL (Thunderbird) code; ideas only.

## Dependencies (licenses checked in the prototype)
better-sqlite3 MIT, imapflow MIT, mailparser MIT, nodemailer MIT-0, jsdom MIT, dotenv BSD-2, dompurify MPL-2.0 OR Apache-2.0.
All permissive; no GPL/AGPL. Re-check when adding packages.

## Rollout gates
1. Sandbox only (now). 2. Read-only pilot with the real user next to Outlook (1–2 weeks). 3. Canary mailbox on the IONOS contract:
write-path suite, few sends. 4. Staged writes on the real account: flags -> move -> delete -> send, kill switch and a backup before each.
Search and sync correctness are verified on a full-size store before each stage.

## Open
Canary mailbox (not created yet), app-specific features (per-customer correspondence, send invoice/reminder through the client),
onboarding (account setup, first sync is long and throttled), malicious-mail test corpus, UIDPLUS-less servers.
