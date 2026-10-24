# Next steps: mail client and integration (handoff)

Written 2026-10-24 on `feat/mail-client` (state: `0cdf750` plus this document) so another agent
(opencode) can pick the work up. Read `docs/mail-client.md` first (design, decisions, rules), then this file.

**Superseded in parts (2026-10-24, later commit).** The detailed handoff now lives in four files. Read them in this order:

1. `docs/mail-client.md`: design and decisions (unchanged rules).
2. `docs/mail-client-assessment.md`: maturity of the prototype and of the port, the risk register R1–R11, and the gates.
3. `docs/mail-client-handbook.md`: how to work in this code (map, call flows, recipes, traps, definition of done).
4. `docs/mail-client-tasks.md`: the task cards (T, P, A, B, C, D, E) with steps and acceptance criteria. **This is the
   work list**; §3 below is the older, shorter version of it.

This file stays for the Task 5 review (§2: findings F1–F7) and the direction (§4). Where §2/§3 and the task cards
disagree, the task cards win. In particular, the `92cf76a` row in the port table is replaced by card A3
(opaque names chosen at write time, temp file + fsync + rename, the row inserted with the path that exists).

Contents:

1. Where the branch stands
2. Review of prototype Task 5 (findings and what to port)
3. Detailed to-do list, in order
4. Direction: where this is going
5. Rules that stay in force

---

## 1. Where the branch stands

Built and tested (unit + Playwright E2E against the local Dovecot sandbox, all green at `0cdf750`):

- Mail core in `src/main/mailclient/core/` (imported from prototype `56bae02`, since then developed **here**: this
  is the source of truth; prototype changes are ported by hand, never copied over).
- Accounts with connection test, sync in a utility process, FTS5 search, reading with sanitized HTML and blocked
  remote images, one store per mailbox, one running app per data folder.
- Writing (sandbox accounts only, the write guard refuses production): flags, move, drag onto folders,
  delete to Trash, archive, undo; drafts, reply / reply-all / forward, send; pop-out mail window.
- Multi-select (click, Ctrl/Shift, Shift+arrows, Ctrl+A, checkboxes), bulk pane, batch undo, right-click menu,
  mark unread.

Not built: folder management, permanent delete in the UI, attachments in compose from bookingum documents, any
link between mails and persons / companies / bands / events / invoices.

**Production gate:** the real IONOS account stays read-only until a canary mailbox exists and the write-path
suite has passed against it. The user has not created the canary mailbox yet. Do not weaken the write guard.

---

## 2. Review of prototype Task 5

Source: `D:\Projects\Arbeit\Brainstorm\email-prototype`, commits `92cf76a..f0cd5dc`, report `REPORT5.md`.
Opencode's suites, harnesses and long runs are good work, and most fixes are right. But four of the
changes are wrong or unsafe as written. **Do not port them as they are** (F1–F4).

### Findings

**F1: new-mail file write leaves rows without a file (data-loss class; likely the open "seed 33" flake).**
`sync.ts` saveMessage now writes the `.eml` to `<key>.tmp-<serial>.eml` but inserts the row with
`file_path: relPath` (the *final* name `<key>.eml`), and renames afterwards. So:

- between insert and rename, the row points at a file that does not exist;
- if `renameSync` fails (on Windows this is common: Defender or the indexer holds a freshly written file, so you get
  EBUSY / EPERM), the row keeps pointing at the missing final name. The comment claims "the row still points at the
  tmp file"; it does not;
- the parse-error branch inserts with `relPath` and **never renames at all**, so every unparseable mail gets a row
  without a file;
- in each case the tmp file is unreferenced, so `sweepOrphans` deletes it after the 10-minute grace. The local copy is
  then gone, and the row stops sync from downloading it again;
- `renameFile`'s catch runs `UPDATE … SET file_path = fromRel WHERE file_path = fromRel`, which is a no-op, and
  rename-then-UPDATE leaves a row without a file if the UPDATE fails (DB closed, busy).

REPORT5 §8 says no code path can produce a row without a file; this one can. "12 of 13 rows without file" on
Windows fits rename failures in a burst. Fix: write tmp → fsync → rename to the final name → insert the row with the
path that actually exists (final name, or the tmp name if the rename failed). A crash after the rename and before the
insert leaves an orphan *file*, which the grace-period sweep handles safely. Tests: injected rename failure,
unparseable message, crash between each step.

**F2: the op hard timeout breaks the single-writer rule.** `write_engine.ts` `execute()` starts the 90 s deadline
*before* the op acquires its folder mutexes, and on expiry calls `forceReleaseFolderMutex` for those folders. The
mutex is a plain `Set` of paths with no owner, so this releases whoever holds it. Normally that is a long folder sync,
e.g. the initial download of a 32k INBOX, which holds the INBOX mutex for minutes. An op that only *waited* behind
it times out, deletes the sync's lock, and the next op then runs concurrently with that sync on the same folder.
Fix: the mutex gets an owner token; start the deadline only after all of the op's mutexes are acquired; on timeout,
release only the entries this op owns.

**F3: the op hard timeout makes duplicate sends possible.** The timeout resolves `failed` for every op kind. A
`send` whose SMTP transmission has started is not stopped (`closeAllClients` closes IMAP clients only) and may
still be delivered. `failed` invites a resend, and a duplicate breaks the exactly-once rule. 90 s is also too
short for a 25 MB send or append on a slow uplink (about 100 s at 2 Mbit/s). Fix: once SMTP DATA has started, a
timeout ends in `unknown` (the probe path), never `failed`. Make the deadline inactivity-based (no bytes moved for
N seconds) or size-scaled, not a fixed total.

**F4: abandoned work keeps writing.** After the timeout wins the race, the abandoned op body continues: when its
closed client rejects, it can still run `applyMoveLocally`, `journalUpdate` and store updates after the op was
recorded as failed and the next op started. Fix: pass an AbortSignal (or an "abandoned" flag) and check it before
every local write in the op.

**F5: draft resume leaves the old version (duplicate drafts).** In `doDraftSave`, both resume branches (known
`appendedUid` found, or found by Message-ID probe) return `done` before the "remove the previous version"
step, so `oldUid` stays on the server. The catch-branch does the same. Fix: after a successful resume, continue
with the old-version cleanup. The Message-ID probe is only safe because every draft save gets a fresh Message-ID
(bookingum `compose.ts` does `randomUUID()` per build). Keep that invariant and write it down at the probe.

**F6 (latent): `fileBase` getter recurses.** `return this.store.dataDirResolved || this.fileBase` overflows the
stack if `dataDirResolved` is ever empty. Intended: `|| this.account.dataDir`.

**F7 (already in bookingum, not from Task 5): expunge deletes the wrong things.** bookingum
`write_engine.ts:344-345` (permanent delete from Trash) runs `DELETE FROM fts WHERE rowid = ?` on the
external-content FTS5 table, which is invalid for external content and can corrupt the index (deleteMessages
already handles FTS). It also unlinks `row.file_path` *relative to the process cwd* instead of the data dir. The
prototype fixed both in `92cf76a`. Port before permanent delete gets a UI.

**On the report's numbers:** the 1200-seed B4 run is not evidence of correctness: 237 seeds were killed with no
output and about 35 had truncated details. The real evidence is B5 (150/150) and the 2 h soak, both run *before*
F1–F4 were found. After fixing F1–F4, run the long fuzz and the soak again, on both profiles.

### What to port into bookingum (by hand, with tests)

bookingum already has `socketTimeout` (120 s) and a client `error` listener (its own versions; do not port
`98c024f` again).

| Prototype change | Port? |
|---|---|
| `18eab47` Gate 0: empty LIST never prunes folders | yes, as is |
| `fb4411a` refuse move/delete without MOVE+UIDPLUS before any copy; no plain EXPUNGE; resume looks in the *target* mailbox | yes, as is |
| `4f962d7` dedupe folder mutexes per op (`[...new Set(...)]`) + refuse self-move before server contact | yes, as is (bookingum `write_engine.ts:97` still nests) |
| `ae1ad02` draft replay probes by Message-ID before APPEND | yes, **with the F5 fix** |
| `ae1ad02` single file base (`store.dataDirResolved`) | yes, **with the F6 fix** |
| `92cf76a` file names opaque, DB owns path, moves don't rename, `checkFileConsistency` | yes, **with the F1 fix**, and include the expunge fix (F7) |
| `b600830` + `8041735` op hard timeout + force mutex release | **only redesigned** (F2, F3, F4) |
| `WriteEngine.currentOp()` diagnostic | optional |

Also port the matching prototype suites where bookingum has no equivalent (prune gates, UIDPLUS-less, big-message
crash replay, search oracle on 30k synthetic mails). Use synthetic mail only.

---

## 3. Detailed to-do list, in order

### A. Core safety (before any production write)

1. Fix F1–F6 in the prototype, or tell opencode to do it there (it owns the fuzz/soak harness), then rerun the
   long fuzz and the 2 h soak on both Dovecot profiles.
2. Port the table above into `src/main/mailclient/core/` by hand, with unit tests; F7 included.
3. Canary: the user creates a canary mailbox at IONOS. Then run the write-path suite against it under an
   account-level allowlist (prototype `.env.canary` rules, synthetic mail, a handful of sends). Only after it passes
   may the write guard allow that one account, and later the real one. **Waits on the user.**

### B. Mail client features still missing

4. **Folder management:** create, rename, delete (with a confirmation and a count), and moving folders by drag and
   drop in the folder tree. Every one of these is a journaled op with undo where the server allows it. Respect the
   prune gates. Never delete a folder that still holds mail without saying how many.
5. Keyboard shortcuts: Ctrl+U / Ctrl+Q (unread / read), and others where the UI language doc allows them.
6. Batch moves in one `UID MOVE` per source folder instead of one op per mail (speed for large selections; journal
   must still record each mail's new UID).
7. Permanent delete from Trash in the UI (after F7 is ported). "Papierkorb leeren" with count and confirmation.
8. Attachments: open/save from a mail, add files to a new mail (from disk and from bookingum documents, see C).
9. Signatures per account; reply quoting options.

### C. Integration into bookingum (the reason for an own mail client)

The goal: bookingum sends its own mails and knows, for every person / company / band / event / invoice, which
mails belong to it. Order:

10. **Send from bookingum instead of an external program.** Today invoice emails, Mahnungen and Verteiler go out
    through `src/main/mail/openEmail.ts` / `mailProgram.ts` (classic Outlook `.eml`, Thunderbird `-compose`,
    `mailto:`, or files). Add a method "Bookingum" to the mail-program setting
    (`src/main/api/schemas/settings.schema.ts`): it opens the inline editor prefilled with recipient, subject,
    text and the PDF attached (callers: `InvoiceEmailButton.tsx`, `InvoicePrintPage.tsx`, `contact_list.router.ts`).
    The old methods stay as fallback. Real sending waits on the canary (A3); until then this works for sandbox
    accounts only.
11. **Mail ↔ record links.** A table that links a message (by Message-ID + account, which survives moves and
    re-syncs, not by row id or UID) to a person / company / band / event / invoice / contract. Links are made:
    - automatically by address: a mail's from/to/cc matched against the email addresses of persons and companies;
    - automatically by thread: replies inherit the links of the mail they answer;
    - automatically for mails bookingum sent (invoice → invoice, contract → event);
    - by hand: "Zuordnen" in the mail view and the right-click menu.
12. **Mail history on detail pages:** a "E-Mails" tab or section on the person, company, band, venue and event
    detail pages (`PersonDetailPage.tsx`, `CompanyDetailPage.tsx`, `BandDetailPage.tsx`, `VenueDetailPage.tsx`,
    `EventHubPage.tsx`), using the FTS store. Click opens the mail window.
13. **Invoice status from mail:** an invoice sent from bookingum records when and to whom; a reply in the thread
    shows on the invoice. Mahnungen go through the same path.
14. **Save attachments as documents:** "Als Dokument speichern" on an attachment stores it in bookingum's documents
    (`storage/documents/…`, table in `src/main/db/schema.ts` › documents) with the link to the matched record.
15. **Mention mails in the global search** (`search-command-button.tsx`) next to persons, events etc.

### D. Documents rework (needed by C14, also useful on its own)

16. Today documents hang off a record with a fixed folder layout (`documents/bands/<id>-<slug>/…`). Rework so the
    user can create categories / subfolders per record (Verträge, Rider, Rechnungen, Bilder, …), move documents
    between them, and see all documents of a record in one place, including those that came in by mail. The DB
    keeps the relation (document ↔ record ↔ mail), never the file name.

### E. Repository hygiene

17. **`.opencode/` out of the remote, kept locally:** done on this branch (untracked, already in `.gitignore`). It
    leaves the remote's `main` when this branch is merged. It stays in the history; that is fine, since
    `orthos-key` was never committed. Check with `git log --all -- .opencode/orthos-key` (no output = never
    committed).
18. **Seeding code and PII.** The seed code is `src/main/db/seed.ts` (1065 lines, imported by
    `src/main/index.ts`), `scripts/seed-mail-sandbox.mjs` and `sample_data/` (gitignored except
    `internal-seed.example.json`). Recommendation:
    - keep the *code* that seeds, but let it read its data only from a gitignored local file (like
      `sample_data/*` already is), with a small synthetic example committed;
    - nothing with real names, addresses or mails in tracked files; add a check (a test or pre-commit hook) that
      fails when tracked seed or fixture files contain anything but `example.test` / `example.com` addresses;
    - if real PII was committed before, removing it from history needs a history rewrite and a force push: that
      is the user's decision, not an agent's.

---

## 4. Direction: where this is going

Bookingum becomes the one place where the agency's work happens:

- **Everything is a record with relations.** Persons, companies, bands, venues, events, contracts, invoices,
  documents and mails all link to each other. From any record you see its whole history: what was agreed (contract),
  what was billed (invoice, Mahnung), what was said (mails), what was received (documents, attachments).
- **No second program for mail.** Reading, searching (fast, local, full text over the whole archive), writing and
  sending all happen in bookingum. Outlook goes away for this user. Bookingum's own outgoing mail (invoices,
  reminders, lists, contracts) is sent and filed by bookingum, with a record of what went out when.
- **End-to-end references.** A mail sent for an invoice points at that invoice; a reply points at the same thread;
  an attachment saved from it becomes a document of the same record. Nothing is matched by file name or folder
  alone; the database holds the relations.
- **Safety first, always.** Local-first store, journaled writes with undo, exactly-once send, no write to a real
  mailbox before a canary proves the path, no mail content in logs or reports.
- Next big items after this: e-invoice obligations (ZUGFeRD in 2027, mandatory 2028-01-01, see `docs/TODOS.md`),
  code signing and auto-update.

---

## 5. Rules that stay in force

- Production IONOS account read-only until the canary passes; at most 2 connections to production; never retry a
  failed login.
- Never print, paste or commit mail content (bodies, subjects, addresses, attachment names), including the
  sandbox Dovecot mail and Playwright `test-results/` snapshots and error-context files. Counts, UIDs and hashes only.
- Never read `.env` files. Never commit the `.ost`, the prototype's `data/`, or anything from `MISSING-dataDir`.
- The core stays free of Electron and bookingum imports. Never copy the prototype core over bookingum's core.
- No GPL/MPL dependencies. Keep mail data out of cloud-synced folders.
- Leave the sandbox as it was after tests (the E2E suite checks out and restores; compare per-folder counts).
  Don't use `testuser@example.test` (the fuzz harness's user) and don't stop the sandbox containers.
- Don't delete user data without confirmation; don't push without the user's say-so.
- Commits end with `Co-Authored-By: …` per the repo's convention; core files are not prettier-formatted, renderer
  and test files are (`pnpm -s exec prettier --write <files>`).
