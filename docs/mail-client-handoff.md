# Mail client: handoff brief for the remaining review cards

Written 2026-10-26, at `57a53a5` on `feat/mail-client`. Cards I1 to I3 are done (`docs/mail-client-tasks.md`,
section I). This brief is for agents (opencode/omo or others) that pick up the rest. Claude reviews each
branch afterwards. Read this file, `docs/mail-client-review.md` (the finding behind each MR number) and the
`AGENTS.md` files of every folder you touch before starting.

---

## 1. Standing rules

These were set by the user over several sessions. They hold for every card and override anything a card
says. If a card seems to need breaking one, stop and ask instead.

**Secrets and private data**
- Never read any `.env` file, including the one in the prototype repository. Never read `.opencode/orthos-key`.
- Never print, paste, quote or commit mail content: bodies, subjects, addresses, names, attachment names.
  That includes the sandbox mailboxes, Playwright `test-results/`, `error-context.md` page snapshots and
  core logs. Report counts and structure only (for example "3 messages in INBOX, 1 with an attachment").
- Never copy the Outlook `.ost` file or the prototype's `data/` folder, and never read `.eml` files the store
  reports as missing from `dataDir`.
- No real names, addresses, IBANs, phone numbers or company names in code, tests, docs or commit messages.
  Fixtures use reserved domains only (`*.test`, `example.com`, `example.org`, `bookingum.test`,
  `bookingum.example`). `tests/no_pii.test.ts` must pass. Do not use `testuser@example.test`: other
  harnesses share that mailbox. The mail e2e has its own (`E2E_MAIL_USER` in
  `tests/e2e/helpers/mailSandbox.ts`).
- Do not repeat PII that already sits in the repo while fixing it (I14): replace it, and refer to it by
  file and line only. The same goes for names in `seed.ts`, `docs/TODOS.md`, `docs/mail-client-tasks.md`
  and the e2e seed log.
- Keep mail data out of cloud-synced folders (OneDrive and similar).

**The real mailbox**
- The production account (IONOS) stays read-only until the canary has passed and the user signs that off.
  No card may make it writable, and no test may connect to it.
- Never run `tests/e2e-canary/mail-canary.spec.ts` or `playwright.canary.config.ts`. Since I6 the spec is
  outside the default `testDir` and skips unless `BOOKINGIUM_CANARY=1`; still pass the spec files to
  `npx playwright test`.
- Never send mail to another person, from any account.
- At most 2 connections to the production server at once. Never retry a failed login, in code or by hand.

**The sandbox and running processes**
- Leave the sandbox as you found it. Remove what your tests created; do not delete anything else.
- Do not restart or stop the sandbox containers, or the fuzz, proxy or prototype processes.
- Only one agent runs the mail e2e at a time: it uses one shared sandbox mailbox.

**Code**
- No GPL or MPL code or dependencies. Never copy the prototype core (or any file of it) over bookingum's
  `src/main/mailclient/core/`. Porting an idea is fine; porting a file is not.
- Never run `prettier --write` over `src/main/mailclient/core/**` (its files keep their own style; `index.ts`
  and `store.ts` use semicolons). Format renderer and test files you touch with prettier.
- Follow the project `AGENTS.md`: one-way layers, integer cents, no barrel files, German UI copy and English
  identifiers, no `db.transaction(async ...)`, no edits to applied migrations or `migrations/meta/*`.
- A new core method is a three-file change: `core/types.ts` (`Api`), `protocol.ts` (`MAIL_API_METHODS`),
  then the router or `mailApi` call site.

**Data and git**
- Never delete user data without the user's confirmation, and no hard deletes.
- Never push, never merge into `feat/mail-client` or `main`, never rewrite published history. Do not commit
  `.omo/`.
- Commit messages: conventional style as in `git log` (`fix(mail): ...`, `test(mail): ...`,
  `docs(mail): ...`), English, no PII, ending with the attribution line your tool is configured with.

---

## 2. How to work a card

1. Branch from the current `feat/mail-client`: `fix/mail-i<n>-<slug>` (for example `fix/mail-i9-gate-green`).
   One card per branch. Do not start a card whose files another open branch changes (section 4).
2. Read the card's MR entries in `docs/mail-client-review.md` and, for the evidence, the raw report named in
   `docs/mail-client-review-agents/README.md`. Line numbers there are from `811f04a` and have moved.
3. Write the failing test first, then the fix. Every fix needs at least one test that fails without it.
4. **Mutation check.** For each new test, undo the fix in the working tree (for example
   `git stash push -- <source files>`), run the test, note that it fails and why, then restore
   (`git stash pop`). A test that still passes without the fix does not count.
5. Run the gates in this order and record the counts:
   ```bash
   pnpm test
   pnpm lint
   pnpm typecheck
   pnpm build
   ```
   - `pnpm test` exits 1 until I9 lands, because of one unhandled ECONNRESET in
     `mail_write_guard.test.ts` (MR-17). Before I9, that is the only failure allowed. After I9, exit 0.
   - `pnpm lint`: 0 errors, and no new warnings in the files you touched.
   - If the card touches the mail UI, the core or the host, run the mail e2e after `pnpm build`:
     ```bash
     npx playwright test tests/e2e/mail-client.spec.ts
     ```
     It needs the local sandbox. Note how many passed, failed and skipped; a skip is not a pass.
6. Update the docs:
   - In `docs/mail-client-review.md`, add a `**Status:** fixed in I<n> (<date>)` line under each MR the card
     fixes, or say what part is left.
   - In `docs/mail-client-tasks.md`, add `### I<n>: <title> [fixed <date>]` at the end of section I
     (after I3's format: findings, what changed, tests).
7. Commit in small steps (tests and fix may share a commit; docs in their own). Leave the branch unpushed.
8. Write the review report (section 6) and stop.

---

## 3. The card split

**Agent cards** run without Claude, then get a normal review. **Claude cards** touch the send path, the
canary, main-process security or store integrity. Claude does them, or an agent does them and Claude
reviews line by line.

| Card | Findings | Who | Main files |
|---|---|---|---|
| **I9** gate green | MR-17, section 4 | agent, **first** | `tests/helpers/fakeImap.ts`, `fakeSmtp.ts`, `mail_crash_points`, `mail_write_guard`, `.github/workflows/ci.yml` |
| **I10** small renderer fixes | MR-13, 35, 36, 37, Low "Renderer" | agent | `MailPage.tsx`, `MailWindowPage.tsx`, `ComposeView.tsx`, `composeDraft.ts`, `mail.router.ts` (signature DTO only) |
| **I16** renderer leftovers | README "Renderer" 15, 17, 18, 20, 22 | agent, after I10 | `MailWindowPage.tsx`, `MailPage.tsx`, `MessageView.tsx` |
| **I13** fuzz and soak harness | section 5 | agent | new files under `tests/fuzz/` (or similar), a `package.json` script |
| **I14** docs drift and PII | sections 6 and 8, README "Docs drift" | agent, **last** | `AGENTS.md` files, `docs/*`, `core/README.md`, file headers, `tests/no_pii.test.ts` |
| **I15b** search and linking | MR-27, 28 | agent, close review | `core/store.ts` (search part), `services/MailLinkService.ts`, `mail_link.router.ts` |
| **I4** mailbox selection | MR-09, 10, 24, 25, 31 | Claude | `core/sync.ts`, `core/index.ts`, `core/store.ts` |
| **I5** HTML safety | MR-07, 08 | Claude, or agent with line review | `core/sanitize.ts`, `components/mail/composeBody.ts` |
| **I6** canary in main | MR-18, 20, section 6 | Claude, **needs the user** | `core/write_guard.ts`, `accounts.ts`, `mail.router.ts`, `main/index.ts`, `playwright.config.ts`, `mail-canary.spec.ts` |
| **I7** invoice send (C1) | MR-11, 12, 14, 21, README host H3 | Claude | `InvoiceForm.tsx`, `ComposeView.tsx`, the `invoice:email` handler, `mail.router.ts` |
| **I8** folder delete | MR-06 | Claude | `core/write_engine.ts`, `core/index.ts` (undo) |
| **I11** host hardening | MR-22, 23, 33, 34, design note 5 | Claude | `core/remote_images.ts`, `mailclient/attachments.ts`, `core/connection_test.ts`, the `invoice:email` handler, `preload/index.ts` |
| **I12** store robustness | MR-26, 41, 42, README sync M3 and M9 | Claude | `core/store.ts`, `core/sync.ts`, `core/index.ts` (recovery) |
| **I15a** connections and errors | MR-19, 30, 32, 39, 40, README L2 | Claude | `core/write_connection.ts`, `core/write_engine.ts`, `core/sync.ts` (IDLE), `core/connection_test.ts` |

I15 is new: the review left MR-19, 27, 28, 30, 32, 39 and 40 out of every card. The Low items under "Core",
"Write path", "Host" and "Migrations", and the README items under "Write path and core" and "Host" not named
above, go to the card whose files they touch; anything left over is listed in I14's report as open.

---

## 4. Order and file overlap

Two branches never change the same file at the same time. The tracks below can run in parallel; inside a
track, one card after the other, each branched from `feat/mail-client` after the previous one is merged.

- **Start:** I9 alone. Every other card's gate result means more once `pnpm test` exits 0.
- **Renderer track (agents):** I10, then I16. I7 waits for both (same files).
- **Test track (agent):** I13 at any time; it adds files only. It must not edit `tests/helpers/fake*.ts`
  while I9 is open.
- **Core track (Claude):** I4, then I12, then I15a (all three change `sync.ts`, `store.ts`, `index.ts`).
  I8 fits between them (`write_engine.ts`, `index.ts`). I15b changes `store.ts` too, so it waits for I12.
- **Host track (Claude):** I6, then I11, then I7 (all change `mail.router.ts` or `main/index.ts`).
- **I5** touches `core/sanitize.ts` and `composeBody.ts` only; it can run beside anything except I7 and I10 if
  `ComposeView.tsx` changes.
- **I11 and I15a** both change `core/connection_test.ts`; the second waits for the first.
- **I14** last, because every card edits the docs it corrects. The one exception: the `AGENTS.md` line
  "Sending mail from the app ... nothing is transmitted" is wrong today, and agents act on it. Fix that line
  (and `src/main/AGENTS.md`) first, in its own small commit on the I9 branch or its own branch.

Every card appends to `docs/mail-client-tasks.md` and `docs/mail-client-review.md`. Those merge conflicts are
expected and trivial: keep both sections.

---

## 5. Acceptance checks per card

A card is done when every box holds, the gates pass, and the mutation check is recorded.

### I9: gate green (MR-17, section 4)
- [ ] `pnpm test` exits 0, twice in a row. The ECONNRESET is gone because the test logs its clients out
      before closing the fake servers, not because the error is swallowed.
- [ ] `fakeImap` answers an unknown command with `BAD`, and advertises only capabilities it implements. A test
      shows a MOVE against it fails when MOVE is not implemented.
- [ ] `fakeSmtp` refuses `AUTH LOGIN` without the right credentials, with a test. Optional: dot-unstuffing.
- [ ] `mail_crash_points.test.ts` can fail: test 2 fails with 0 deliveries and when Mailpit is unreachable;
      test 1 checks that the source copy is gone; it removes its own mail; it no longer claims to kill a
      process it does not kill (or it really does).
- [ ] `mail_sync_time.test.ts` asserts the right behaviour (the sync time does not move without real
      contact), or is marked as pending on I4 with a reason.
- [ ] CI: a Windows job beside Ubuntu, and a check that the better-sqlite3 build loads under vitest (the
      ABI question). CI fails or annotates visibly when the sandbox suites skip. The branch is not pushed;
      the workflow change is verified locally as far as possible and the report says what only a CI run can
      prove.
- [ ] `mail-client.spec.ts`: the data-dependent skip near the old line 1369 either runs or fails; fixed
      sleeps that the change touches become waits on a condition.

### I10: small renderer fixes (MR-13, 35, 36, 37, Low "Renderer")
- [ ] MR-13: `signature` is in the account DTO; a round-trip test (save, load, compose shows it once).
- [ ] MR-35: `onWriteTo` and every write button are only wired when `canWrite`; a test on a read-only account.
- [ ] MR-36: archive filters ids like `trashable`, the action is hidden in the Archive folder, and ids no op
      covers are shown again. The "Archiviert" toast counts what the core archived, not `ids.length`
      (README renderer 20).
- [ ] MR-37: the keyboard handler returns early in `dialog` and `alertdialog` roles, in the compose area and
      while compose is open; a test for each.
- [ ] Low: `hiddenIds` reset on account switch; reopening a draft keeps its HTML; `MailWindowPage` shows an
      error instead of spinning when `getDraft` fails; `addFiles` sets `edited`; the preset PDF counts
      against `MAX_ATTACHMENT_BYTES`; unused `search.pdfName` removed; events of other accounts no longer
      dropped and sync events invalidate `search`; signature applied once; reader icon buttons have an
      `aria-label`; the keyboard effect subscribes once.
- [ ] Mail e2e passes. Renderer decisions moved into pure modules where needed, so vitest covers them (as
      `opJournal.ts` and `composeSend.ts` do).

### I16: renderer leftovers (README "Renderer")
- [ ] 17: the compose branch of `MailWindowPage` renders `ComposeView` only with `canWrite`.
- [ ] 18: `MailWindowPage` picks up an `isDraft` or folder change of the shown mail (invalidates the queries
      it reads).
- [ ] 22: "Alle Anhänge" has a role, so its `aria-label` is read.
- [ ] 15: the unreachable `presetPdfPath` branch is removed.
- [ ] (20 is in I10.)

### I13: fuzz and soak harness (section 5)
- [ ] An op generator and invariant checker in bookingum's `tests/`, written fresh after the prototype's
      ideas; no prototype file copied (state in the report how it was written).
- [ ] It drives bookingum's own core against the sandbox, on its own sandbox user and folders, and cleans up.
- [ ] Invariants include at least: no message lost or duplicated after a move or batch move, the local store
      matches the server after a resync, no op left `running` after a run, no orphan files.
- [ ] Not part of `pnpm test`; a separate script (for example `pnpm fuzz:mail -- --seeds 50 --ops 30`) with
      seed replay. The report gives a short run's counts (seeds, ops, invariant failures) and how to run the
      nightly length.
- [ ] A failing seed prints the seed and the op list (kinds and ids, never content).

### I14: docs drift and PII (sections 6 and 8)
- [ ] Every row of review section 8 and the README "Docs drift" list fixed, or marked in the report as left
      on purpose.
- [ ] The `AGENTS.md` and `src/main/AGENTS.md` line on sending says what is true: the mail client sends
      over SMTP for writable accounts; the old `mail/` path only writes files.
- [ ] The real-looking address in `docs/mail-client-tasks.md` and the names in `docs/TODOS.md` are replaced
      without being quoted anywhere (not in the diff description, report or commit message).
- [ ] `tests/no_pii.test.ts` also scans `docs/` and `*.md` and the mail sources, with tests that a planted
      address in each fails it. It still prints only `file:line`.
- [ ] Section 6's two decisions (the canary design and the phase-2 record) are **not** made by the agent:
      the report lists them as open questions for the user. Likewise the history items (deleted test files,
      two commit messages): list them, do not rewrite history.

### I15b: search and linking (MR-27, 28)
- [x] MR-27: the probe word is folded; an empty expression returns no hits; bare operators are dropped.
      Tests with capitalised and umlaut prefixes, an all-caps query and operator-only queries.
- [x] MR-28: the linker cursor is keyed by generation and id, one transaction per batch, dismissed owners are
      filtered, errors are logged, Sent is found by special-use `\Sent`. Tests for each.
- [x] README host L3: the shared-address cap counts owners, and the user's own aliases are excluded.

### Claude cards

The checks below are what the review asks for. An agent may draft one of these, but must say so at the top
of its report, and Claude reviews it line by line before anything is merged.

- **I4:** a test with two folders that share UIDs proves `flagSweep` flags the right one (readOnly lock,
  folder mutex, UIDVALIDITY check); the repair takes the mutex and a readOnly lock and checks UIDVALIDITY;
  the maintenance gate skips instead of proceeding, for all accounts; `mailbox.uidNext` is stored from
  SELECT; `diskFull` stops poll, IDLE, `syncFolder`, `syncAll` and repair, and no `noteSuccess` when every
  folder failed; a rename re-key merges into an existing target row, sync skips paths with a pending
  rename, the subtree is locked.
- **I5:** CSS is inserted via the DOM (`textContent`) or CSS containing `<` is rejected; tests for
  `</style >`, `</STYLE\t>` and nesting. The editor never sniffs HTML and always escapes plain text; tests
  for a forward header, `<https://...>`, `<addr>` and a literal `<b>`.
- **I6:** main refuses a sandbox kind on a non-loopback host without the canary; the flag is cleared on any
  change of host, port, user or email; main checks SMTP security; `writableEntry` asks `writeRefusal`; the
  canary spec runs only with `BOOKINGIUM_CANARY=1`, finds the account by its flag, fails rather than skips,
  and is out of the default `testDir`. The design decision of section 6 is recorded after the user decides.
- **I7:** UTF-8 via `TextDecoder` with an e2e assertion on the body; an explicit sending account validated in
  main, failing closed; a missing PDF is a hard error and main attaches it; the PDF is registered only in
  the `invoice:email` handler under an opaque token, removed after use; an unclear send confirmed later
  marks the invoice emailed (README H3).
- **I8:** a test that deleting a folder the server reports as non-empty (STATUS MESSAGES inside the op) is
  refused; undo of `folder_create` runs the same check, subfolders included.
- **I11:** the remote-image timer covers the body, with a streaming byte cap and private ranges blocked on
  every redirect hop, URLs from main; opened attachments get Zone.Identifier ZoneId=3, an allowlist of safe
  types, the name from stored metadata with bidi characters stripped, confirmation in main; the connection
  test uses the stored password only when host, port and user match; `safeAttachmentName` plus an
  inside-the-folder check for `invoice:email`; `window.electron` removed from preload.
- **I12:** `quick_check`, `startsWith('SQLITE_CORRUPT')` with `cause`, extended codes (`SQLITE_IOERR_SHORT_READ`),
  a try/catch per account, `.eml` files re-linked after a rebuild; a mass expunge above a threshold is
  refused unless EXAMINE's EXISTS confirms it, with resumable staging; the contacts upsert in the insert
  transaction or non-fatal; the UIDVALIDITY swap hides `__staging__/` and avoids `Math.max(...set)`.
- **I15a:** an idle timeout and NOOP before reusing the write connection, `IMAP_TIMEOUTS`, close on abort,
  counted against `maxConnections` (the IDLE client too); NONEXISTENT and TRYCREATE separated from network
  errors, which return `failed` and drop the client; a batch resumes only when all source UIDs are gone and
  every member is found, at or above the recorded UIDNEXT; one `done()` clears all three IDLE timers; events
  are delivered once.

---

## 6. What to leave for review

When a card is done, write `docs/mail-client-handoff-reports/I<n>.md` and commit it on the branch. Keep it
short and free of mail content:

- **Branch and commits:** the branch name and `git log --oneline feat/mail-client..HEAD`.
- **Findings:** each MR (or README item) the card covers: fixed, partly fixed (what is left), or not fixed
  (why).
- **Tests:** each new or changed test file, and for each new test the mutation check: what was reverted,
  and that the test failed.
- **Gates:** the counts of `pnpm test` (files, passed, failed, skipped, and the exit code), `pnpm lint`
  (errors, warnings), typecheck and build exit codes, and the mail e2e counts if run.
- **Not verified:** anything only CI, the canary or the user can prove.
- **Questions for the user:** decisions the card needs that are not the agent's to make.
- **Rules:** confirm that no standing rule was broken, or say which one was close and what you did.

Claude's review then checks out the branch, reruns the gates and the mail e2e, repeats the mutation checks,
reads the diff, and merges into `feat/mail-client` only with the user's go-ahead.
