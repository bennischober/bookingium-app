# Mail client (IMAP)

The built-in mail client: read, search, file and send mail from bookingum, tied to the app's people,
events and invoices. This is the one current document for it: what it does, how it is built, how to work on
it, and its known limits (open work is in GitHub issues). The core's own API, module map and on-disk format
are in `src/main/mailclient/core/README.md`.

The working documents from building it (task cards, the critical review with findings MR-01 to MR-43, handoff
briefs, the assessment, the per-card reports and the review-agent briefs) were removed after the release
cleanup; their lasting content is in this file. They are in git history at commit `b89d21c`
(`git show b89d21c:docs/archive/<file>`), and each card's commit message explains its change.

## Status

- **Experimental, off by default.** Einstellungen › E-Mail › "E-Mail (experimentell)" (`mailClient`
  setting, default `false`). Off, the worker never starts, every `mail.call` is refused with
  `MAIL_CLIENT_OFF`, and the renderer shows none of it: no "E-Mail" menu entry or search group, no
  account card, no "E-Mails" tab on detail pages, no invoice mails card, and the mail program
  "bookingum" is not offered (a value saved earlier stays visible). Turning it off moves the invoice
  mail program from "bookingum" back to "Automatisch". Turning it off deletes nothing: accounts and
  downloaded mail stay on disk.
- **One account kind** since 2026-10-28: every account is writable unless set to "Nur lesen". The
  earlier sandbox/production-read-only kinds and the canary flag are gone; `accounts.ts`
  (`normalizeStoredAccount`) reads old `accounts.json` files into the new shape.
- **Built on `feat/mail-client`**, reviewed (review findings MR-01 to MR-43, all fixed in the I cards),
  then refactored (R1 to R4: the sync engine, `MailCore`, the write engine and `MailPage`
  split into modules) and given the large-message protocol (S1, also run against the real mailbox).
- The core was first built in a standalone prototype (`D:\Projects\Arbeit\Brainstorm\email-prototype`).
  Since 2026-10-23 bookingum's `src/main/mailclient/core/` is the source of truth; ideas from the
  prototype are ported by hand, never by copying files over the core.

## Why

Outlook with a large IMAP account (~32k mails, 276 folders, ~13.5 GB, IONOS) is slow and its search is
unusable. The goal is a purpose-specific client (fast local search, correspondence tied to customers,
events and invoices), not a general mail client.

## What it does

**Mail client** (`/mail`, pop-out windows for single mails and the editor):

- Three panes: folder tree, message list, reader. Resizable, keyboard shortcuts (`components/mail/shortcuts.ts`).
- Local full-text search over the whole archive (SQLite FTS5) with filters, prefix search and a cost cap
  for very common prefixes.
- Flag, move (drag and drop, batch moves in one UID MOVE), delete to Trash, empty Trash, permanent delete
  from Trash only. Folder create, rename, move and delete.
- Compose, reply, reply all, forward, drafts with autosave, attachments (also pasted), light formatting
  (bold, italic, lists, links), a signature per account, further own addresses per account (aliases).
- Attachments open (with Mark-of-the-Web) and save; "Als Dokument speichern" files one as a document of a
  linked record.
- Remote images blocked until "Bilder laden" for that mail.
- An op journal panel lists stuck, failed and unclear operations with retry, resolve and cancel.
- A sync bar: syncing, working, offline with the next attempt, disk full, login refused.
- **Unread badge** on the "E-Mail" menu entry: the unread mails in the INBOX of **every** account
  (read-only accounts included, so new mail shows even in an account the page is not showing), as the
  folder tree counts them (`countByFolder`, pending moves left out), "99+" above 99. Only while the
  switch is on and an account exists; refreshed by the worker's `op-event` and changing `sync-event`
  (batched like the page's lists, under its own query key), never by a timer
  (`hooks/useMailUnreadCount.ts`, `components/mail/unreadBadge.ts`, `MailCore.getInboxUnread`).
  With several accounts its tooltip lists each account's share, and the mail page's account picker
  shows the same per-account count ("· 6 ungelesen"), so the sum is traceable (#88).

**In bookingum:**

- **Mail links** (`mail_link` in the app DB): mail is linked to persons, companies, bands, venues and
  events by address, automatically, and can be linked by hand ("Mail zuordnen") or dismissed.
- **"E-Mails" tab** on band, company, person, venue and event pages (`MailHistoryPanel`).
- **Invoices:** with the mail program "bookingum" ("Per E-Mail senden", Zahlungserinnerung, Mahnung)
  the editor opens on the account chosen in Einstellungen › E-Mail › "Senden von", the PDF is attached on
  send, and the invoice counts as sent only after a real send. The invoice page lists the mails it was
  sent with and every reply ("Antwort erhalten"); the status never changes on its own.
- **Contacts:** a sender can be saved as a person from the reader (`CreateContactSheet`). Mail never
  creates contacts on its own. A person can have several email addresses.
- **Search palette:** a mail group next to the app's records (only with the client on).

## Architecture

- **IMAP is the source of truth.** Locally: one `.eml` per message plus SQLite with FTS5 per account. The
  index can be rebuilt from the `.eml` files.
- **Separate mail store** (own SQLite file and folder per account), not the app DB: size, rebuildability,
  independent backup and lifecycle. Links to app records live in `mail_link` in the **app DB** (they must
  survive a rebuild of the mail store), keyed by account + Message-ID, never by UID or the store's
  `message_key` (that is `sha1(account|folder|uidValidity|uid)` and changes on every move). Mail without a
  Message-ID gets a fallback key.
- **Schema versions:** each store counts its schema in `PRAGMA user_version` (`core/migrations.ts`).
  Migrations are append-only, one transaction each; a store written by a newer build is refused, not
  opened.
- **Bodies apart from headers:** `messages` holds what lists, sorting and filters need; text and HTML live
  in `message_bodies`. Search still covers the body through the `fts_source` view.
- **The core** (`src/main/mailclient/core/`) has no Electron or bookingum imports
  (`tests/mail_core_boundary.test.ts` holds that). It talks to the host only through
  `createMailCore(options)` and the `Api` interface in `core/types.ts`.
- **Process model:** the core runs in an Electron utility process (`mailclient/worker.ts`, built as
  `out/main/mailWorker.js`), because better-sqlite3 is synchronous and sync must not block main or the UI.
  `MailClientService.ts` in main starts it (only with the setting on and an account saved), restarts it
  after account or setting changes, gives up after repeated crashes, and answers credential requests.
- **Single instance:** `app.requestSingleInstanceLock()` plus an exclusive lock on the mail data dir.
- **Passwords:** Electron `safeStorage` (DPAPI on Windows) in `accounts.json`; without OS encryption an
  account cannot be saved. Never in the mail store, logs, the renderer or `.env`.

On disk: `<userData>/mail/accounts.json`, `<userData>/mail/data/<accountId>/` (store and `.eml` files in
256 subfolders), `<userData>/mail/data/.mailcore.lock`. Keep it out of cloud-synced folders.

### How a call flows

**Reading** (listing a folder): the renderer's `useQuery({ queryKey: ['mail', accountId, 'messages', ...] })`
calls `mailApi.listMessages(folderId, page, accountId)` → `mail.call` (tRPC, `method` checked against
`z.enum(MAIL_API_METHODS)`) → `MailClientService.call` → the worker checks the allowlist **again** →
`core[method](...args)`. Values must survive structured clone: plain objects only, `Buffer` arrives as
`Uint8Array`.

**Writing** (flagging): `MailCore.markFlagged(...)` → `writableEntry(accountId)` (throws for "Nur lesen" or
settings the write guard refuses) → the op is written to the journal (`pending`) **before** any server
contact → `WriteEngine` runs it on one serial chain under the folder mutex: preflight (fresh SELECT,
UIDVALIDITY, existence, identity), the IMAP command, the local update, then `done`, `conflict` or `failed`.

**Events:** `sync-event` and `op-event` flow worker → main → the `mail.events` subscription; the renderer
invalidates `['mail', accountId, ...]` queries on them and never polls for op results.

**Waking from sleep:** `systemWake.ts` in main (Electron-free, tested on fake timers) watches
`powerMonitor` 'resume' plus a 30 s clock tick that arrives over two minutes late (sleeps the power monitor
misses, such as Windows Modern Standby). Signals within 60 s of a wake count once; while `net.isOnline()`
is false it waits up to 60 s for the network. Then `MailClientService.notifySystemResume()` posts
`{ type: 'resume' }` (nothing while the worker is starting, stopping or off), and the worker calls
`MailCore.afterSystemResume()`: per account it closes the sync and the IDLE connection (cleared before
closing, so no disconnect is counted and the circuit breaker stays shut), closes an **idle** write
connection without LOGOUT (one an op is using stays, its watchdog owns it), waits for a pass that is
already running, then runs one `syncAll()`. IDLE reconnects under the usual budget and backoff and starts
dirty, so it syncs INBOX once. A wake arriving while an account's catch-up is pending joins it; an
account whose login was rejected is left alone.

### Code map

```
src/main/
  index.ts                        startup (enabled check, startIfConfigured), pop-out mail windows,
                                  invoice:email, mail:copyLink
  mailclient/
    MailClientService.ts          the host: worker lifecycle, crash limit, credentials, connection test
    systemWake.ts                 wake from sleep (power monitor, late clock tick, network wait)
    worker.ts                     utility-process entry: createMailCore, the allowlist, events to main
    protocol.ts                   main <-> worker messages; MAIL_API_METHODS (the IPC allowlist)
    accounts.ts                   accounts.json, safeStorage, "Nur lesen", writeRefusal for the renderer
    attachments.ts                opening and saving attachments
    core/                         the engine; module map in core/README.md
  mail/                           invoice mail text, mail program choice, compose window, link clipboard
  api/routers/mail.router.ts      mail.call, mail.events, accounts, connection test, send
  api/routers/mail_link.router.ts mail links and the E-Mails tab
src/renderer/src/
  lib/mailApi.ts                  Proxy: mailApi.method(...args, accountId) -> mail.call
  hooks/useMailClientEnabled.ts   the experimental switch
  hooks/useMailUnreadCount.ts     the unread badge on the "E-Mail" menu entry
  hooks/useMail*.ts, useMessageActions.ts, useFolderActions.ts   the mail page's logic
  pages/MailPage.tsx, MailWindowPage.tsx
  components/mail/                panes, compose, dialogs; pure logic in *.ts with a vitest each
  components/settings/MailClientSwitchCard.tsx, MailAccountsCard.tsx
tests/mail_*.test.ts              vitest (sandbox-backed suites fail locally without the sandbox)
tests/e2e/mail-client.spec.ts     Playwright against the loopback sandbox
```

## Sync

IONOS has no CONDSTORE/QRESYNC. Sync is UID-list sweeps plus tiered FLAGS sweeps (INBOX and the open
folder: IDLE; recently active folders: short poll; cold folders: slow). IDLE works on IONOS (~8 s). A
UIDVALIDITY change resyncs that folder and never applies stale UIDs. Deleting local data because of a
server listing is gated three ways: an empty or truncated LIST never prunes.

**Connections have hard limits** (`core/imap_options.ts`): 15 s to connect, 10 s for the greeting, 120 s of
silence mid-command, one connection budget per account. Unreachable shows "Offline · nächster Versuch in …".
**A rejected login is never retried:** the account stops all server contact until it is saved again (a
lockout on a live account is worse than a stale inbox). Accounts are saved only after "Verbindung testen"
passes (one attempt, at most 15 s, worker paused). Encryption is explicit (SSL/TLS, or STARTTLS required,
never opportunistic), never guessed from the port; a login without encryption is allowed only to loopback.

**Large messages (S1).** Above `lazyAboveBytes` (5 MB) the sync stores a skeleton: headers, body text and
every part below the threshold, attachments listed with their estimated size (`complete = 0`). Lists,
search and the reader work from it; anything that needs the bytes (open or save an attachment, the `.eml`,
"Als Dokument speichern", forwarding) downloads the whole message once and the row is complete from then
on. The download never sets `\Seen`; there is no eviction.

**Recovery:** a corrupt store is set aside (`.corrupt-*`, never deleted) and rebuilt from the server; a
full disk pauses sync and says so; a UIDVALIDITY swap resumes. Details in `core/README.md`.

## Write path (never lose mail, never send twice)

- Every action goes into the persistent **op journal** before anything touches the server; after a crash
  ops resume or are safely abandoned, and a replay is idempotent.
- Before every mutating command: fresh SELECT, UIDVALIDITY check, UID addressing only, identity check.
- **Delete = move to Trash.** Permanent delete only from Trash, by explicit action, only with UID EXPUNGE
  (UIDPLUS); refused otherwise.
- **Send is a state machine:** `queued -> sending -> sent -> filed_in_sent -> done`. The final MIME is built
  once and stored. Once SMTP DATA has started the outcome is `unknown`, resolved by the user through a
  Message-ID probe in Sent; **never resent automatically**. Bcc never in headers.
- **Write guard** (`core/write_guard.ts`): refuses "Nur lesen" accounts and cleartext logins across a
  network. The account DTO carries the same check as `writeRefusal`, so the renderer offers no write the
  core would refuse.
- Undo for flag, move and delete within a short window.

## Security

Mail HTML is sanitized (DOMPurify) and rendered in a sandboxed iframe without `allow-scripts` or
`allow-same-origin`, CSP `default-src 'none'`; remote content blocked until asked for, with a timeout,
a size cap and no LAN addresses. Links open externally after showing the real URL; copying a link goes
through main with an http/https/mailto allowlist. Attachment names are sanitized on save, never
auto-opened, and get Mark-of-the-Web. `contextIsolation` on, `nodeIntegration` off, no custom protocol
exposing files.

## Working on it

### Rules (non-negotiable)

Set by the user over the sessions that built the client. If a task seems to need breaking one, stop and ask.

- **Secrets:** never read any `.env` file (bookingum's or the prototype's) or `.opencode/orthos-key`.
- **No mail content in any output:** bodies, subjects, addresses, names, attachment names. Not in chat,
  logs, docs, commits or test names; this includes the sandbox mailboxes, Playwright `test-results/`,
  `error-context.md`, traces and core logs. Report counts and structure only.
- Never copy the Outlook `.ost` or the prototype's `data/`, and never read `.eml` files the store reports as
  missing from its data dir.
- **No real personal data** in code, tests, docs or commits. Fixtures use reserved domains (`*.test`,
  `example.com`, `example.org`); `tests/no_pii.test.ts` must pass. Do not repeat PII already in the repo
  while removing it.
- **The real mailbox (IONOS):** agents and tests never connect to it, read from it or send through it; the
  user makes real sends. At most 2 connections to a production server at once. Never retry a failed login,
  in code or by hand.
- **Never send mail to another person**, from any account.
- **The sandbox:** leave it as you found it (remove what your tests created, nothing else). Never stop,
  restart or reset its containers, or the fuzz, proxy or prototype processes. Only one agent runs the mail
  e2e at a time.
- **Code:** no GPL or MPL code or dependencies. Never copy the prototype core over
  `src/main/mailclient/core/`. Never run `prettier --write` over `core/**` (it keeps semicolons and long
  lines); format the renderer and test files you touch.
- **Data:** no hard deletes, and never delete user data (mail data dirs, `accounts.json`, the app DB)
  without the user's OK, nor from code that runs on its own at start.
- **Git:** no push, merge or PR without the user's say-so. Never commit `.omo/`.

### Recipes

**A new method on the mail Api:** add it to `Api` in `core/types.ts`; implement it on `MailCore` with a
trailing optional `accountId` (reads use `entry(accountId)`, writes `writableEntry(accountId)` and the
journal, never IMAP directly); add the name to `MAIL_API_METHODS` in `protocol.ts` (without it router and
worker refuse it); call `mailApi.method(..., accountId)` from the renderer; add a vitest, and an e2e step if
it shows in the UI.

**A new journaled write op:** extend `OpKind` (no migration: `op_journal.kind` is TEXT); a public method
that validates, calls `journalEnqueue` and `replayOps`; a `case` in `WriteEngine.executeOne` plus `doX(op)` in
the module that owns the kind (`write_moves.ts`, `write_send.ts`, `write_folders.ts`). Use the engine's
`writeClient()`, never an ImapFlow of your own. Preflight the expected state and return `conflict` rather
than "fixing it up"; detect on replay that the server already did the work; hold the folder mutex for every
folder touched, deduplicated; update the store in one synchronous transaction after the server succeeded.

**The mail-store schema:** append a migration in `core/migrations.ts`, never edit one; add an upgrade case to
`tests/mail_store_migrations.test.ts` and run `ftsIntegrityCheck()` when indexed columns change (the FTS
index is external-content: keep the `messages_bd` trigger and `Store`'s explicit FTS writes consistent).

**An app-DB table** (like `mail_link`): `docs/ARCHITECTURE.md`, "Adding a new business object". App data
never goes into the mail store, which can be deleted and rebuilt.

**Renderer:** query keys start with `['mail', accountId, <kind>, ...]`; pure logic goes in
`components/mail/*.ts` with a vitest; no `Date.now()` or ref reads during render; German UI text per
`docs/UI_LANGUAGE.md` ("E-Mail-Konto", not "IMAP account"); write actions are hidden, not disabled, where
`readingActions(account).canWrite` is false; anything mail outside the mail page checks
`useMailClientEnabled()`.

### Verification

`pnpm test && pnpm lint && pnpm typecheck && pnpm build`, then
`npx playwright test tests/e2e/mail-client.spec.ts` (always name the spec files). Report summary counts
only. The suite turns the experimental switch on itself.

- **The sandbox** lives in the prototype (`sandbox/`, docker compose): Dovecot IMAP on `127.0.0.1:10143`
  (CONDSTORE) and `:10144` (an IONOS-like profile without it), Mailpit SMTP on `:1025`, its UI on `:8025`.
  bookingum's e2e mailbox is `E2E_MAIL_USER` in `tests/e2e/helpers/mailSandbox.ts`; never use
  `testuser@example.test`, which belongs to the prototype's fuzz harness.
- Without the sandbox the mail e2e skips and the sandbox-backed vitest suites **fail** locally
  (`tests/helpers/sandboxGate.ts`; they skip with `CI` or `BOOKINGIUM_NO_SANDBOX=1`). A skip is not a pass.
- `node scripts/mail-sandbox-counts.mjs` prints per-folder counts of the e2e mailbox: compare before and
  after a run.
- Dovecot allows about 10 connections per user: keep tests serial.
- `pnpm fuzz:mail -- --seed 7 --ops 30` (or `--seeds 50`) runs the seeded fuzz harness (`tests/fuzz/`)
  against the sandbox. It is deliberately not a `.test.ts`, so `pnpm test` never runs it.

### Traps (each has cost a session)

1. `message_key` is not stable (see Architecture). Link by account + Message-ID; after a move, look the row
   up again by its new key.
2. File paths are `path.join(<account data dir>, row.file_path)`; a bare `file_path` resolves against the
   working directory.
3. The FTS index is external-content: never write to `fts` outside `Store`, never delete from it by hand
   (the `messages_bd` trigger already does).
4. The folder mutex has no owner and is not reentrant: taking the same folder twice in one chain deadlocks
   the op queue. Deduplicate; refuse a move onto its own folder.
5. Never release a lock you do not own, never time one out by force: a timed-out op stops touching the
   server first.
6. Send is exactly-once: after DATA started, `unknown`, never `failed`, never an automatic resend.
7. Journal first, and every replay idempotent.
8. Windows file locks: Defender or the indexer can hold a fresh file, so `rename`/`unlink` may fail with
   `EPERM`/`EBUSY`. Retry briefly; never leave a row pointing at a missing file.
9. The orphan sweep deletes files: anything that lets a row and its file disagree, even briefly, can lose
   a file.
10. Radix modal dialogs hide the page from the accessibility tree: close them before `getByRole` on the list.
11. Return plain objects across IPC: a `Map`, `Set` or class instance arrives broken.
12. better-sqlite3 transactions are synchronous: never `await` inside one.
13. IDLE and sync can both see the same new UID: `storeMessage` must stay idempotent.

## Decisions (by design)

These look like bugs or gaps but were chosen. Change one only together with the user.

- **Folder delete:** mail that arrives between the server check (`STATUS`, subfolders) and the `DELETE` is
  lost with the folder. IMAP has no conditional DELETE; the window is one round trip on a folder the user
  chose to delete. A refused delete stays in the journal as a conflict and is not retried.
- **A rename stuck in `pending`** pauses the sync of that folder subtree until the op resolves (done, failed
  or discarded in the op panel); syncing it meanwhile is the race the review found (MR-31).
- **Invoices:** a second send of the same invoice is allowed: each send has its own key and is its own
  mail, and the invoice lists both. A pending row of an unclear send that is never confirmed stays; nothing
  reads it but the confirmation, and it goes with its invoice.
- **The status of an invoice never changes from mail on its own**, and mail never creates contacts on its
  own: replies are listed, contacts are created by the user.
- **Hotels stay out of mail linking** (decided with the user): no link type, no E-Mails tab. A hotel mail
  that matters is about an event and is linked to that event by hand. The hotel form hides the further
  addresses field; the table and repository would handle them if that changes.
- **Remote images:** a name whose DNS answers include any private address is not loaded, even if a public
  answer would work (the safe side of split-horizon DNS).
- **Attachments:** a type outside the allowlist is not opened from the app, but can be saved and opened
  from Explorer; it carries the Mark-of-the-Web, so SmartScreen and Protected View apply.
- **The sanitizer** lifts `<style>` blocks out itself although DOMPurify would drop them too: belt and
  braces against a parser mutation that keeps them.
- **No DKIM/SPF checking** in the client. An idea for later: read the server's `Authentication-Results`
  and warn on a DMARC fail, or on a display name that matches a contact while the address does not.

## Dependencies

better-sqlite3 MIT, imapflow MIT, mailparser MIT, nodemailer MIT-0, dompurify MPL-2.0 OR Apache-2.0
(used under Apache-2.0). All permissive; re-check licenses when adding packages.

## Open

What is not built yet is tracked as GitHub issues with the label
[`area:mail`](https://github.com/bennischober/bookingium-app/issues?q=is%3Aissue+is%3Aopen+label%3Aarea%3Amail),
starting with leaving "experimental" (#62) and the multi-day soak (#64). Right-click on links in a mail
was decided against for now: the link list has open and copy.

Known limits of what is built:

- A saved draft reopens as plain text: `fromSavedDraft` (`composeDraft.ts`) drops its formatting.
- The invoice PDF that main attaches on send is not counted against the editor's 20 MB attachment limit.
- A UIDVALIDITY swap needs room for both copies of the folder; it checks first and stops with the
  disk-full message (`core/disk_full.ts`).
- After a write the write connection stays open for `WRITE_IDLE_MS` (30 s, `core/write_connection.ts`), and
  IDLE on that account waits as long. Not tuned against IONOS yet.

## Lessons (keep)

- Selected-mailbox views can be stale: re-SELECT before every mutating command.
- Search bugs hide at small scale: test against an independent oracle on a store of 30k+ messages
  (`tests/mail_search_oracle.test.ts`).
- Do not couple file names to keys; the store owns the path.
- Windows is case-insensitive: folder names that differ only by case collide on disk.
- Double-instance incidents: never swallow `EADDRINUSE` or lock errors.
- Do not copy GPL (isync, Mailspring sync) or MPL (Thunderbird) code; ideas only.
