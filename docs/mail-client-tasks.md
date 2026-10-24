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
| A7 | Per-account write path | L | A1–A6 | open, design **[user]** for the canary part |
| A8 | Port the prototype suites to vitest | L | A1–A3 | open |
| A9 | Canary | M | A7, A8, P1 | **[user]** |
| B1 | Folder create / rename / delete | L | A3, A2 | open |
| B2 | Move folders by drag and drop | M | B1 | open |
| B3 | Keyboard shortcuts | S | — | open |
| B4 | Batch moves in one UID MOVE | M | A2 | open |
| B5 | Empty Trash / permanent delete in the UI | S | A1 | open |
| B6 | Attachments: open and save | S | — | open |
| B7 | Attachments in compose | M | — | open |
| B8 | Signatures | S–M | — | open |
| C1 | "Bookingum" as mail program (invoices, reminders, lists) | L | B7 | open |
| C2 | `mail_link` table + linker | L | — | open |
| C3 | E-Mails tab on detail pages | M | C2 | open |
| C4 | Invoices: sent mails and replies | M | C1, C2 | open |
| C5 | Attachment → document | M | C2, D1 (optional) | open |
| C6 | Mails in the global search | S–M | — | open |
| D1 | Documents rework (categories, relations) | L | — | open, design **[user]** |
| E1 | Seeding without PII | M | — | open |
| E2 | PII check for tracked files | S | E1 | open |

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

**Part 2, canary [user]:** a third account kind or a flag that admits exactly one non-loopback account for writes
(the canary mailbox), set only by an explicit manual step, never from the UI. Write a short design proposal in
this card (how the approval is stored, how it is revoked, what is logged), then stop and ask the user. Do not
implement it before the user agrees.

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
  `afterAll`. They `it.skip` when `127.0.0.1:10143` is closed, and print why.
- Keep the default `pnpm test` under about 60 s. Long variants are behind `MAIL_LONG=1`.

**Acceptance.** All ported suites pass. `pnpm test` stays fast. The skip reason is visible in the output.

---

### A9: canary [user]

Waits on: A7 Part 2 approved and built, A8, P1. The user creates a canary mailbox at IONOS and adds it as an
account. Then the write-path suite runs against it: synthetic mails only, a handful of sends to the user's own
address, at most 2 connections, and no retry after a failed login. Report counts and outcomes only. After it passes,
the user decides about the staged writes on the real account (flags → move → delete → send).

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

## D: documents

### D1: documents rework [user for the design]

Today a document hangs off one record (`document.owner_type` + `owner_id`) with a fixed folder layout under
`storage/documents/`. Goal: categories (Verträge, Rider, Rechnungen, Bilder, Sonstiges, plus user-defined ones) per
record, moving documents between categories, and one place showing all documents of a record, including those from
mails (C5). The DB holds the relations (document ↔ record ↔ mail); the file name never carries meaning.

Before coding, write a design proposal in this card:

- whether a document can belong to more than one record (a join table `document_link`) or stays with one owner
  plus "also shown at";
- how categories are stored (a table with per-record or global categories);
- the migration of existing documents (into "Sonstiges", or by `document_type`);
- whether files move on disk (preferably not: storage by id, the DB owns names).

Then stop and ask the user.

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

## Found while working

(Agents: add one line per finding: date, card, file:line, one sentence. No mail content.)
