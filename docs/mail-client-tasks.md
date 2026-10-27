# Mail client: task cards

Written 2026-10-24 on `feat/mail-client` (`62f5956` + this commit). Each card is one unit of work for one agent
session: goal, why, prerequisites, files, steps, acceptance criteria, tests, traps and size. Take the cards **in
order**, unless a card says it can run in parallel. Before you start any card, read `docs/mail-client-handbook.md`
in full. The ranked risks the cards refer to (R1–R11) are in `docs/mail-client-assessment.md` §5. The findings
(F1–F7) are in `docs/NEXT_STEPS.md` §2.

**Rules for every card**

- Read every file named under *Files* before you change it. If the code does not look like the card says (line
  numbers drift; the logic should still be recognizable), stop and report. Do not improvise a different design.
- Write the test first where the card names one, and see it fail for the right reason.
- Stay inside the card. No drive-by refactors. If you find another problem, add it to *Found while working* at the
  end of this file with a one-line description.
- Done = handbook §11 (definition of done). Then mark the card `done (<commit>)` in the status table below.
- Cards marked **[user]** need the user's decision or action. Prepare what you can, then stop and ask.

Sizes: S ≈ under 150 changed lines, M ≈ 150–500, L ≈ more (split it into several commits).

## Status

| Card | Title | Size | Depends on | Status |
|---|---|---|---|---|
| T1 | Lint green | S | — | done |
| T2 | Doc drift | S | — | done (this commit) |
| T3 | E2E tests independent of each other | S | — | done |
| T4 | Sandbox count script | S | — | done |
| P1 | Prototype: fix F1–F6, rerun fuzz + soak | M | — | open (prototype repo) |
| A1 | Fix expunge (F7) | S | T1 | done |
| A2 | Port Task 5 gates: Gate 0, UIDPLUS-less, mutex dedupe | M | T1 | done |
| A3 | Crash-safe `.eml` files, consistency check, orphan sweep | M–L | A1 | done |
| A4 | One file base | S | A3 | done |
| A5 | Draft replay probe + old-version cleanup (F5) | M | A2 | done |
| A6 | Stuck-op watchdog (instead of the hard timeout) | M | A2 | done |
| A7 | Per-account write path | L | A1–A6 | part 1 done (each account carries its own IMAP+SMTP endpoint, the guard decides per account from the account itself, TLS relaxed only on the loopback allowlist, the global sandbox config is gone, account dialog has SMTP fields; 7 unit tests incl. two accounts on their own maildir). **Part 1a done (`36ff37f`):** the SMTP transport now authenticates with the account's credentials and has its own `smtpSecurity` instead of borrowing the IMAP one - the sandbox could never prove either, because Mailpit accepts unauthenticated mail and no TLS. Proven with a fake SMTP server that refuses `MAIL FROM` until a correct AUTH arrives. Part 2 (canary) is **built** - as a FLAG set from the account dialog (`8ca6fd4`), not as the approved
  `CANARY_ACCOUNT_ID` constant; the design sign-off is still open (review section 6). It was **approved**, design written into the card: one named `CANARY_ACCOUNT_ID` constant rather than a third account kind, set only by a manual step, never from the UI |
| A8 | Port the prototype suites to vitest | L | A1–A3 | done |
| A9 | Canary | M | A7, A8, P1 | **[user]** approved and split into two phases 2026-10-25. The IONOS canary mailbox exists (temporary account; never send to another person, at most to another address the user owns). Phase 1 = synthetic mails, a handful of sends to the user's own address, at most 2 connections, no retry after a failed login; report counts only, then stop. Phase 2 = staged writes on the real account (flags → move → delete → send), its own go-ahead. Blocked on A7 part 2 and P1. Clarified 2026-10-27: before the formal phase-1 run, the user already used the canary mailbox for moves and deletes (G2, G4), sends limited to the user's own address; the production mailbox stayed read-only, so phase 2 has not started |
| B1 | Folder create / rename / delete | L | A3, A2 | done |
| B2 | Move folders by drag and drop | M | B1 | done (folder rows are drag sources with their own drag type; dropping on a folder or the tree root runs the rename op with the new parent; move rules are pure and unit-tested; e2e drags a folder in and checks the server path survives a sync) |
| B3 | Keyboard shortcuts | S | — | done |
| B4 | Batch moves in one UID MOVE | M | A2 | done |
| B5 | Empty Trash / permanent delete in the UI | S | A1 | done |
| B6 | Attachments: open and save | S | — | done |
| B7 | Attachments in compose | M | — | done |
| B8 | Signatures | S–M | — | done |
| C1 | "Bookingum" as mail program (invoices, reminders, lists) | L | B7 | done (setting + availability rule; invoice handler opens the own compose window and marks the invoice only after a real send; `invoice_email.message_id` + account id stored for C4; e2e sends through Mailpit) |
| C2 | `mail_link` table + linker | L | — | done |
| C3 | E-Mails tab on detail pages | M | C2 | done |
| C4 | Invoices: sent mails and replies | M | C1, C2 | done (invoice.mails joins invoice_email.message_id with In-Reply-To/References in the store; card on the invoice page, "Antwort erhalten"; status never changes automatically) |
| C5 | Attachment → document | M | C2, D1 (optional) | done (chip action opens a dialog pre-selected from the mail's links; main writes the bytes into the owner folder via documentStorage and records `document.source_message_id` + account; D1 category selection not done - D1 is open) |
| C6 | Mails in the global search | S–M | — | done |
| E1 | Seeding without PII | M | — | done |
| E2 | PII check for tracked files | S | E1 | done |
| F1 | Test the security boundaries worst-first | L | — | done, all 7 (sanitize 25 / 2 bugs, remote_images 13 / 1 bug, write_guard 7, compose already covered, files enforced by construction, imap_options 7, store search 8 / 1 bug) |
| F2 | Write to an address from a mail header | S–M | B7, B8 | done (Von/An/Cc are buttons for a writable account; pure `composeTo` carries only the recipient, with the signature, and never In-Reply-To/References, a quote or the old subject) |
| F3 | Lightweight formatting in compose | M | — | done (contenteditable with four commands; `composeBody` reduces the HTML to the formatting offered and derives the plain text, which stays the source of truth; sent as `multipart/alternative`) |
| F4 | Paste attachments from the clipboard | M | B7 | done by unit tests only (a form-level paste handler; `pasteContent` is pure and decides files > image > text; the bytes go through B7; no E2E - see F5) |
| F5 | Reloading with an open, changed draft destroys the window | S | — | done (main tells a reload from a close via the window's own `close` event, which a reload never fires; a close is held while the renderer saves and then released through `mail:closeWindow`; F4's E2E is back) |
| F6 | A folder drag stays armed, so the next mail drag moves the folder | M | B2 | done (`onDragEnd` disarms it, and a mail drag disarms it too; E2E reproduces the user's sequence) |
| F7 | Dropping a folder back to the root level is refused | S | B2 | done (a visible "Auf oberste Ebene ziehen" target; every pixel of the list was a row, so "beside the rows" was unreachable) |
| F8 | The mail window has fewer actions than the reading pane | S | — | done ("Als ungelesen markieren" was not passed to the window) |
| F9 | "Als Dokument speichern" asks for a record id | M | C5 | done (the record is searched by name through that type's own list procedure; the mail's link pre-selects the type and the record) |
| F10 | Attachment chip: click opens, menu has save / save as document / save all | S–M | B6, C5 | done (a split chip: click opens, the chevron has Speichern unter… and Als Dokument speichern…; "Alle speichern…" and "Alle als Dokument…" sit in their own bar above the chips, only when there is more than one) |
| F11 | Links in the compose editor | S | F3 | done (the allowlist had no `<a>`, so links were reduced to text; http/https/mailto survive, unsafe schemes lose the href. A bare `http(s)://` typed or pasted becomes a link at send time, with trailing punctuation left outside it, and text inside an existing link is never linkified again) |
| F12 | A draft should show as unread | S | — | done (a draft was appended with `\Seen`; now `\Draft` only) |
| F13 | Reply starts with two empty lines above the quote | S | — | already correct (`bodyText` starts with `\n\n`), now pinned by a test |
| F14 | Does the mailbox sync on its own? | S | — | done (it does: IDLE on INBOX plus a 30s/120s poll; the bar now says "· automatisch" or "· regelmäßig" with a tooltip explaining what that means) |
| F15 | A pasted attachment leaves the app dead for the next reload | M | F4 | done (the renderer called `window.close()` from `beforeunload`, which also fires on a reload. A reply in a popped-out window was then not stored as a draft: main destroyed the window on the first close, so the save was cut off. A close is now held, the renderer saves and asks for it through `mail:closeWindow`, and main lets only that close through - the user confirmed the draft lands in Drafts) |
| G1 | The main process dies opening the mail settings | M | — | **closed as test-harness-only, not fixed**: reproduces only in Playwright launches, never in normal use (confirmed by the user, who has used the app extensively). The stack's top frame is `Session.<anonymous>` inside Electron itself (`browser_init:1:119322`), so Electron's own code emits on a `Session` (which shares the `EventEmitter` prototype with `ipcMain`), and `electron-trpc@0.7.1`'s listener assumes every argument is an `IpcMainEvent` and reads `event.sender.id` before looking at the message. Four probes failed to name the event (wrapping `ipcMain.emit`, `Session.prototype.emit` twice, and the `ipcMain.on` listener); a defensive guard was written and **reverted** because it made real `mail.accounts.list` calls time out. The canary suite no longer depends on the settings page (`c7ebac0`), so nothing waits on this |
| G2 | Moving/deleting feels laggy against a real mailbox | M | — | done: `42b7a1f` (every write op announces itself, not just a send) · `2fe13c2` (the list answers the click before the server does, and restores the row when the move fails) · `cdbd712` (only the folders a move touched are resynced, not a full `syncAll()` with its 150 ms pause per folder) · `342ca77` (one write connection for the whole op chain instead of connect+LOGIN+LOGOUT per op) · `752749c` (a mail being moved leaves its source list at once, so a reload, the mail window, search and the counts agree). Measured on the sandbox with zero network latency: connect+LOGIN 73 ms and SELECT 31 ms per op - over TLS to IONOS that is several hundred ms on every click. **Confirmed by the user on the IONOS test mailbox (the canary account, not the production mailbox): an inbox delete is now almost immediate** |
| G3 | The sync bar is missing | S | — | done (`5975198`): `syncStatus` is enabled only once the worker reports `running`, so during startup `status` was undefined and `SyncIndicator` returned `null` - the whole bar vanished, which reads as "this feature does not exist". It now shows "Startet…", and a running write op still wins over it |
| G4 | Deleting a draft is still slow after G2 | S | — | done (`7593145`): two causes. (a) the renderer awaited the whole write before closing the editor, and unlike `moveAway` a discard had no optimistic hide - it now closes at once and reports a failure as a toast. (b) `discardDraft()` journaled only `uid`, no `message_key`, so the L2 read-side exclusion never matched it and the draft lingered in the list until the resync - the op now carries the key and resyncs only the two folders it touched. **Confirmed by the user on the same IONOS test mailbox: a draft delete is now fast too** |
| G5 | A saved draft takes long to appear in Drafts | S | — | done (`b7a5d2f`): a saved draft had NO local row. It appeared only after the APPEND finished AND Drafts had been resynced, which re-downloaded the message the client had just uploaded. The write path now stores the appended message locally through the same parse/insert path a synced mail uses (`SyncEngine.storeAppendedDraft`, flags included so F12's count still works); the resync becomes a consistency check instead of the way the draft appears. Best effort by design - a local-store failure never fails the save |
| H1 | The sync time does not move while polling | S | — | done (`7ec185b`): `lastSyncAt` was set only in `syncAll()`, never in the poll loop, so it could be hours old while the mailbox was current. The poll now records it through the same `noteServerContact()` path, and an unreachable server does not move it |
| H2 | A visible "working" indicator | S | — | done (`5ad4513`): the bar had a spinner for syncing, but a write op was invisible until it finished - the core emitted an op-event only when the RESULT arrived, so a slow send looked like nothing happened. The core now announces the start too, and the bar shows "Sendet…" / "Verschiebt…" / "Löscht…". `draft_save` (every 1.5 s while typing) and `flag` (every read/unread) are excluded, or the bar would blink nonstop |
| H3 | Reply does not put the cursor above the quote | S | — | done (`93479cb`): not the caret - F13 had fixed the text, but `toEditorHtml()` splits on blank lines and drops empty blocks, so the two leading newlines produced no paragraph at all and the editor opened directly on the quote. A leading blank block is now kept as an empty paragraph; a draft typed from scratch is unchanged |
| H4 | The bullet list button does nothing visible | S | — | done (`d8fe1ee`): neither suspect was guilty - `composeBody()` keeps UL/OL/LI correctly, and jsdom has no `execCommand` at all. It was RENDERING: Tailwind's preflight sets `list-style: none` on every list, so the `<ul>` had no bullets and read as ordinary lines. Restored inside `.mail-editor` only; the reading pane never had the problem, its sandboxed iframe is its own document |
| H5a | "Bilder laden" does nothing | S | — | done (`2d81488`): `loadRemoteImages()` returns early unless `options.remoteImages.enabled`, and the worker never passed `remoteImages` at all - the button was a no-op |
| H5b | A sent mail does not look like its draft | S | — | done (`5d2eb68`): the iframe's `<style>` was deliberately empty, so the mail rendered in the browser's default serif while the editor is the app's sans-serif. It now carries four properties (margin, system-ui, 14px, line-height) before the mail's own styles, so a mail that sets its own font still wins. Not an attempt to make draft and rendered identical - the receiver's client decides the rest |
| H6 | The dead strip on the right of every page | S | — | done: `html { scrollbar-gutter: stable }` reserved 15px although nothing on `<html>` could scroll (measured body 869px against an 884px viewport). The rule now sits on `[data-testid="content-scroll"]`, which is what actually scrolls |
| H7 | Contacts from the server, and from mail | M | — | settled: IMAP stores no contacts, so import the Outlook CSV once; never auto-create from mail. A "Als Kontakt speichern" action on a mail (popover per address recommended) |
| H8 | The read-only / sandbox dropdown for release | S | — | settled, do at release not now: one account kind, no test-server option, no canary toggle for end users |
| D1 | Documents findable and visible | M | — | done (`16dd09a`): storage stays flat, no `document_link`, categories reuse `document_type`; the event tab shows the band's documents read-only and the band tab is one list filtered by category and event |
| D2 | Documents in the search palette | S | — | done (`c4731d4`): a "Dokumente" group matched on the file name, labelled with category and owner, opening the file directly; file names also get LIKE escaping (`_` is a wildcard and common in file names) |
| D3 | Events are archived, not deleted | M | — | done (`5563502`): `deal_memo.archived_at`, one `notArchived()` predicate imported by every read path, archive view with restore, hard delete refused while an invoice links the event; `cancelled` stays a separate status |

T and A cards come first. B, C and E cards may run in parallel to A cards when the files do not overlap (C2/C3 and
E1/E2 touch no core files). Never run two cards at once that touch the same files.

---

## T: hygiene

### T1: lint green

**Goal.** `pnpm -s lint` exits 0, with no `prettier/prettier` warnings from the core.

**Why.** R6. The repo gate includes lint; while lint is red, nobody notices new problems.

**Files.** `eslint.config.mjs`; `src/main/mailclient/core/connection_test.ts`, `index.ts`, `sanitize.ts`,
`store.ts`, `sync.ts`, `write_engine.ts`.

**Steps.**

1. Run `pnpm -s lint` and save the list of errors (rule + file:line only).
2. In `eslint.config.mjs`, add a block **after** `eslintConfigPrettier` (the last entry), so it wins:
   ```js
   {
     // The mail core keeps the prototype's style (semicolons, long lines) so hand-ports stay
     // diffable; it is not prettier-formatted (src/main/mailclient/core/README.md)
     files: ['src/main/mailclient/core/**'],
     rules: { 'prettier/prettier': 'off' }
   }
   ```
   Check that `.prettierignore` does not need the same (it is for `prettier --check`; add
   `src/main/mailclient/core/` there too if `pnpm exec prettier --check .` is ever used).
3. Fix the 19 errors by hand, **without changing behavior**:
   - `no-empty` (empty `catch {}` or `{ }` blocks; about 11 in `sync.ts`, 1 each in `connection_test.ts` and
     `write_engine.ts`): put a comment inside that says why ignoring is safe, for example
     `catch { /* logout after a failed op: the connection is gone either way */ }`. Read the surrounding code to
     write a true reason. If you cannot find one, keep the catch and leave a note in *Found while working*.
   - `@typescript-eslint/no-unused-vars` (`index.ts` `_drop`, `write_engine.ts` `_`, `sync.ts` `e`): remove the
     binding (`catch {}`), or use an ignore pattern only if the variable is needed for destructuring.
   - `@typescript-eslint/no-explicit-any` (`store.ts` ×3): replace with the real type or `unknown` plus a cast at
     the one place that needs it.
   - `no-control-regex` (`sanitize.ts`): if the regex deliberately matches control characters, add
     `// eslint-disable-next-line no-control-regex -- strips C0 controls from header text` (with the true reason).
   - `no-useless-escape` (`store.ts`): remove the backslash, and make sure the regex or string means the same
     (add a unit test if the expression is used for search escaping).
4. Run the full gates (handbook §6).

**Acceptance.** `pnpm -s lint` exit code 0. `git diff --stat` shows only the files above. vitest and E2E counts are
the same as before.

**Traps.** Do not run `prettier --write` on core. Do not "fix" by disabling rules for the whole core: only
`prettier/prettier` is turned off; the other rules stay on.

---

### T2: doc drift (done in this commit)

`docs/mail-client.md` (types live in `core/types.ts`; the link key is account + Message-ID, not `message_key`; the
IPC path), `src/main/mailclient/core/README.md` (bookingum paths instead of prototype ones, R1 note, data on disk).

---

### T3: E2E tests independent of each other

**Goal.** Every test in `tests/e2e/mail-client.spec.ts` can run alone (`-g "<name>"`) and passes after an earlier
test failed.

**Why.** R7. Today `sandboxId` is set by the first test only, so one failure makes every later test fail with a
misleading error.

**Files.** `tests/e2e/mail-client.spec.ts`, maybe `tests/e2e/helpers/mailSandbox.ts`.

**Steps.**

1. Add `async function ensureSandboxAccount(): Promise<string>` to the spec. It lists the accounts over IPC
   (`listMailAccounts` or whatever the first test uses to read them back), returns the id of the sandbox account
   with the E2E user, and creates it (the same calls as the first test) if it is missing.
2. Replace every read of the module-level `sandboxId` with `const id = await ensureSandboxAccount()` at the start
   of each test. Keep the first test as the test of *saving* an account. It may delete and recreate the account if
   it must prove a fresh save.
3. Do the same for the read-only account used by the read-only tests (`10144` saved as `production-readonly`).
4. Make sure every test's cleanup runs in `finally` and restores the state it changed (moves undone, flags
   restored, sent mails removed through `removeSentTestMails`).
5. Check: run each test alone with `-g`, then the whole file twice in a row.

**Acceptance.** Each test passes alone. The whole file passes twice in a row. Sandbox counts are equal before and
after (T4).

**Traps.** Radix dialogs hide the page from `getByRole` (handbook §10.10). Do not raise timeouts to hide
flakiness; find the missing wait.

---

### T4: sandbox count script

**Goal.** `node scripts/mail-sandbox-counts.mjs` prints per-folder message counts for the E2E mailbox, so the
"leave the sandbox as it was" rule can be checked.

**Files.** New `scripts/mail-sandbox-counts.mjs`; maybe `tests/e2e/helpers/mailSandbox.ts` (reuse its constants).

**Steps.**

1. Use `imapflow` (already a dependency). Connect to `127.0.0.1:10143`, `secure: false`, user
   `bookingum-e2e@example.test`. Take the password from `tests/e2e/helpers/mailSandbox.ts` (import it, or keep a
   copy of the constant with a comment pointing there).
2. `list()` the folders and run `status(path, { messages: true })` for each one. Print one line per folder:
   `<path>\t<count>`, sorted by path. Then `logout()`.
3. Refuse any host that is not `127.0.0.1` or `localhost` (hard-coded; no arguments for the host).
4. Exit code 1 if the connection fails, with a short message (no stack).
5. Mention the script in handbook §6 (replace "card T4 adds").

**Acceptance.** The script prints counts only: no subjects, addresses or bodies. It works when the sandbox is up
and fails cleanly when it is down.

**Traps.** Never point it at `testuser@example.test` or at production. One connection, closed in `finally`.

---

## P: prototype (`D:\Projects\Arbeit\Brainstorm\email-prototype`)

### P1: fix F1–F6 in the prototype, then rerun the long runs

**Goal.** The prototype's write path is free of F1–F6, and the long-run evidence (fuzz and soak, both Dovecot
profiles) is current again.

**Why.** The bookingum ports (A2–A6) take their logic from the prototype. The prototype also owns the fuzz, soak
and fault-proxy harnesses, which bookingum does not have yet.

**Steps.**

1. F1 (file write): see A3 for the correct order; implement the same in the prototype's `sync.ts` (both the parse-OK
   and the parse-error branch), and fix `renameFile`'s no-op UPDATE.
2. F2/F3/F4 (hard timeout): replace them with the watchdog design of A6, or remove the forced mutex release
   entirely. Never release a mutex that the op does not own.
3. F5 (draft resume): after a successful resume, continue with the old-version cleanup.
4. F6: `fileBase` returns `this.store.dataDirResolved || this.account.dataDir`.
5. Rerun: the crash-point suite, `test-uidplus-less`, `test-prune-gates`, `test-big-message`,
   `test-file-decoupling`, then `fuzz-long` with `--parallel 1` on both profiles, then `soak-2h`. Use the same
   parameters as REPORT5 used for B5 and the soak.
6. Write `REPORT6.md` in the prototype: what changed, the suite counts, and for every killed or truncated seed, why.
   Counts and seeds only, no mail content.

**Acceptance.** All suites green; fuzz with no unexplained seed; soak with zero drift; seed 33 (I6) no longer
reproduces.

**Traps.** Dovecot's limit of 10 connections per user and IP: fuzz must run serially. The fuzz harness uses
`testuser@example.test`, and only the prototype may use it.

---

## A: core safety (before any production write)

### A1: fix expunge (F7)

**Goal.** Permanent delete from Trash removes exactly the right row and file, and the FTS index stays intact.

**Why.** R2. `write_engine.ts` `doExpunge` (around line 340–346) runs
`DELETE FROM fts WHERE rowid = ?` after `store.deleteMessages`. The `messages_bd` trigger already removed the row
from the external-content index; the extra delete corrupts it. It also unlinks `row.file_path` relative to the
process's working directory.

**Files.** `src/main/mailclient/core/write_engine.ts`; a new test `tests/mail_expunge.test.ts`.

**Steps.**

1. Test first. Build a temp-dir `Store` like `tests/mail_write_queue.test.ts` does, insert two messages with
   files, and run the local part of the expunge. To make that testable, move the local cleanup into a small method
   (for example `removeLocally(messageKey)`) and call it from `doExpunge`. Assert:
   - `store.ftsIntegrityCheck()` is true;
   - the other message is still searchable;
   - the expunged file is gone from the account dir;
   - no file is touched outside the temp dir. Run the test with `process.chdir` to a different temp dir to prove
     the path does not depend on the working directory.
2. Fix:
   - remove the `DELETE FROM fts` line;
   - unlink `path.join(this.store.dataDirResolved, row.file_path)`;
   - if unlink fails, log the error (no file name in the message, the key is fine). The row is gone, so the file is
     an orphan for the sweep.
3. Order: delete the row first, then the file. A crash in between leaves an orphan file (safe), never a row without
   a file.

**Acceptance.** The new test passes and failed before the fix. Gates green.

**Traps.** Do not add a UI for expunge in this card (that is B5).

---

### A2: port the Task 5 gates (three parts, one commit each)

**Files.** `src/main/mailclient/core/sync.ts`, `write_engine.ts`, `index.ts`; tests `tests/mail_prune_gates.test.ts`,
`tests/mail_write_queue.test.ts` (extend), `tests/mail_uidplus.test.ts`.

Read the prototype commit first: `git -C D:\Projects\Arbeit\Brainstorm\email-prototype show <hash>`. Port the
**logic** by hand into bookingum's code. The code around it differs, so a patch will not apply, and must not be
forced.

**A2a: Gate 0, an empty LIST never prunes** (prototype `18eab47`).

- Where folders vanished from LIST are pruned locally (`sync.ts`, the folder-list step around line 420–470: look
  for the code that selects `id, file_path FROM messages WHERE folder_id = ?` for removal), add a first gate:
  if the server's LIST returned **zero** folders, or no INBOX, prune nothing, and log a warning.
- Test: a fake folder list that is empty, then one without INBOX: no local folder or message is deleted. A normal
  list in which one folder is missing still goes through the existing gates.

**A2b: servers without MOVE or UIDPLUS** (prototype `fb4411a`).

- Before any COPY, a move or delete must check the capabilities: without `MOVE` **and** `UIDPLUS`, refuse with
  `conflict` ("server cannot move single messages safely"). Never fall back to COPY + `\Deleted` + plain
  `EXPUNGE` (that would expunge other messages flagged `\Deleted` by another client).
- A resumed move looks for the message in the **target** mailbox (by Message-ID) before it copies again.
- Test: Dovecot profile `:10144` advertises less; if it still has MOVE and UIDPLUS, test with a stubbed capability
  set on the client object.

**A2c: mutex dedupe and self-move refusal** (prototype `4f962d7`; R3).

- In `WriteEngine.execute()` (around line 97):
  `const folders = [...new Set([op.folder_path, op.target_folder_path].filter((p): p is string => !!p))]`.
- In `doMoveLike` (and in `MailCore.moveToFolder` before the journal insert): if the target equals the source,
  return `conflict` (or skip that mail in a batch) **before any server contact**.
- Test (in `tests/mail_write_queue.test.ts`): a move op with source = target finishes (no hang; give the test a
  short timeout) with `conflict`, and the next op in the queue still runs.

**Acceptance (all three).** The new tests fail before and pass after. Gates green. E2E drag-and-drop still passes.

---

### A3: crash-safe `.eml` files, consistency check, orphan sweep

**Goal.** No code path can leave a message row whose file is missing or truncated, and files that belong to no row
are cleaned up without ever deleting a file a row needs.

**Why.** R4, R5, and F1 in the prototype. Today `sync.ts` `storeMessage` (around line 810) writes the final
`<key>.eml` in place (no temp file, no fsync), then parses, then inserts the row. A move renames the file
(`write_engine.ts` around line 305) and then updates the row: a crash between the two leaves the row pointing at
the old name. A folder rename (B1) would change the key of **every** message in the folder (the folder id is
`sha1(account|path)`), so key-named files would all need renaming.

**Decision (made here; do not re-decide).** File names become **opaque and permanent**: a random name chosen once
when the file is first written (`<randomUUID()>.eml`), stored in `file_path`, never renamed. Moves and re-keys only
update the row. Existing files keep their `<key>.eml` names. That is fine, because the DB owns the mapping, so no
migration is needed.

**Files.** `src/main/mailclient/core/sync.ts` (`storeMessage`), `write_engine.ts` (move: remove the rename),
`index.ts` (consistency check, sweep), `store.ts` (helpers), `src/main/mailclient/worker.ts` (scheduling), new
`core/files.ts` (writer), tests `tests/mail_files.test.ts`.

**Steps.**

1. New `core/files.ts` with `writeMessageFile(dir, source): string` (returns the relative name):
   - `name = randomUUID() + '.eml'`, `tmp = name + '.tmp'`;
   - `fs.openSync(tmp, 'wx')`, write everything, `fs.fsyncSync(fd)`, close;
   - `fs.renameSync(tmp, name)` with up to 5 retries, 50 ms apart, on `EPERM`/`EBUSY`/`EACCES` (Windows AV);
   - if the rename still fails, return the **tmp** name (the file exists under that name, and the row will point
     at it);
   - on any error before the rename, unlink tmp (best effort) and rethrow.
2. `storeMessage`: first `const relPath = writeMessageFile(dir, msg.source)`, then parse, then `insertMessage`
   with that `relPath`, in **both** branches (parsed OK and parse error). If `insertMessage` throws (for example
   UNIQUE, when the other connection won the race), unlink the file you just wrote.
3. Moves: remove the rename in `write_engine.ts`; only update `folder_id`, `uid`, `message_key` (keep the
   `movedTo` payload for undo). Keep `file_path` as it is.
4. `MailCore.checkFileConsistency(accountId?)` returns
   `{ rowsWithoutFile: number; filesWithoutRow: number; tmpFiles: number }`. It is read-only and returns counts only.
5. Repair rows without file: for each one, if the account is reachable, FETCH the source by UID (a read, allowed for
   read-only accounts too) and write it with `writeMessageFile`, then update `file_path`. If the UID is gone, leave
   the row: the normal sync removes it. Rate-limit it (at most N per sync pass) and run it from the sync loop, not
   at startup in a blocking way.
6. Sweep (replaces the delete in `sweepOrphans`): a file that is not referenced and older than the grace period is
   **moved** to `<accountDir>/orphans/`; files there older than 7 days are deleted. `.tmp` files older than the
   grace period are treated like orphans. Schedule the sweep in `worker.ts`: once 10 minutes after start, then
   every 6 hours, never while an initial sync of that account is running.
7. Add the consistency counts to `getSyncStatus()` (or a new Api method; recipe 4.1), so a future status view can
   show them.

**Tests (`tests/mail_files.test.ts`).**

- Injected rename failure (stub `fs.renameSync` to throw `EPERM` 6 times): the row points at the tmp name and the
  file can be read through the row.
- Unparseable message: the row exists with `parsed_ok = 0` and its file exists.
- Crash simulation: write a file and do not insert the row (throw between the two): the sweep moves it to
  `orphans/` only after the grace period, and never a file a row references.
- Move: the row moves, `file_path` stays the same, and the file is still readable.
- `checkFileConsistency` counts each kind correctly.
- After a run, `ftsIntegrityCheck()` is true.

**Acceptance.** All the tests above pass. The E2E suite passes. A manual check: run the app against the sandbox,
sync, move a mail, restart; `checkFileConsistency` reports zeros.

**Traps.**

- Never derive a file name from the key again (handbook §10.1).
- Do not schedule the sweep before steps 1–3 are done.
- Do not let the repair run against production without the read-only rules (handbook §8): it is a FETCH, so it is
  allowed, but it shares the 2-connection limit and must use the sync engine's connection, not a new one.

---

### A4: one file base

**Goal.** Every file access in the core resolves paths from one place.

**Why.** Today `MailCore` uses `entry.config.dataDir` and `WriteEngine`/`Store` use `store.dataDirResolved`. Both
hold the same value (`index.ts` around line 117), but two sources for one value drift apart. The prototype's
version (`ae1ad02`) has a recursion bug (F6).

**Files.** `core/index.ts`, `core/write_engine.ts`, `core/sync.ts`, `core/store.ts`.

**Steps.** Add `Store.filePath(rel: string): string` (`path.join(this.dataDirResolved, rel)`) and use it
everywhere a message file is opened, read, written or deleted. The sync engine uses `this.store` too, not
`this.account.dataDir`. If a fallback is needed anywhere, it must be the account's own dir, never a getter that
calls itself (F6).

**Acceptance.** `grep -n "dataDir" src/main/mailclient/core/*.ts` shows only the construction, `Store`, and the
lock. Gates green.

---

### A5: draft replay probe and old-version cleanup (F5)

**Goal.** Saving a draft after a crash neither creates a duplicate nor leaves the previous version on the server.

**Files.** `core/write_engine.ts` (`doDraftSave`, `removeDraft`, around line 477–530), `core/compose.ts` (check the
Message-ID), `tests/mail_compose_draft.test.ts` or a new `tests/mail_draft_replay.test.ts`.

**Steps.**

1. Read prototype `ae1ad02` (draft part) and the F5 description in `NEXT_STEPS.md`.
2. Before the APPEND on a replay (`attempts > 0` or state `running`), search the Drafts folder for the draft's
   Message-ID (`HEADER Message-ID`). If it is found, take that UID as the appended one.
3. In **every** path that ends with a saved new version (new APPEND, found by probe, known `appendedUid`), continue
   with removing `oldUid` if there is one. Only then is the op `done`.
4. At the probe, write this comment: the probe is only safe because every draft save builds a fresh Message-ID
   (`compose.ts` uses `randomUUID()` per build). Add a unit test that two builds of the same draft have different
   Message-IDs, so the invariant is guarded.

**Tests.** Against the sandbox (skip if it is down), with the E2E user:

- crash after APPEND (simulate by running the op and then resetting its state to `running`): the replay finds the
  draft, does not append again, and removes the old version;
- normal save with an `oldUid`: exactly one draft afterwards;
- clean up in `finally`.

**Acceptance.** No duplicates in the Drafts folder after the tests (count before/after).

---

### A6: stuck-op watchdog (instead of the prototype's hard timeout)

**Goal.** A write op that hangs is detected and reported, and the write queue recovers safely, without ever
running two writers on one folder and without risking a duplicate send.

**Why.** The prototype's hard timeout (`b600830`, `8041735`) is unsafe (F2, F3, F4). bookingum already has
`socketTimeout` (120 s) in `imap_options.ts`, so a dead socket ends with an error by itself. What remains is a
server that keeps the connection alive but never answers.

**Design (follow it; ask before deviating).**

1. **Owner tokens for the folder mutex.** In `sync.ts`, `syncingFolders` becomes a `Map<string, symbol>`.
   `withFolderMutex(path, fn, owner = Symbol())` stores the owner, and `finally` deletes the entry only if it still
   holds that owner. `yieldFolderToWrites` keeps working (it hands over and takes back its own token).
2. **The watchdog starts after all mutexes are held**, not when the op is queued.
3. **The limit is size-aware:** `max(120 s, payloadBytes / 32 KB/s)` for append and send, 120 s otherwise.
4. **When the limit is hit:**
   - set `abandoned = true` on the op context (an `AbortController`; pass its signal into `doX`). Every `doX` checks
     `signal.aborted` before **each** local write (store update, journal update, file write) and stops if set;
   - close **this op's** clients (IMAP `logout()`/`close()`, SMTP transport `close()`);
   - wait up to 15 s for the op body to settle;
   - if it settles, record the outcome: `send` after the SMTP phase started → `unknown` (never `failed`), anything
     else → `failed`, with reason "timed out";
   - if it does not settle, **do not release the mutex**. Stop the write queue for this account, emit an op-event
     with a German error for the UI ("Schreibvorgänge angehalten. Bitte bookingum neu starten."), and log it.
     Restarting the worker is the recovery; the journal makes it safe.
5. **Send phase:** before calling nodemailer, write `payload.phase = 'smtp'` to the journal. Any failure or timeout
   after that ends in `unknown`, resolved by the probe.

**Files.** `core/sync.ts` (mutex), `core/write_engine.ts` (context, checks, phases), `core/index.ts` (queue stop,
event), `worker.ts`/`MailClientService.ts` if the event needs forwarding, tests.

**Tests.**

- Mutex: a sync holds INBOX; a write op waits; the waiting op's watchdog is not running yet (it starts only after
  it acquires).
- Ownership: releasing with the wrong owner does not remove the entry.
- Abandon: a fake op that never resolves → after the limit, no local write happens after abandon, the queue stops,
  and the event is emitted.
- Send: a timeout after the phase is set to `'smtp'` → `unknown`.

Use fake timers (`vi.useFakeTimers()`) and fakes for the clients. Do not wait in real time.

**Acceptance.** Tests green; no forced release anywhere (`grep -n forceRelease` finds nothing); gates green.

---

### A7: per-account write path

**Goal.** Writes for an account go to **that** account's servers, with TLS verified, and the write guard decides per
account.

**Why.** R1: today one global sandbox config (the first sandbox account, SMTP port 1025, no TLS,
`rejectUnauthorized: false`) serves all writes.

**Part 1, buildable now (sandbox only):**

1. Accounts get write endpoints: IMAP host/port/security (exists) plus SMTP host/port/security (new fields in
   `accounts.json`, with defaults: sandbox → host of IMAP, port 1025, no TLS). Extend the account dialog
   (`MailAccountsCard.tsx`) with SMTP fields, shown for sandbox accounts now, and for others later.
2. `WriteEngine` gets a per-account client factory instead of `sandboxClient()`/`sandboxSmtp()`. It uses the
   account's endpoints and the host's `credentials()` for that account.
3. TLS: `rejectUnauthorized` is `false` **only** when the host is on the loopback allowlist; otherwise it is the
   default (verify).
4. The write guard becomes `assertWriteAllowed(account)`: allowed if `account.kind === 'sandbox'` and the IMAP and
   SMTP hosts are on the loopback allowlist. Nothing else is allowed in Part 1. Keep `assertSandboxHost` as the
   check inside.
5. Remove the global `injectSandboxConfig`. `MailClientService.workerInit` stops passing a sandbox config.
6. Tests: two sandbox accounts (two users on the sandbox; if only one user exists, fake the second one with a
   stub server), and each one's writes reach its own mailbox. A non-loopback sandbox account is refused.

**Part 2, canary [user]: APPROVED 2026-10-25, not yet built.** The user approved a canary mailbox and the split of A9
into two phases (see A9). The design to implement:

- **One named mailbox, not a third account kind.** Adding `'production-canary'` to `MailAccountKind` touches 22 places and
every one of them is a chance to accidentally admit a real account. Instead: one explicit constant in `write_guard.ts`
  (`CANARY_ACCOUNT_ID`), checked in `writeRefusal()`: allowed if the account id equals it, refused otherwise. Auditable on
  one screen; revoking is deleting one constant. `kind` stays `'sandbox' | 'production-readonly'`.
- **Never from the UI.** The id is set by an explicit manual step in `accounts.json`; the account dialog has no control for
  it, and a saved account whose id is not the canary one stays refused.
- **Log per write:** account id and outcome only. Never the host together with the user name.
- **TLS:** the canary is off the loopback allowlist, so `tlsOptions()` already verifies the certificate there. `SANDBOX_ALLOWLIST`
  stays untouched - the canary is a second, separate admission path, not a wider allowlist.
- **Depends on the SMTP auth fix (`36ff37f`)**, which is done: without it a real server refuses the first send with 530/535.

**Traps.** Credentials only through `credentials()`, never cached on disk. Never log hosts with user names
together. Do not widen `SANDBOX_ALLOWLIST`.

---

### A8: port the prototype suites to vitest

**Goal.** bookingum has its own regression suites for the core, so it does not depend on the prototype for
evidence.

**Order and form** (one commit per suite; synthetic mail only, generated in the test):

| Prototype suite | bookingum test | Needs sandbox | Notes |
|---|---|---|---|
| `test-core-boundary.ts` | `tests/mail_core_boundary.test.ts` | no | static: no `electron`, no `process.env`, no `../` imports out of core, no hosts except in `write_guard.ts` |
| `test-search-oracle.ts` | `tests/mail_search_oracle.test.ts` | no | 30k synthetic mails behind `MAIL_LONG=1`; a 2k version always |
| `test-prune-gates.ts` | `tests/mail_prune_gates.test.ts` (from A2a) | no (fake LIST) | |
| `test-file-decoupling.ts` | `tests/mail_files.test.ts` (from A3) | no | |
| `test-uidplus-less.ts` | `tests/mail_uidplus.test.ts` | yes (`:10144`) | skip if down |
| `test-big-message.ts` | `tests/mail_big_message.test.ts` | yes | 25 MB, behind `MAIL_LONG=1` |
| `test-crash-points.ts` | `tests/mail_crash_points.test.ts` | yes | |
| `test-compose.ts` | extend `tests/mail_compose.test.ts` | no | Bcc policy |

- Sandbox tests use `bookingum-e2e@example.test`, run serially (`describe.sequential`), and clean up in
  `afterAll`. Since `393dcfa` they FAIL locally when `127.0.0.1:10143` is closed and skip only on CI or
  with `BOOKINGIUM_NO_SANDBOX=1` (`tests/helpers/sandboxGate.ts`), so a skip cannot look green in a terminal.
- Keep the default `pnpm test` under about 60 s. Long variants are behind `MAIL_LONG=1`.

**Acceptance.** All ported suites pass. `pnpm test` stays fast. The skip reason is visible in the output.

---

### A9: canary [user]

**Waits on:** A7 Part 2 built, A8 (done), and P1 - which lives in the prototype repo
(`/mnt/d/Projects/Arbeit/Brainstorm/email-prototype`), not here, and was still running when this was written.

**The mailbox exists.** The user created a temporary account at IONOS next to the real addresses, for the real-world
tests. Constraint given by the user: **never send to another person** - at most to another address the user owns.

**Split into two phases (user decision 2026-10-25).** The card used to bundle two different risk levels; the first phase
is what the canary is for, the second is a separate decision.

**Phase 1 - does the write path work against a real server (buildable once A7 part 2 and P1 are done):**

- Synthetic mails only, a handful of sends to the user's own address, at most 2 connections, no retry after a failed
  login.
- Report counts and outcomes only, never mail content.
- **Stop and report.** Phase 2 does not start from this result.

**Phase 2 - staged writes on the real account (needs its own go-ahead):** flags → move → delete → send, one stage at a
time, each with its own report. This is the irreversible one and gets its own decision.

---

## B: mail client features

### B1: folder create / rename / delete

**Prerequisites.** A3 (opaque file names: a rename re-keys every message in the folder), A2.

**Design.**

- New `OpKind`s: `'folder_create' | 'folder_rename' | 'folder_delete'`. No migration is needed (`kind` is TEXT),
  but update the `OpKind` union in `core/types.ts`. Payloads: `{ path }`, `{ from, to }`, `{ path }`.
- Api methods (recipe 4.1): `createFolder(parentPath | null, name)`, `renameFolder(path, newName)`,
  `deleteFolder(path)`. They validate the name (not empty; no hierarchy delimiter; no leading or trailing spaces;
  not `INBOX` in any case), build the path with the folder's `delimiter`, and journal the op.
- **Special folders** (INBOX and any folder with a special-use flag: Sent, Drafts, Trash, Archive, Junk) cannot be
  renamed, deleted or moved. Refuse in `MailCore` and hide the menu items in the UI.
- **Delete refuses non-empty folders** in this version: "Der Ordner enthält noch N E-Mails. Verschieben oder löschen
  Sie sie zuerst." Also refuse when the folder has subfolders. (Deleting a folder with mail on IMAP deletes the
  mail permanently, with no undo.)
- **Refuse while ops are pending** for the folder or its subfolders (journal `pending`/`running` with that
  `folder_path` or `target_folder_path`).
- **Rename, local side:** after the server's RENAME, SELECT the new path and compare UIDVALIDITY. If it is the same,
  re-key locally in one SQLite transaction: the folder row(s) (this one and every subfolder: path prefix + delimiter)
  get the new path and new id (`sha1(account|newPath)`), and their messages get the new `folder_id` and
  `message_key`. Files are not touched (A3). If UIDVALIDITY changed, update only the folder rows and let the normal
  UIDVALIDITY swap re-download.
- Hold the folder mutex for both paths (deduplicated) during a rename, and stop IDLE on that folder first.
- **Idempotent replay:** create: the folder exists → `done`; rename: the target exists and the source does not →
  `done` (then do the local part); delete: the folder does not exist → `done`.
- **Undo:** create → delete (if still empty), rename → rename back, delete → create (empty). Use the existing undo
  plumbing (`undoOp`).
- **Sync and prune gates:** the local re-key must happen before the next LIST, or the prune gates would see the old
  folder as vanished. Hold the folder-list step off while a folder op runs.

**UI.** `FolderTree.tsx`: right-click menu "Neuer Ordner…", "Umbenennen…", "Löschen…"; an inline name field or a
small dialog (Radix, `components/ui/dialog`); German errors; nothing shown for read-only accounts.

**Tests.**

- Unit: name validation; the re-key transaction (folder ids, message keys, subfolders, `ftsIntegrityCheck`).
- Sandbox: create → rename → delete round trip; refusal for a non-empty folder; replay after a simulated crash for
  each kind.
- E2E: create a folder in the UI, rename it, delete it; the sandbox is left as found.

**Size.** L: split into commits (core ops + tests, re-key, UI + E2E).

---

### B2: move folders by drag and drop

**Prerequisites.** B1.

A folder move is a `folder_rename` to a new parent path (`newParent + delimiter + name`), with the same rules as
B1: no special folders, no move into itself or its own subfolder (refuse before server contact), no name clash in
the target (show "Ein Ordner mit diesem Namen existiert dort schon."). Reuse the drag-and-drop pattern the message
list uses for mails (`MessageList.tsx`, the drop targets in `FolderTree.tsx`), but with a different drag type, so a
folder cannot be dropped as a mail and the other way round. Dropping on the root level moves to the top.

E2E: drag `Projekte` into a new folder and back; the sandbox is left as found.

---

### B3: keyboard shortcuts

Ctrl+U = mark unread, Ctrl+Q = mark read, Del = to Trash, Ctrl+Shift+V = move (opens the folder picker), Ctrl+N
= new mail, Ctrl+R = reply, Ctrl+Shift+R = reply all, Ctrl+L = forward (Outlook's keys, because the user comes
from Outlook). Only while the mail list or the reader has focus, never while typing in an input or the editor.
Disabled for read-only accounts. Put the key → action map in a pure module with a unit test, and add one E2E check
(Ctrl+U toggles unread). Check `docs/UI_LANGUAGE.md` before adding shortcut hints to menus.

---

### B4: batch moves in one UID MOVE

Today a move of N mails is N ops. Group by source folder: one op per (source, target) with a UID set, one
`UID MOVE`, and use the COPYUID response to record each mail's new UID (`payload.movedTo` becomes a list). Undo
moves them back as one op. Keep the per-mail preflight (existence, identity) in a single FETCH for the set. If the
server returns no COPYUID, refuse (A2b's rule) rather than guessing. Cap a batch at 500 UIDs and split above that.
Tests: 50 mails moved and undone; replay after a crash between MOVE and the journal update finds them in the target
by Message-ID.

---

### B5: empty Trash and permanent delete in the UI

**Prerequisites.** A1.

"Endgültig löschen" in the Trash folder's message menu and the selection bar; "Papierkorb leeren" in the Trash
folder's right-click menu. Both show a confirmation with the count ("12 E-Mails endgültig löschen? Das kann nicht
rückgängig gemacht werden."). Only in Trash, only for writable accounts. `expungeFromTrash` already exists in
`MAIL_API_METHODS`. E2E: move a seeded mail to Trash, delete it permanently, and check the folder counts. The mail
must be one the test created itself, never a seed mail other tests need.

---

### B6: attachments, open and save

`getAttachment` exists. Add "Öffnen" (write to a temp folder under `app.getPath('temp')/bookingum-mail/`, then
`shell.openPath`) and "Speichern unter…" (`dialog.showSaveDialog`, in main) to the attachment chips in
`MessageView.tsx`. This needs a small main-process IPC or tRPC procedure that takes (accountId, messageId, index),
fetches the bytes from the worker, and writes them. The renderer never gets a file path to write to.

Safety: sanitize the file name (strip path separators and reserved Windows names, cap the length). For
executables (`.exe`, `.bat`, `.cmd`, `.js`, `.vbs`, `.ps1`, `.scr`, `.lnk`, `.msi`), "Öffnen" shows a warning first.
Clean the temp folder on start (files older than a day).

---

### B7: attachments in compose

`DraftInput.attachments` (`core/types.ts`, `{ filename, contentType, base64 }[]`) and `compose.ts` already support
attachments. Missing: the UI in `ComposeView.tsx` (an "Anhängen" button → main-process file dialog → the bytes are
read in main and passed as base64; drag and drop of files onto the editor), the chips with remove, and a total-size
limit of 20 MB with a German message. Drafts keep their attachments (they are in the MIME). Tests: a unit test for
the size check; an E2E test that attaches a small generated file, sends to Mailpit, and checks Mailpit's API for
one attachment (count and size only).

---

### B8: signatures

One signature per account (plain text and simple HTML), edited in the account settings, inserted on new mail,
reply and forward (above the quote), and never inserted twice when a draft is reopened. Store it in
`accounts.json` (not secret). Unit-test the insertion in `composeDraft.ts`.

---

## C: integration into bookingum

### C1: "Bookingum" as mail program

**Goal.** Invoices, reminders, dunning letters and Verteiler mails can be written and sent from bookingum's own
editor, with the PDF attached, instead of opening Outlook or Thunderbird.

**Files.** `src/main/api/schemas/settings.schema.ts` (`MailProgramSetting` gets `'bookingum'`),
`src/main/mail/mailProgram.ts`, `src/main/index.ts` (the `invoice:email` handler, around line 390–430),
`src/main/api/routers/contact_list.router.ts` (`openBccEmail`), the renderer callers
(`components/invoice/InvoiceEmailButton.tsx`, the invoice print page, the Verteiler page), the settings page
(mail program choice), `components/mail/ComposeView.tsx`.

**Steps.**

1. Setting: `'bookingum'`, label "Bookingum (eigenes E-Mail-Konto)". Only selectable when a writable mail account
   exists; "Automatisch" never picks it in this version.
2. When it is chosen, the `invoice:email` flow builds the same draft (`invoiceEmail(...)`) and PDF, then opens the
   pop-out compose window (the same mechanism as `MailWindowPage`, with a new "compose" mode), prefilled with to,
   subject, text and the PDF attachment (B7). The user reviews and sends. `markInvoiceEmailed` is called **after a
   successful send**, not when the window opens (unlike the external programs, bookingum knows the send happened).
3. The send returns `messageId`. Store it with the invoice email record: a new nullable column
   `invoice_email.message_id` (app-DB migration, handbook 4.4) and the mail account id. C4 uses it.
4. Verteiler: open compose with Bcc recipients (the separator logic is not needed: the editor takes a list).
5. The old methods stay unchanged as fallbacks.

**Tests.** A unit test for the setting and the method choice (`mailProgram.ts` is pure). E2E with the sandbox:
send an invoice mail through bookingum to Mailpit; the invoice shows as emailed; Mailpit has one mail with one PDF
attachment (count and size only). Clean up through `removeSentTestMails`.

**Traps.** Real sending only works for sandbox accounts until A9. The UI must say why the option is unavailable
for a read-only account. Never send automatically without the user pressing "Senden".

---

### C2: `mail_link` table and linker

**Goal.** Bookingum knows, for every person, company, band, venue, event, invoice and contract, which mails belong to
it, and the links survive moves, re-syncs and a rebuild of the mail store.

**Table (app DB, `src/main/db/schema.ts`).**

```
mail_link
  id              integer pk
  mail_account_id text not null
  message_id      text            -- without <>, as in the mail store's message_id; null if the mail has none
  fallback_key    text            -- sha1(date|from_email|size_bytes|subject) for mails without Message-ID
  entity_type     text not null   -- 'person' | 'company' | 'band' | 'venue' | 'event' | 'invoice' | 'contract'
  entity_id       integer not null
  source          text not null   -- 'address' | 'thread' | 'sent' | 'manual'
  dismissed       integer not null default 0   -- 1 = the user removed an automatic link; never re-add it
  created_at      text default now
  unique (mail_account_id, message_id, fallback_key, entity_type, entity_id)
  index (entity_type, entity_id), index (mail_account_id, message_id)
```

There is no FK to the entity (same pattern as `document`: owner type + id). Add delete triggers in a custom
migration so a deleted person, company and so on removes its links (see migration 0009 for documents). Note that
SQLite UNIQUE treats NULLs as distinct: enforce uniqueness with a unique index on
`(mail_account_id, coalesce(message_id, ''), coalesce(fallback_key, ''), entity_type, entity_id)`.

**Core side (recipe 4.1).** New Api methods:

- `listHeadersSince(cursor: number, limit: number)` → `{ id, messageId, fallbackKey, inReplyTo, references,
  fromEmail, toEmails, ccEmails, date }[]` ordered by row id. Addresses and ids only, no subjects or bodies.
- `findByMessageIds(ids: string[])` → list items for the history panel (C3).

Compute `fallbackKey` in the core. The subject goes into a hash only and never leaves the worker in clear text for
this purpose.

**Linker (main process, a new service `MailLinkService`).**

- Runs after each sync of an account (listen to the `sync-event` with type `folder-done` for INBOX/Sent, or a
  timer), in batches of 500, with a cursor per account kept in `app_setting` (key `mailLinkCursor:<accountId>`). If
  the mail store was rebuilt (cursor > max id, or the account's store id changed), restart from 0. The unique index
  makes re-linking harmless.
- **By address:** for every from/to/cc address, look it up (case-insensitive, trimmed) in `contact.email` and find
  the person, company, venue or hotel that owns that contact (`contact_id` FKs). Link with source `address`.
  Ignore the account's own address. Ignore addresses that match more than 20 records (shared mailboxes like
  info@…), and log the count only.
- **By thread:** if `inReplyTo` or a `references` entry is a Message-ID that already has links, copy those links
  with source `thread`. **Do not** use the store's `thread_id`, because for mails without references it falls back to
  the normalized subject and would join unrelated mails ("Rechnung").
- **Sent by bookingum:** C1/C4 write `source = 'sent'` links directly when a send succeeds.
- **Manual:** "Zuordnen…" in the mail reader and the right-click menu: pick a record (`SearchableSelect` across the
  types), creating a `manual` link. Removing an automatic link sets `dismissed = 1`.
- Bands: no direct contact. A band's mails are its explicit links plus the links of its events (C3 shows both).
  Linking via band members' addresses is **not** done automatically, because members also write about other
  things.

**Tests.** Unit tests for the repository and the linker with an in-memory app DB and fake headers: address match,
case and whitespace, the shared-mailbox cap, thread inheritance, a dismissed link not re-added, a cursor reset
after a rebuild, the NULL uniqueness.

**Traps.** Never store `message_key` or the store's row id in `mail_link`. Never log addresses. The linker must
not slow down the sync: it runs in main on IPC results, in small batches, yielding between them.

---

### C3: E-Mails tab on detail pages

**Prerequisites.** C2.

A tab "E-Mails" (kept in `?tab=` like the other tabs) on `PersonDetailPage.tsx`, `CompanyDetailPage.tsx`,
`VenueDetailPage.tsx`, `BandDetailPage.tsx` (its own links plus its events' links) and `EventHubPage.tsx`. It is a
panel component `MailHistoryPanel` (`components/mail/`), like the other panels: date, sender or recipient, subject,
attachment icon, and the link source shown small ("automatisch", "zugeordnet"). Newest first, with infinite
loading. A click opens the mail window (`MailWindowPage`). Each row has a menu: "Zuordnung entfernen". Mails whose
Message-ID is no longer in the store show "Nicht mehr im Postfach" (the link stays). Without a mail account, the
tab says how to set one up.

tRPC: `mailLink.listByEntity({ entityType, entityId, cursor })` → links; then `mailApi.findByMessageIds(...)`
for the rows.

E2E: seed a sandbox mail from an address that a test person has, sync, and check that the person's tab shows one
row (count only).

---

### C4: invoices, sent mails and replies

**Prerequisites.** C1, C2.

On the invoice detail page (`InvoiceDetailPage.tsx`) and in `InvoiceEmailCard.tsx`: list the invoice's mails (the
sent one from `invoice_email.message_id`, plus replies via thread links), with "Antwort erhalten" when a reply
exists. Mahnungen and Zahlungserinnerungen go the same way (`kind`). Do not change the invoice status
automatically. Show it only, and the user decides.

---

### C5: attachment → document

"Als Dokument speichern" on an attachment chip: choose the record (pre-selected from the mail's links) and the
document type, then main writes the file into the documents storage with the existing document service (the same
path rules and `document` row as an upload) and records the mail origin in a new nullable column
`document.source_message_id` + `document.source_mail_account_id` (app-DB migration). If D1 is done first, also
choose the category. Test: a repository unit test and one E2E.

---

### C6: mails in the global search

Add a "E-Mails" group to the search palette (`search-command-button.tsx`), using `mailApi.search` with a small
limit (5), debounced, only when a mail account exists. A click opens the mail window. It must not slow down the
palette: run it in parallel with the other groups and never block them.

---

### G1: the main process dies with "Cannot read properties of undefined (reading 'id')" [open, pre-existing]

**Symptom.** Opening the mail settings page kills the app: Electron shows "A JavaScript error occurred in the main
process", the window closes, and any in-flight test fails with "Target page, context or browser has been closed".

**This is NOT caused by A7 part 2.** Verified by checking out `fb0d689` (the commit before the canary work), rebuilding and
running the same probe: it crashes identically there.

**The full stack** (the dialog truncates it; capture it in main with
`process.on('uncaughtException', (e) => console.error(e.stack))`):

```
TypeError: Cannot read properties of undefined (reading 'id')
    at pe (.../electron-trpc/dist/main.cjs:1:9819)
    at IpcMainImpl.<anonymous> (.../electron-trpc/dist/main.cjs:1:10110)
    at IpcMainImpl.emit (node:events:514:28)
    at Session.<anonymous> (node:electron/js2c/browser_init:1:119322)
    at Session.emit (node:events:514:28)
```

**What the crashing code is** (`electron-trpc@0.7.1`, `dist/main.cjs`, de-minified by hand):

```js
const pe = (n, r) => {
  const e = r.method === "request" ? r.operation.id : r.id
  return `${n.sender.id}-${n.senderFrame.routingId}:${e}`
}
// registered as:
ipcMain.on(R, (a, C) => Ce({ ..., internalId: pe(a, C), event: a, message: C, ... }))
```

So `n` is the first argument of the `ipcMain` listener, and `n.sender` is `undefined`: the event that reached the
handler is **not** an `IpcMainEvent`. The frame above it is `Session.<anonymous>` calling `IpcMainImpl.emit` - an Electron
internal `Session` event is reaching the electron-trpc channel listener, i.e. something emits the electron-trpc channel name
through a `Session` object, which shares the `EventEmitter` prototype with `ipcMain`. `internalId` is then built from a
non-event and throws before the message is even looked at.

**Not yet identified:** which `Session` event carries the electron-trpc channel name. Candidate: a second window attached
through `ipcHandler.attachWindow()` in `createAppWindow` (the mail window path), because the crash only appears once the mail
pages are reachable - `mail.accounts.list` is the first call that reaches the worker.

**Why it is skipped here (user decision 2026-10-25).** It is pre-existing, unrelated to the canary work, and it costs a
build plus a ~30 s Playwright launch per probe. The user verifies the canary mailbox manually instead, so A9 phase 1 does not
depend on this. Fix it as its own card, with the stack above as the starting point - do not re-run the probe to rediscover it.

## H: review findings 2026-10-25 (user's manual pass on the real canary mailbox)

The user ran the app against the real IONOS test mailbox (`bookingium-test@example.test`, canary flag set) and wrote up what
they saw in `C:\Users\benni\Desktop\email-client-review` (5 screenshots, 3 issue files, 2 question files).

**A9 phase 1 is effectively DONE, by the user, manually.** They sent a mail to their own address through the real IONOS
server and it arrived. That is exactly what phase 1 asked for (synthetic mail, own address only, counts and outcomes) - it
just ran through the UI instead of the harness. The harness (`tests/e2e/mail-canary.spec.ts`) stays for repeatability once
G1 is fixed.

### H1: the sync time does not move while the mailbox is polled [bug, confirmed in code]

**Reported.** "Synchronisiert 15:10 · automatisch" at 15:20, while the poll runs every 2 minutes. The user reads it as
"the local mail is stale", which is the reason people press Senden/Empfangen in Outlook.

**Confirmed.** `lastSyncAt` is assigned in exactly one place, `syncAll()` (`sync.ts:1028`). The poll loop
(`startPolling`, ~`sync.ts:1185-1245`) checks STATUS per folder, syncs what changed and sweeps flags, but **never touches
`lastSyncAt`**. So the timestamp is the last FULL sync, not the last successful contact - it can be hours old while the
mailbox is demonstrably current.

**Fix.** Set `lastSyncAt` (and emit the status) at the end of each poll pass that reached the server, not only at the end of
`syncAll`. Keep a separate "last full sync" if it is useful internally. The label should mean "we last talked to the server
at HH:MM", because that is the question the user is asking.

**Test.** A poll pass with an unreachable-then-reachable server moves the timestamp; a failed poll does not.

### H2: is there a visible "working" indicator? [question, decision needed]

Outlook shows a status bar for "sending…", "fetching…". The user asks whether we want that.

**Current state.** The sync bar says "Synchronisiert HH:MM · automatisch" and the button shows a spinner while it syncs
(`MailPage.tsx:190-205`). Compose shows a spinner per action (`busy === 'send' | 'save'`). There is no global indicator, so a
background poll or a queued send is invisible.

**Recommendation.** A small, quiet indicator in the sync bar: a spinner plus "Sendet…" / "Empfängt…" while an op or a poll
runs, and nothing when idle. Not a full Outlook status bar - the app already has a toast for completed actions, and the mail
window has its own bar. Decide before building; it is cosmetic but touches both mail surfaces.

### H3: reply does not put the cursor above the quote [bug, regression of F13]

**Reported.** "If I hit reply, the two lines are not entered, the cursor is still at the start of the old/cited text."

**F13 was only half fixed.** `composeDraft.ts:99` builds `bodyText: \`\\n\\nAm ... schrieb ...:\n${quoted}\n\`` - the two
blank lines ARE in the text. What was never done is placing the **caret**: the editor is filled with the body and the caret ends
up wherever the browser puts it, which is the start. F13's test asserts the string, not the cursor, which is why it passed.

**Fix.** After the editor receives a reply body, set the selection to the start of the first block (or insert a
`<p><br></p>` placeholder paragraph above the quote and focus it). Needs a real DOM test (jsdom) or an e2e assertion on
`window.getSelection()`.

### H4: the bullet list button does nothing visible [bug, needs a DOM]

**Reported.** Bold, italic and underline work; the list button does not.

**Suspected cause.** The toolbar calls `document.execCommand('insertUnorderedList')` (`ComposeView.tsx:659`). The sanitizer
allows `UL/OL/LI` (`composeBody.ts:23-25`), so the tags survive the round trip - but `composeBody()` splits the body on
`</p>|</div>|</li>|</ul>|</ol>|<br>` and joins the non-empty blocks with `\n`, which flattens a list into plain lines in
`bodyText`. If the editor renders from `bodyText` after a save, the list is gone. Needs a DOM to prove which half is broken -
do not guess.

### H5: "Bilder laden" does nothing, and a sent mail looks different from its draft [two separate bugs]

**Corrected by the user 2026-10-25.** These were originally filed as one item about draft-vs-rendered styling. They are not
the same thing, and the first one is not about styling at all.

**H5a: "Bilder laden" changes nothing.** The button is offered, the user clicks it, and the mail still shows the grey
"blocked" boxes - before and after look identical.

**Confirmed in code, and this is the cause.** `loadRemoteImages()` returns early unless `options.remoteImages?.enabled` is set
(`core/index.ts:351`). **The worker never passes `remoteImages` at all** - `createMailCore({...})` in
`mailclient/worker.ts` passes `dataDir`, `accounts` and `log` and nothing else. So the flag is `undefined`, the call returns
the message unchanged, and the UI's `setWithImages(await ...)` receives the same blocked HTML. The button is a no-op, and the
"Wird geladen…" spinner is the only thing that ever happens.

**Fix.** Pass `remoteImages: { enabled: true, ...limits }` from the worker (the fetch options already exist in
`RemoteImageFetchOptions`: timeout, size cap, content-type allowlist). Then the placeholder substitution in `toDetail`
(`core/index.ts:1128-1134`) already does the right thing: it rewrites `src="https://…"` to the fetched `data:` URI before
sanitizing, and the CSP allows `data:`.

**Test.** A message with a remote image: `getMessage` reports `remoteImageCount > 0` and a placeholder; `loadRemoteImages`
returns different HTML containing `data:image/`. That test would have failed before this fix, which is the point.

**H5b: a mail sent to yourself does not look like the draft.** The draft is the app's editor; the received copy is rendered in
the sandboxed iframe. They differ in font and spacing, and the user is right that this is odd, because the whole point of the
bare-HTML decision was that the receiver's client applies its own defaults.

**Confirmed cause.** The sanitizer wraps the body in a CSP document whose `<style>` block is deliberately empty
(`sanitize.ts:210`, "mail content styles live in the app, not here") - so nothing sets a `font-family` or `font-size` at all.
The iframe therefore renders in the browser's default serif at the default size, while the editor is a `contentEditable` div
with the app's `font-sans text-sm`. The receiver's client does the same thing to us: it applies ITS default. So the difference
is expected in kind - but ours is the browser's *serif* default, which is not a sensible base for a mail.

**Fix.** Put a neutral base into that empty `<style>`: `body { font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5; }`
plus `margin: 0`. That is not styling the mail - it is choosing the fallback the receiver's client would also choose, instead of
inheriting the browser's serif. Keep it to those four properties; anything more starts overriding the mail's own CSS.

**Do not** try to make the draft and the rendered mail pixel-identical: they cannot be, and the receiver's client decides the
final look anyway. The goal is only that our fallback is sane.

### H6: the dead strip on the right was the reserved scrollbar gutter [fixed]

**Diagnosed by the user**, who recognised it: "this looks exactly like the space we reserve for the scrollbar so we have no
layout-shifts when it's added".

**Confirmed by measurement** (A/B in one Playwright run, same window):

| | body width | viewport | gutter on `html` |
|---|---|---|---|
| before | **869px** | 884px | `stable` |
| after | **884px** | 884px | `auto` |

A 15px dead strip, and `scrollableCount: 0` — **nothing on the page could scroll at all**. The user's DevTools readout
(`body 869 × 631`) matched to the pixel.

**Cause.** `index.css` had `html { scrollbar-gutter: stable }`, added in `170a6cf` ("html reserves the scrollbar gutter, so
pages don't shift sideways when the vertical scrollbar appears"). The intent was right, the element was wrong: this layout has a
**fixed frame** — `SidebarProvider` is `h-svh overflow-hidden` and only `[data-testid="content-scroll"]` scrolls. `<html>`
never scrolls, so its gutter was reserved for a scrollbar that could not appear, and it cost 15px on every page.

**Fix.** The rule moved onto the element that actually scrolls:
`className="... overflow-auto [scrollbar-gutter:stable]"` in `root-layout.tsx`. Same protection against the sideways shift when a
long list appears (which is what `170a6cf` was about), without the dead space. Verified after the change: the scroller reports
`scrollbar-gutter: stable` while `body` is the full viewport width.

**Lesson.** A global rule on `<html>` is wrong whenever the app has its own scroll containers - reserve where the scroll happens.

### H7: contacts - the server does not store them, and mail should not create them [decision settled]

**The question.** Does the mail server store contacts (so we could just pull them), do we need the Outlook CSV export, and
should a new sender become a contact automatically?

**Answers.**
1. **No, the server does not store contacts.** IMAP is mail only. Contacts live in the client (Outlook's local store) or in
   CardDAV/LDAP, which IONOS does not expose for this mailbox. So there is nothing to pull - the CSV export is the only source
   for the old contacts.
2. **Import the CSV once**, through the existing import dialog (`components/import/`), mapping onto `person` + `company`. That
   is a data import, not a mail feature, and it is where the user's corrected addresses come from.
3. **Never create a person automatically from a mail.** Every newsletter, receipt and notification sender would land in the
   person list, and there is no reliable way to tell a promoter from a newsletter.

**Decided with the user 2026-10-25: a "Als Kontakt speichern" action on a mail.** That is the right integration - one click,
explicit, and it only creates what the user asked for. It pre-fills from the sender (name and address), offers to link to an
existing person when the address already matches, and otherwise creates one. Same shape as C2's mail links, so the new person
shows up in the mail history and the palette.

**Open detail.** Where the action lives: the reader's action row next to "Antworten", or the sender's own popover (which already
exists - `MessageView.tsx` shows a popover per address). The popover is more precise (it names which address becomes the
contact) and needs no new space; the action row is more discoverable. Recommend the popover, with the action row added only if
the user asks for it.

### H8: the read-only / sandbox dropdown is removed at release [decision settled]

**Decided with the user 2026-10-25:** after the remaining tests are done, the dropdown goes entirely - the end user must not
see "Test-Server (lokal)" or a canary switch. The user's own words: "why would he even activate a 'readonly canary version'?"

So at release:
- the account dialog offers **one** kind: a real mailbox, read-only or writable is no longer a user choice;
- the canary flag and its danger toggle are **not shipped** - they exist for our own real-world tests and disappear with the
  test-server option;
- `MailAccountKind` collapses to what is actually left. Keep the union during the test phase (the code depends on it), and
  simplify it in the same change that removes the UI, so the guard's "outer gate" stays honest.

**Do not do this yet.** It is a release step, and doing it early would remove the only way to run the canary and the sandbox
tests through the UI. Recorded here so it is not forgotten.

### F16: right-click on a link in the mail body [right-click deferred; copy built 2026-10-26]

**Decided with the user 2026-10-26:** no right-click menu for now. A right-click menu on links ("Im Browser öffnen" /
"Link-Adresse kopieren") is the intuitive gesture, and other mail apps have it, but it is **not** built. The link list at
the bottom of the reading pane stays as the way to reach a link.

**What was built instead** (the user's idea, same day): the link list's "Öffnen" button got a **copy action beside it**, so a
link can be opened or its address copied - which covers the real use case behind the right-click wish (pasting into another browser
or an incognito window). The clipboard lives in the main process (`mail:copyLink` in `src/main/index.ts`, exposed as
`window.api.copyMailLink`), because the renderer has no clipboard access by design. The scheme allowlist (http/https/mailto) is
enforced there too: a mail must not be able to put a `file://` path or a `javascript:` URL on the clipboard, where it is one
paste away from running. The rule is in `src/main/mail/linkClipboard.ts` so it is testable without electron.

**Why it is not free.** The mail renders in an iframe with `sandbox="allow-popups allow-popups-to-escape-sandbox"` and
**no `allow-same-origin`** (`MessageView.tsx:465`). That is what stops a mail from running code or reaching the app, and
it also means the renderer cannot see a `contextmenu` event inside the iframe or read which link was hit. Electron can,
from the main process, via `webContents.on('context-menu')` and `params.linkURL` - so the feature is possible, but it
belongs in the main process, not in React.

**The cost to weigh.** A `context-menu` handler on the message view's `webContents` fires for the whole window, so it
either becomes a global native menu (replacing the default one everywhere, including cut/copy/paste in text fields) or
needs careful scoping to the message iframe. That is a behaviour change for right-click across the app, which is why it is
not a small UI addition.

**Images are deliberately out of scope** even if this is built: a remote image only exists as a `data:` URI after the user
loads it, so "copy URL" would copy a large base64 blob - no value, some confusion.

**Revisit when** a user asks for it, or when the link list proves hard to find. The cheap alternative is to make the bottom
list more prominent rather than add a native menu.

## D: documents

### D1: documents findable and visible [design settled 2026-10-25]

Today a document hangs off one record (`document.owner_type` + `owner_id`) with a fixed folder layout under
`storage/documents/<type>/<id>-<slug>/`. The owner is also the **lifetime**: `deleteDealMemo` and friends call
`removeOwnerFolder()`, which `rm -rf`s the folder, and an `AFTER DELETE` trigger drops the rows.

**What the user actually asked for.** Not a folder tree. "The user does not care where the file is actually stored, he
just wants that files (and emails) are easily found and simple to use." The surfaces that exist today already carry most
of it - `EventDocumentsList` on the band page lists every document of every event of that band, grouped by event. What
is missing is findability, not storage.

**Settled in the design discussion:**

1. **Storage stays flat.** No real subfolders, no file moves, no storage by id. One folder per owner, readable names,
   `Im Ordner anzeigen` for Explorer. Reasons: a file can only be in one directory (the rider belongs to the band *and*
   the gig), `findOwnerFolder()` matches `<id>-*` and is sticky by design (`document.test.ts:65` asserts it), and a real
   tree would make every rename a file-move migration.
2. **No `document_link` for now.** The ownership question turned out to be about *display*, not data: a gig can own a
   file and the band page can still show it. A join table is deferred until a case appears that foreign keys cannot
   express (a document genuinely belonging to two unrelated records, or one that must outlive its owner).
   Evidence-driven, not speculative.
3. **Categories reuse `document_type`.** The enum already is `deal_memo, contract, rider, stage_plot, press, photo,
   invoice, settlement, other` with German labels (`DOCUMENT_TYPE_LABELS`) and an inline select in `DocumentsPanel`.
   No new category table. User-defined categories, if ever wanted, become an `app_setting` list.
4. **Ownership stays a convention, not a constraint:** evergreen files (rider, tech spec, band contract) belong to the
   band; gig-specific files (the signed contract for *that* show, the settlement) belong to the event. It now only
   decides which page shows the file first, because archiving (D3) removes the lifetime risk.
5. **A Tour entity is not part of this.** `grep -i tour` finds only seed notes and contract prose; a tour (bus, crew, own
   contract) would be a business object with its own card and the 13-step recipe. Grouping by event date range covers the
   interim need.

**Scope of D1 (buildable now, no schema change):**

- **Inheritance both ways.** The band page already shows its events' documents (`EventDocumentsList`); the event page
  gets the read-only counterpart, "Dokumente der Band", so the band's rider is visible on the gig without a second upload.
- **Filter instead of appendix.** The band's document view gets a filter by category and by event, with "Alle" as the
  default. `EventDocumentsList` becomes a filter of that one list rather than a separate section.
- **Category filter** on the existing `document_type` enum.

**Not in scope:** documents in the search palette (D2), archiving (D3), `document_link`, a Tour entity.

**Tests.** Unit: the event-side inheritance query returns the band's documents, and a filter narrows by category and event.
E2E: a file uploaded on the event appears read-only on the band page, and the category filter narrows the list.

**Size.** M, one commit.

---

### D2: documents in the search palette

**Goal.** A document can be found by its file name from `Ctrl+K`, like every other business object.

**Why.** `SearchService` covers `deal_memo, band, company, person, venue, hotel, invoice, address` and **zero document
queries** (verified 2026-10-25: no `document` reference in the service or its router). A file can only be found by
remembering which record it hangs off - the exact opposite of "easily found".

**Design.**

- Add a document query to `SearchService.search`: `like(document.file_name, pattern)`, returning id, file_name,
  document_type, owner_type, owner_id plus the owner's label (reuse `DocumentRepository.ownerLabel`).
- A new palette group "Dokumente" with the file name, the category label and the owner ("Rider · Pretty Wild"), the
  owner as the navigation target, and "Im Ordner anzeigen" as the secondary action.
- Respect D3: an archived event's documents are not offered in the palette.

**Traps.** `file_name` is user-supplied text, so it goes through the same LIKE escaping as the other queries. The result
carries no absolute path - the renderer only gets `filePath` as it already does today.

**Tests.** Unit: a search by file name finds the document and names its owner; a name with `%` or `_` does not widen the
match. E2E: type a file name into the palette, the group "Dokumente" appears, the entry opens the file.

**Size.** S.

---

### D3: events are archived, not deleted

**Goal.** An event (deal memo) can be taken out of the working view without destroying anything, and can come back.

**Why.** `deleteDealMemo` is a hard `DELETE`, and the schema cascades from there: `itinerary` and `follow_up`
(`onDelete: 'cascade'`), the `document` rows plus `removeOwnerFolder()`'s `rm -rf`, the `mail_link` rows, and
`invoice.deal_memo_id` is set to **null** - the invoice survives but loses the link to its gig. For a German booking
agency that is an audit trail disappearing on one click (invoices carry a 10-year retention, and GoBD expects the record
to stay reconstructible). Decided with the user 2026-10-25: archive. `cancelled` stays the separate status it already is
(cancelled = the gig fell through but was real and still needs its paperwork; archived = no longer relevant, hide it).

**Design.**

- Migration: `deal_memo.archived_at TEXT` (null = active). Not a boolean, so "when" is answerable.
- **One filter, in the repository.** `DealMemoRepository.list`/`getById` exclude archived rows by default, with an explicit
  `includeArchived` for the archive view. Do **not** scatter the condition through services.
- Cover every read path, each of which would otherwise show an archived event silently: `DealMemoRepository`,
  `DashboardService` (next 7 days), `CalendarFeedService` (the ICS feed - the one users notice most), `SearchService`,
  `ContactListRepository`, `ContractRepository`, `FollowUpRepository`, `InvoiceRepository`,
  `DocumentRepository.listEventDocumentsForBand`.
- UI: the event's action becomes "Archivieren" instead of "Löschen"; an "Archiv" view lists archived events with
  "Wiederherstellen".
- **A hard delete stays, but guarded:** refuse while an invoice links the event ("Zu diesem Event existiert eine
  Rechnung. Archivieren statt löschen."). This protects the audit trail without making deletion impossible forever.

**Tests.** The claim is "an archived event appears in none of these places", so test it that way - one suite that archives
an event and then asserts its absence from each read path (list, dashboard, ICS feed, search, contact list, contracts,
follow-ups, invoices, the band's document list), rather than one test per call site. Plus: restore brings it back
everywhere; the guarded hard delete refuses with a linked invoice and succeeds without one.

**Traps.** A missed read path is silent - nothing errors, an archived gig just shows up somewhere. This is why the filter
belongs in the repository and why the test enumerates the surfaces. `status: 'cancelled'` must keep working as it does
today (the dashboard already excludes it) and is **not** the same thing as archived.

**Size.** M (migration + repository filter + ~9 read paths + UI + archive view + tests).

---

## E: repository hygiene

### E1: seeding without PII

**Goal.** No tracked file contains real personal data, and seeding still works for local development.

**Files.** `src/main/db/seed.ts` (imported by `src/main/index.ts`), `scripts/seed-mail-sandbox.mjs`, `sample_data/`
(gitignored except `internal-seed.example.json`).

**Steps.**

1. Read `seed.ts` **without printing its data** (look at its structure: which tables it fills, where the values
   come from). Report the structure only.
2. Move every literal record that looks like real data into the gitignored `sample_data/internal-seed.json`, which
   the seed reads when it exists. Keep a small, clearly synthetic set in the code or in
   `sample_data/internal-seed.example.json` (names like "Beispiel GmbH", addresses `@example.test`).
3. `scripts/seed-mail-sandbox.mjs`: generated synthetic mail only.
4. If you find real data in the git **history**, do not rewrite history. Report the commit count and file names
   (not the data) to the user: a rewrite and force push is their decision.

**Acceptance.** A fresh dev start with no `sample_data/internal-seed.json` seeds the synthetic set; with the file,
the full local set. `git grep` finds no real-looking addresses (E2 automates this).

### E2: PII check for tracked files

A vitest (`tests/no_pii.test.ts`) that reads the tracked seed, fixture and test files (`git ls-files` on
`src/main/db/seed.ts`, `tests/**`, `scripts/**`, `sample_data/*.example.json`) and fails when it finds an email
address whose domain is not `example.test`, `example.com`, `example.org` or `localhost`, or an IBAN pattern other
than the official test IBANs. It prints only file:line and the rule, never the match itself. Allowlist known
non-personal addresses (for example `noreply@anthropic.com` in docs, if docs are included) explicitly in the test.

---

### F15: a pasted attachment leaves the app dead for the next reload

**Fixed.** The renderer's `beforeunload` handler saved the draft and then called
`window.close()`. `beforeunload` fires for a **reload** as well, so reloading with a dirty
editor saved the draft and destroyed the window. The autosave (F5) made it look fixed,
because a paused editor is not dirty - pasting an attachment and reloading straight away
was the case that still hit it.

Main now decides: `window.on('close')` sets a flag (a reload never fires it), and
`will-prevent-unload` destroys the window only when that flag is set. The renderer saves
and never closes the window itself.

**Why it hid for so long.** Two wrong fixes looked right: handling `will-prevent-unload`
alone (it cannot tell a reload from a close), and relying on the autosave having run (it
has not, if the user reloads right after typing). The probe that settled it pasted a file
and reloaded **inside one test**, capturing the renderer console - there was no error at
all, which proved the window was being *closed*, not crashing.

---

## I: cards from the review (`docs/mail-client-review.md`, section 9)

### I1: send state machine [fixed 2026-10-26]

MR-01, 02, 03 (core part), 05, 15, 16, 43. A send carries its phase in the journal payload:
none (nothing left the machine), `smtp` (the server may have it: probe, never resend), `sent`
(the server took it: only filing into Sent is left).

- `execute` wraps the op: a throw is `failed` before SMTP and `unknown` after it; replay catches
  per op and also picks up `unknown` sends, which it probes only.
- `smtpRefused` decides "nothing went out" from nodemailer's codes. A reset after DATA is
  labelled `CONN` too, so only `originalCode` connect errors, `EAUTH`, `EENVELOPE`, `EDNS` and
  an `EMESSAGE` with a response code count as refused.
- The watchdog answers `unknown` in the SMTP phase and keeps the mutex until the body settles;
  `close()` drains the op in flight (8 s).
- `retryOp` refuses an unclear send; `resolveOp` probes it.
- `saveDraft` journals its Message-ID, and the draft probe runs on a re-attempt only.
- Tests: `tests/mail_send_state.test.ts` (fake SMTP that drops or rejects after DATA).

### I2: compose send guard [fixed 2026-10-26]

MR-03 (editor part), 04, 38 (autosave part). `ComposeView.tsx` with the decisions in
`components/mail/composeSend.ts`.

- One send at a time: a gate taken before the first await; Ctrl+Enter ignores key repeat.
- No implicit submit: the send button is `type="button"`, the form's submit does nothing, and a
  recipient field never lets an Enter through.
- A stable `sendKey` per compose session becomes the Message-ID (`<key>@<domain>`), so a check
  finds this mail in the journal and in Sent.
- "Versand unklar" locks the editor with "Im Ordner Gesendet prüfen" (probes via `resolveOp`,
  never sends), "Als neue Mail senden" (confirms, new key) and "Schließen".
- No draft save while sending or unclear.
- Open: hashing attachments for the dirty check (rest of MR-38); the op panel came with I3.
- Tests: `tests/mail_compose_send.test.ts`; e2e "Enter does not send, and a double Ctrl+Enter
  sends once" in `tests/e2e/mail-client.spec.ts` (fails on the old editor).

### I3: op-journal panel [fixed 2026-10-26]

MR-03 (panel part), 29. A badge in the mail header ("N offene Änderungen", red when something
needs a decision) opens a sheet with the ops that need the user. Decisions are in
`components/mail/opJournal.ts`, the view is `OpJournalPanel.tsx`.

- Listed: an unclear send ("Versand unklar"), a conflict or failed op ("Abgelehnt"), a failed op
  that waits for its retry, and a pending or running op older than 2 minutes ("Hängt").
- Actions mirror the core: an unclear send gets "Im Ordner Gesendet prüfen" (`resolveOp`), never a
  retry; a send is retried only when filing into Sent is left; a running op gets no action.
  "Verwerfen" asks first.
- Core: `listOpenOps`; `cancelOp` also takes conflict, failed and unknown ops, refuses one the
  write engine holds, and resyncs the op's folders.
- MR-29: `core/op_retry.ts` decides what the core may retry by itself (flag, move, move_batch,
  delete, expunge, draft_delete; a send in phase `sent`; never after a refused login). The retry
  runs only while the sync reports the account online, after 1 minute, doubling to 15;
  `close()` clears the timers.
- Tests: `tests/mail_op_journal.test.ts`; e2e "a rejected change shows in the op panel and is
  discarded there" (puts a settled conflict on a UID the inbox does not have into the journal).

---


### I9: gate green [fixed 2026-10-26]

MR-17 and the tests/CI section. The gate was red and several tests proved less than they claimed.

**What changed.**
- `tests/mail_write_guard.test.ts`: the two-account case logs its clients out before a fake server
  closes, so no socket is reset under a live client. `pnpm test` exits 0 twice in a row, and reverting
  the fix brings the unhandled ECONNRESET straight back - it is not swallowed.
- `tests/helpers/fakeImap.ts`: answers `BAD` for anything it does not implement and advertises only
  `IMAP4rev1 AUTH=PLAIN`. It used to claim `UIDPLUS` and `MOVE` and answer `OK` to both, so a move test
  would have passed against a server that moved nothing. Measured on the way: imapflow's `messageMove()`
  RESOLVES even when the server answers `BAD`, so the test asserts on the raw protocol instead.
- `tests/helpers/fakeSmtp.ts`: implements `AUTH LOGIN` (the 334 challenge/response) and refuses it with
  wrong credentials. It advertised LOGIN and answered `250 Ok`, so a client could "authenticate" without the
  server ever seeing its credentials. Dot-unstuffing added.
- `tests/mail_crash_points.test.ts`: requires EXACTLY one delivery (0 used to pass), fails when Mailpit is
  unreachable instead of returning a pass, checks that the source copy is gone after a move, removes the mail
  it moves, counts deliveries by Message-ID (a subject prefix collides with earlier runs), and its header no
  longer claims a process kill it never did.
- `tests/helpers/sandboxGate.ts`: a skipped sandbox suite is annotated on GitHub
  (`::warning::`), so a green CI run says what it could not prove.
- `.github/workflows/ci.yml`: a Windows job beside Ubuntu, and an explicit better-sqlite3 ABI step that
  names the Electron/Node mismatch instead of failing inside the first DB suite.
- `tests/e2e/mail-client.spec.ts`: the data-dependent `test.skip` (no attachment, no band) now fails with
  a reason, and the fixed sleeps the card touches became condition waits.
- `tests/mail_sync_time.test.ts`: marked pending on I4 in a header note (resolved in I4), because finding L3 is only NAMED in
  the review (line 604) and its required behaviour is written nowhere; inventing it here would guess at
  `core/sync.ts`, which is I4's file.

**Tests.** `tests/mail_write_guard.test.ts` (+3), `tests/fake_smtp.test.ts` (new, 3), `tests/sandbox_gate.test.ts`
(+2), `tests/mail_crash_points.test.ts` (strengthened). Every new assertion has a recorded mutation check;
the report lists them.

**Not verified here:** the CI jobs themselves (nothing is pushed), and the mail e2e needs the sandbox.

### I10: small renderer fixes [fixed 2026-10-26]

MR-13, 35, 36, 37 and the open renderer Low items. Every renderer decision that could be lifted out of a
`.tsx` was moved into a pure module, so vitest holds it instead of a comment.

**What changed.**
- **MR-13** `src/main/mailclient/accounts.ts`: `toDto` now carries `signature`, and a save that OMITS it keeps the
  stored one (an explicit empty string still clears it). The renderer had always received `undefined`, so no new mail
  carried a signature and opening the account form wiped it.
- **MR-35** new `components/mail/readingActions.ts`: only a writable account may offer reply/forward/write-to. Both
  pages derive from it; before, `onWriteTo` and `onCompose` were passed unconditionally, so the production account
  opened an editor whose autosave failed silently and lost the text.
- **MR-36** new `components/mail/archiveActions.ts`: `archiveableIds` (not already in Archive, not in Trash),
  `uncoveredIds` (show again every hidden mail no DONE op covers, matched by UID) and `archivedCount` (the toast says
  what the core archived, not the selection). Archiving inside Archive used to hide the mail until a restart.
- **MR-37** `shortcuts.ts`: `shortcutBlocked()` keeps the global keys out of dialogs, alert dialogs, menus, popovers,
  the compose form and the list while an editor is open. Entf on a confirm dialog used to move the selected mail.
- **Low:** `hiddenIds` is cleared on an account switch, `addFiles` marks the mail edited (the attachment was lost when
  the window closed), and the reader's reply/reply-all/forward icon buttons have an `aria-label`.

**Tests.** `tests/mail_account_signature.test.ts` (3), `tests/mail_readonly_actions.test.ts` (4),
`tests/mail_archive_actions.test.ts` (12), `tests/mail_shortcuts_guard.test.ts` (8), `tests/mail_renderer_low.test.ts`
(3). Every one has a recorded mutation check; the report lists them.

**Still open from the Low list** (each needs its own card, none is a regression): reopening a draft keeps its HTML,
`MailWindowPage` shows an error instead of spinning when `getDraft` fails, the preset PDF counts against
`MAX_ATTACHMENT_BYTES`, unused `search.pdfName`, events of other accounts dropped and sync events not invalidating
`search`, signature applied once, and the keyboard effect subscribing once.

### I4: mailbox selection [fixed 2026-10-26]

MR-09, 10, 24, 25, 31 and L3. Every read of a folder outside its own sync went to whatever mailbox the sync
connection had selected last, and a full disk stopped only the current full sync.

**What changed.**
- `core/sync.ts`: `withSelected(path, expectedValidity, fn)` takes the folder mutex, EXAMINEs the folder and
  checks UIDVALIDITY; `flagSweep` runs through it (MR-09). `uid_next` is the server's UIDNEXT on every sync path
  (MR-24). A full disk stops poll, IDLE, `syncFolder` and `syncAll` (MR-25), and a poll in which no folder
  answered calls `noteError`, not `noteServerContact` (L3). The folder list and `syncFolder` skip paths under a
  journalled `folder_rename` (MR-31).
- `core/index.ts`: the repair fetches per folder through `withSelected`, covers every account and stops at a
  full disk; `whenIdleForMaintenance` returns `false` on timeout (MR-10). `worker.ts` skips the round then.
- `core/store.ts`: `rekeyFolder` merges into an existing target row (MR-31).
- `core/write_engine.ts`: a folder rename locks both subtrees, one mutex per folder (MR-31).
- `tests/mail_sync_time.test.ts`: the I9 "pending on I4" note is resolved; the L3 case is tested.

**Tests.** `tests/mail_mailbox_selection.test.ts` (new, 13) on the new `tests/helpers/scriptedImap.ts`,
`tests/mail_sync_time.test.ts` (+1). 21 mutation checks, all killed; the report lists them.

**Known limit:** a rename stuck in `pending` pauses the sync of its subtree until the op is resolved in the op
panel.

### I5: HTML safety [fixed 2026-10-26]

MR-07 and MR-08. A style block could carry live markup past the sanitizer, and the compose editor parsed any
text that looked like HTML as HTML.

**What changed.**
- `core/sanitize.ts`: `liftStyleBlocks` reads the `<style>` elements with the HTML parser, so a block ends
  where a browser ends it (`</style >`, `</STYLE	>`). `cssWithoutMarkup` drops Outlook's comment markers and
  escapes any other `<` as `c `, so the pasted-back CSS cannot close its element (MR-07).
- `components/mail/composeBody.ts`: `toEditorHtml(text, html?)` always escapes the text; a stored HTML body
  goes through the compose allowlist without the mail wrapper. `ComposeView.tsx` passes the two separately
  (MR-08).

**Tests.** `tests/mail_sanitize.test.ts` (+8), `tests/mail_compose_body.test.ts` (+6, 1 changed). 6 mutation
checks, all killed; the report lists them.

### I7: invoice send [fixed 2026-10-26]

MR-11, MR-12, MR-14, MR-21 and README host H3. The invoice mail garbled umlauts, went out from whichever
sandbox account came first, could go without its PDF, let the renderer register any file for reading, and an
unclear send never marked the invoice.

**What changed.**
- `components/mail/composeRequest.ts`: the window's query is parsed in one place; the draft is decoded as
  UTF-8 (MR-11). The window learns a token and the attachment's name, never a path (MR-21).
- `main/mail/invoiceSend.ts`: `invoiceSendAccount` checks the chosen account fail-closed (MR-12); the compose
  registry issues the tokens; `sendInvoiceMail` reads and attaches the PDF in main (MR-14), records the send
  as pending, and confirms it; `confirmInvoiceSendFromOp` confirms a send the core settles later (H3).
- `invoice_email_pending` (migration 0016) holds a send until it is confirmed; `confirmPendingEmail` deletes
  the row and logs the email in one transaction, so a send is counted once.
- Settings › E-Mail: "Senden von" (`invoiceMailAccountId`). `mail.sendInvoice` replaces the preload calls
  `composeInOwnEditor`, `reportComposeSent` and `readComposePdf`.

**Tests.** `tests/invoice_send.test.ts` (new, 25), `tests/mail_compose_request.test.ts` (new, 7), the C1 e2e
(account choice, attachment chip, umlaut in the body). 11 mutation checks, all killed; the report lists them.

### I8: folder delete [fixed 2026-10-26]

MR-06. IMAP DELETE takes a folder's mail with it, past Trash. `deleteFolder` checked only the local count, and
the undo of a `folder_create` checked nothing: create a folder, move mail into it, undo, and the mail was gone.

**What changed.**
- `core/write_engine.ts`: `doFolderDelete` refuses (conflict, `FOLDER_DELETE_REFUSED`) when LIST shows a
  subfolder or `STATUS (MESSAGES)` is not 0; a failed STATUS is a retry, not an empty folder.
- `core/index.ts`: `refuseFolderDelete` (local mail, local subfolders, pending ops) runs for `deleteFolder` and
  for the undo of a `folder_create`; `throwIfServerRefusedDelete` turns the server's refusal into a
  `FolderNameError`, which the renderer already shows as a toast. The folder is resynced.

**Tests.** `tests/mail_folder_delete.test.ts` (new, 11): the op against a stubbed client, and the core with a
stubbed engine. 8 mutation checks, all killed; the report lists them.

### I11: host hardening [fixed 2026-10-26]

MR-22, MR-23, MR-33, MR-34 and design note 5. "Bilder laden" fetched whatever a stranger's mail named, with no
body timeout, no size cap and no LAN filter; "Öffnen" trusted the renderer's file name and an incomplete list of
executables; the connection test sent the stored password to whatever host the form named; `invoice:email`
joined a renderer name into a path; and preload exposed generic IPC as `window.electron`.

**What changed.**
- `core/remote_images.ts`: `http`/`https` with a DNS lookup that refuses a name when any answer is private,
  literal IPs checked per hop, manual redirects (5, http(s) only), a declared and a streaming byte cap, and a
  timer that covers the body. `core/index.ts`: `loadRemoteImages` fetches only URLs the stored manifest lists.
- `attachments.ts` and `mail.router.ts`: an allowlist of types for "Öffnen"; anything else gets a native
  dialog that offers to save only. The name comes from the stored metadata, bidi characters are stripped, and
  the temp file is marked with `Zone.Identifier` (ZoneId=3) before it opens (fail-closed). `openAnyway` is gone.
- `accounts.ts`: the stored password is used only for the same host, port and user, for the test and on save.
- `mail/openEmail.ts`: every path goes through `safePathIn`.
- `preload`: `window.electron` removed.

**Tests.** `tests/mail_remote_images_guard.test.ts` (new, 10), `tests/mail_host_hardening.test.ts` (new, 3),
`tests/mail_attachments.test.ts` (13), a wiring test, and the e2e attachment test. 19 mutation checks, 18
killed, one equivalent; the report lists them.

### I12: store robustness [fixed 2026-10-27]

MR-26, MR-41 and MR-42. A damaged data page opened fine and broke every later query; one bad store stopped
every account; a rebuild downloaded the whole mailbox again; an empty `UID FETCH` deleted a folder; an
interrupted UIDVALIDITY swap started over; and a failed contacts upsert deleted a stored mail's file.

**What changed.**
- `core/store_recovery.ts` and `core/store.ts`: statements are watched for corruption, which writes a `.check`
  marker; the next open, or one after an unclean shutdown, runs `quick_check`. Extended codes and `cause` count.
- `core/index.ts`: each account opens in its own try/catch; corruption found by the contacts backfill
  reopens that account once.
- `core/migrations.ts` (v3 `relinks`), `store.ts` and `sync.ts`: a rebuild salvages the file map, and the sync
  adopts surviving `.eml` files of matching size instead of downloading them; the orphan sweep keeps them
  until the TTL.
- `core/sync.ts`: a mass expunge needs EXAMINE's EXISTS; the swap's staging survives failures, resumes, and
  is hidden from every cross-folder view; staged rows no longer land in the real folder; the contacts upsert
  is non-fatal.

**Tests.** `tests/mail_store_integrity.test.ts` (new, 23); `tests/mail_store_recovery.test.ts` unchanged. 25
mutation checks, all killed. The e2e and the sandbox-backed suites were not run (Docker down).

### I15a: connections and errors [fixed 2026-10-27]

MR-19, MR-30, MR-32, MR-39, MR-40 and [sync L2]. Production could hold three connections where the rule
allows two; a write connection that died during sleep stopped the queue; a reset socket made an op a
terminal conflict; a crashed move could be resumed onto a copy that was already there; the IDLE wait left
timers running; and every core event was delivered twice.

**What changed.**
- `core/connection_budget.ts` (new), `core/index.ts`, `core/sync.ts` and `core/write_engine.ts`: one
  connection budget per account for sync, IDLE and writes. A write is urgent; IDLE yields its slot and
  catches up when it comes back.
- `core/write_connection.ts`: NOOP before reuse (10 s), closed after 30 s idle, closed without LOGOUT when
  the watchdog gives up. `core/write_guard.ts`: `IMAP_TIMEOUTS` and an `error` listener.
- `core/write_engine.ts`: `folderMissing` separates the server's NO from connection failures; the target's
  UIDNEXT is journaled before a move, and a resume needs every source UID gone and exactly one new UID per
  member.
- `core/sync.ts`: `idleWait` clears both timers. `core/index.ts` and `worker.ts`: events by name, once.

**Tests.** `tests/mail_connections.test.ts` (new, 28); `tests/mail_batch_move.test.ts` (+7); stubs updated in
`mail_uidplus` and `mail_write_connection_reuse`. 31 mutation checks, all killed. The e2e and the sandbox-backed suites
were not run (Docker down).

### I6: canary in main [fixed 2026-10-27]

MR-18, MR-20 and the first decision of review section 6, which the user signed off on 2026-10-27: the
canary stays a flag with a danger toggle in the account dialog, and main enforces it. Main used to accept
whatever the renderer sent, a changed server kept the flag, SMTP security was never checked, the allowlist
held two DNS names, and the core journaled writes for a sandbox kind on a real host.

**What changed.**
- `core/write_guard.ts`: `smtpRefusal` and `settingsRefusal` (new); `writeRefusal` also refuses a cleartext
  SMTP login; the allowlist is loopback only.
- `core/index.ts`: an account the guard refuses gets the production config (read-only); `writableEntry`
  asks `assertWriteAllowed`; `accountMode` reads the flag from the write account, so a canary reports
  `canary`.
- `accounts.ts`: the save is checked in main. The flag ends when the mailbox it names changes (host, port,
  user, address, SMTP host or port) or is unchecked, and the account is then saved read-only. A packaged
  build admits a canary only with `BOOKINGIUM_ALLOW_CANARY=1`; `MailClientService.ts` applies the same to a
  stored canary. `checkMailAccountSettings` checks the SMTP side.
- `mail.router.ts`: `checkMailAccountSave` runs before the connection test.
- `MailAccountsCard.tsx`: the SMTP encryption choices follow the SMTP host; a toast says when main ended
  the admission.
- `tests/e2e-canary/mail-canary.spec.ts` (moved) and `playwright.canary.config.ts` (new): opt-in with
  `BOOKINGIUM_CANARY=1`, the account found by its flag, a wrong setup fails.

**Tests.** `tests/mail_canary_save.test.ts` (new, 22) and `tests/mail_canary_main.test.ts` (new, 13);
allowlist expectations in `mail_canary` and `mail_write_guard`; fixtures in six suites used the kind
`imap`, which the core now runs read-only, and one used a sandbox kind on a real host. 16 mutation checks,
all killed. The canary spec, the e2e and the sandbox-backed suites were not run (rule, and Docker down).

## Found while working

### "A sent mail can be delivered twice" (found during I10) - not a send bug, fixed in the test

**Status: closed in the I9-I16 review (2026-10-26).** The I10 report read "expected 1, received 2" in
"a mail written in the editor is saved as a draft and sent" as two deliveries. It was the Drafts count, not a delivery:
the sandbox server keeps one leftover draft, and run alone the test read `draftsBefore` from a store that had not synced
Drafts yet (0), then saw the leftover plus the new draft (2). Reproduced 3/3 before, 3/3 green after.

The fix is in the test: each baseline now reads the server's own STATUS count (`serverTotal`) and waits until the app's
store shows the same number before it is taken. The Ctrl+Enter-twice guard still asserts one delivery and holds it for
3 s (`holds`, not `expect.poll`, so a late second delivery would fail it). Nothing in the send path changed.


(Agents: add one line per finding: date, card, file:line, one sentence. No mail content.)

- 2026-10-26, review, `docs/mail-client-review.md`: a full review of the branch at `811f04a` found 43 issues (MR-01 to MR-43; 3 critical send-path bugs that can deliver a mail twice) and proposes card group I (I1 to I14). No real-mailbox writes beyond the canary until I1 to I4 land.

---

## F: hardening and usability

### F1: test the security boundaries worst-first

**Goal.** Every *rule* of the security-critical modules has a test that fails when the rule breaks. Not a
coverage number: coverage rewards testing getters. Worst-first, because a silent failure in a security boundary is
worse than a crash.

**Order (worst first, by what a failure would cost).**

1. `sanitize.ts` - **done**, 25 tests, found two real bugs (blocked links lost their URL, `<style>` blocks
   dropped entirely). See the commit for both.
2. `remote_images.ts` - the opt-in load path. A bug here leaks the reader's IP to a tracking server the moment a
   mail is opened.
3. `write_guard.ts` - **done** as part of A7 part 1 (7 tests: per-account decision, allowlist, TLS).
4. `compose.ts` - what a sent mail actually contains: header injection, a missing `References` chain, a
   `Bcc` that leaks into the visible headers.
5. `files.ts` - path handling: a crafted file name or `file_path` escaping the account folder.
6. `imap_options.ts` - the plain-login rule (which hosts may authenticate unencrypted).
7. `store.ts` search - the FTS5 query builder: what a user's search text can do to the query.

**Rules.** One test per documented rule, named after the rule, not the function. A test that cannot fail is
not a test: check that a new test fails when the rule is removed before committing it. Never assert on a
snapshot of generated HTML; assert on what the rule guarantees.

**Traps.** `sanitize.ts` needs jsdom, so it is a node-environment test with a real parse. `compose.ts` must be
asserted on the raw MIME bytes, not on a parsed object. Never weaken a test to make a refactor pass.

---

### F2: write to an address from a mail header

**Goal.** In an open mail, an address in the header is clickable and starts a **new** mail to that person:
"Von", "An" and "Cc" each. It is the case Reply does not cover: someone who was only in Cc, or
writing to the sender about something else entirely instead of answering this mail.

**Why it is not Reply.** Reply (and Reply all) answers *this* mail: it quotes the body, carries
`In-Reply-To`/`References` and lands in the same thread. This starts a fresh mail: no quote, no
threading headers, a new subject. The two must not be confused, because a mail that silently becomes a
reply in the recipient's client is worse than no shortcut at all.

**Files.** `components/mail/MessageView.tsx` (the `Von`/`An`/`Cc` values, today plain text via
`formatAddresses`), `components/mail/composeDraft.ts` (a pure `composeTo(address)` next to
`replyCompose`/`forwardCompose`), `ComposeView.tsx` (already takes a `ComposeState`).

**Steps.**

1. A pure `composeTo(address)` in `composeDraft.ts`: `emptyCompose()` with that one recipient, the
   signature (B8) above the empty body, and **no** `inReplyTo`, **no** `references`, **no** quote.
2. Each address in the header becomes a button that opens the editor with that state. "Von" and "An" are single
   addresses; "Cc" is a list, so each of them is its own button.
3. The header shows which one was clicked (the address is the only thing carried over). The subject stays empty
   rather than reusing the old one: a new mail is not about the old subject.
4. "Bcc" is not in the header today, so there is nothing to click there - that is not a gap, it is invisible by
   design.

**Tests.** A pure test for `composeTo`: one recipient, the signature, and explicitly no threading headers and no
quoted body. One E2E: open a mail that has a Cc, click that Cc address, and check the editor opens with exactly that
recipient, an empty subject and an empty body.

**Traps.** Never set `inReplyTo`/`references` - that would make it a reply that shows up in the old thread. Never
carry the old attachments along: this is a new mail, not a forward. Never prefill the old subject. The recipient list is
the only thing that travels over.

---

### F3: lightweight formatting in compose

**Goal.** Bold, italic, underline and a bulleted list in the compose editor, stored as `text/html` in the draft and
sent as `multipart/alternative`. Plain text stays the source of truth for search and snippets.

**Files.** `ComposeView.tsx` (a contenteditable body), `composeDraft.ts` (`ComposeState` gains `bodyHtml`),
`core/compose.ts` (already emits `multipart/alternative` when `bodyHtml` is set), `core/sanitize.ts` (the
sent HTML goes through the same sanitizer on the way out).

**Steps.** 1. `ComposeState.bodyHtml` next to `bodyText`; `toDraftInput` passes both. 2. A contenteditable
with four commands (`document.execCommand` is deprecated; use `Selection`/`Range` or a tiny sanitized HTML model).
3. Plain text is derived from the HTML for the text part, so a recipient without HTML still reads it.

**Traps.** Never trust the composed HTML: it leaves through the same sanitizer as incoming mail. Never lose the plain
text part - it is what search and snippets use.

---

### F4: paste attachments from the clipboard

**Goal.** Ctrl+V in the editor attaches a copied file, and a pasted image becomes an attachment rather than a
`data:` URI in the body.

**Files.** `ComposeView.tsx` (the paste handler), `core/compose.ts` (already carries `attachments`),
`mailclient/attachments.ts` (`safeAttachmentName`, `base64Bytes`, the size cap from B7).

**Steps.** 1. A paste handler reads `ClipboardEvent.clipboardData.files`; with no file it falls through to the
default text paste. 2. Each file goes through `attachmentsFit`/`base64Bytes` (B7) and appears as a chip. 3. An image
pasted from a screenshot is an attachment, never an inline `data:` URI in the body.

**Traps.** The renderer must never get a filesystem path it can write to: the bytes come through the clipboard, and the
name through `safeAttachmentName`. A pasted image must not become part of the HTML body - the sanitizer would keep a
`data:` URI and the mail would grow without a visible attachment.

---

### F5: reloading with an open, changed draft destroys the window

**Found by.** F4's E2E, which pasted an image into the editor and left it open: the
*next* test's `page.reload()` failed with "Target page, context or browser has been
closed". Reproducible with any dirty editor, so it is not about pasting.

**What happens.** `ComposeView`'s `beforeunload` handler calls `preventDefault()`, then
saves the draft and calls `window.close()`. A reload fires `beforeunload` too, so
reloading the app with an open, changed draft **saves the draft and then closes the
window** instead of reloading it. Nothing in the main process handles
`will-prevent-unload`, so nothing distinguishes "the user closed this window" from
"the page is reloading".

**Why it matters.** Reload is a normal thing to do (after an update, or when a dev
reloads), and it silently closes the user's compose window. In the E2E suite it kills the
*next* test's page.

**Fix direction.** Let the main process decide: handle `will-prevent-unload` on the mail
window, save through the existing draft queue and `event.preventDefault()` only when the
window is really being closed (`BrowserWindow.isDestroyed()` is false and the window is
not reloading), never call `window.close()` from `beforeunload` itself. Then F4's E2E can
come back.

**Traps.** Do not drop the draft save: losing an unsaved mail is worse than the window
closing. Do not call `window.close()` from the renderer's unload path - that is the bug.
