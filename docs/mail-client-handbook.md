# Mail client: handbook for agents

How to work on the mail client in bookingum without breaking it. Written 2026-10-24 for agents that pick up the
work (opencode). It assumes no memory of earlier sessions: everything you need is here or linked from here.

**If you read only one section, read §9 (safety rules) and §10 (traps).**

---

## 1. Reading order

1. `docs/mail-client.md`: what the mail client is for, the design decisions, the safety gates. Short.
2. `docs/mail-client-assessment.md`: how mature each part is and the ranked risks (R1–R11).
3. **This handbook**, in full.
4. `docs/mail-client-tasks.md`: pick the next open card in order, and read the whole card before you start.
5. `docs/NEXT_STEPS.md` §2: the Task 5 review (F1–F7). It gives the background for the A cards.
6. As needed: `docs/ARCHITECTURE.md` (app-wide recipes and coding guidelines), `docs/UI_LANGUAGE.md` (German UI
   text rules), `src/main/mailclient/core/README.md` (core API).
7. Background only, outside the repo: the prototype at `D:\Projects\Arbeit\Brainstorm\email-prototype`
   (`docs/WRITE_PATH.md`, `docs/LESSONS.md`, `docs/SEARCH.md`, `REPORT5.md`). **Never read its `.env`.**

---

## 2. Map of the code

```
src/main/
  index.ts                       app start; pop-out mail windows (mailWindows map); before-quit stops mailClient
  mailclient/
    MailClientService.ts         main-process host: starts/stops the worker, crash limit, credentials, connection test
    worker.ts                    utility-process entry: createMailCore(...), call() with allowlist, events to main
    protocol.ts                  messages between main and worker; MAIL_API_METHODS (the IPC allowlist)
    accounts.ts                  accounts.json + safeStorage-encrypted passwords (main only)
    core/                        the mail engine (no Electron imports), see core/README.md
      index.ts                   MailCore: the Api implementation, per-account entries, sweepOrphans, close
      types.ts                   Api interface + all data types (MessageRow, JournalRow, OpKind, ...)
      store.ts                   SQLite: folders, messages, FTS search, op_journal
      migrations.ts              mail-store schema versions (PRAGMA user_version)
      sync.ts                    SyncEngine: download, flag sweeps, IDLE, folder mutex, storeMessage
      write_engine.ts            WriteEngine: journaled ops (flag, move, delete, expunge, send, drafts)
      write_guard.ts             sandbox allowlist; injected sandbox endpoint (R1)
      compose.ts                 MIME for new/reply/forward/draft
      connection_test.ts         staged one-shot test for the account dialog
      sanitize.ts, remote_images.ts, imap_options.ts, instance_lock.ts
  api/routers/mail.router.ts     tRPC: mail.call (z.enum(MAIL_API_METHODS)), mail.events (subscription), accounts, test
src/renderer/src/
  lib/mailApi.ts                 Proxy: mailApi.method(...args, accountId) → trpc mail.call
  lib/mailConnection.ts          account dialog helpers
  pages/MailPage.tsx             three-pane mail page (944 lines; split by concern when you touch it)
  pages/MailWindowPage.tsx       pop-out window for one mail (read + answer)
  components/mail/               FolderTree, MessageList, MessageView, ComposeView, MessageMenu,
                                 SelectionActions, PaneResizer, composeDraft.ts, format.ts, selection.ts
  components/settings/MailAccountsCard.tsx   accounts in Einstellungen
tests/
  mail_*.test.ts                 vitest: compose, compose_draft, connection, selection, store_migrations, write_queue
  e2e/mail-client.spec.ts        Playwright against the local sandbox (skips if 127.0.0.1:10143 is closed)
  e2e/helpers/mailSandbox.ts     seeds/cleans the E2E mailbox bookingum-e2e@example.test
```

On disk (per user): `<userData>/mail/accounts.json`, `<userData>/mail/data/<accountId>/` (mail DB + `.eml` files),
`<userData>/mail/data/.mailcore.lock`.

---

## 3. How a call flows

**Reading** (for example, listing a folder):

1. The renderer runs `useQuery({ queryKey: ['mail', accountId, 'messages', folderId, ...], queryFn: () =>
   mailApi.listMessages(folderId, { offset, limit }, accountId) })`.
2. `mailApi` (Proxy) → `trpcVanilla.mail.call.mutate({ method: 'listMessages', args })`.
3. `mail.router.ts` checks `method` against `z.enum(MAIL_API_METHODS)` → `mailClient.call(method, args)`.
4. `MailClientService` posts to the worker; `worker.ts` checks the allowlist **again**, then calls
   `core[method](...args)`.
5. `MailCore.listMessages(..., accountId)` → `this.entry(accountId).store...` → the result goes back the same way.

Values must survive structured clone (no class instances or functions). `Buffer` arrives as `Uint8Array`.

**Writing** (for example, flagging):

1. `MailCore.markFlagged(ids, flagged, accountId)` → `writableEntry(accountId)`. This throws for
   `production-readonly`, so the user sees a German error.
2. The core plans the op: `store.journalEnqueue(...)` (state `pending`). **The journal row comes first**, before
   any server contact.
3. `replayOps` → `WriteEngine.execute(op)`: queued on one serial chain (`enqueue`), under the folder mutex, then
   preflight (fresh SELECT, UIDVALIDITY, existence, identity), then the IMAP command, then the local update, then
   the journal state `done`, `conflict` or `failed`.
4. An `op-event` goes to main → `mail.events` subscription → the renderer invalidates
   `['mail', accountId, 'folders' | 'messages' | 'search' | 'message']`.

**Events:** `sync-event` (folder progress) and `op-event` (op state) flow worker → main → `mail.events`. The renderer
never polls for op results; it invalidates queries on events.

**Credentials:** the worker sends `credentials-request` and main answers with the decrypted password, per
connection. Passwords never reach the renderer, logs or disk in plaintext.

---

## 4. Recipes

### 4.1 Add a method to the mail Api

1. `core/types.ts`: add it to `interface Api` (optional `?` if it is additive; the accountId is not part of the
   interface).
2. `core/index.ts`: implement it on `MailCore` with a **trailing optional `accountId?: string`**. Reads use
   `this.entry(accountId)`. Writes use `this.writableEntry(accountId)` and go through the journal (4.2); never call
   IMAP directly from `MailCore`.
3. `protocol.ts`: add the name to `MAIL_API_METHODS`. Without this the router and the worker refuse it, and that is
   intended.
4. Renderer: call `mailApi.myMethod(arg1, arg2, accountId)`. The type comes from `Pick<MailCore, MailApiMethod>`.
5. Tests: a vitest for the core logic (temp dir `Store`, see `tests/mail_write_queue.test.ts`). If it is visible in
   the UI, add an E2E step.

### 4.2 Add a journaled write op kind (example: folder create/rename/delete, card B1)

1. `core/types.ts`: extend `OpKind`. `op_journal.kind` is TEXT without a CHECK, so **no migration** is needed.
   Write the payload shape as a TS type next to it.
2. `core/index.ts`: a public method that validates input, calls `e.store.journalEnqueue(...)` (state `pending`) and then `this.replayOps(e, [opId])`.
3. `core/write_engine.ts`: a `case` in `executeOne`, plus `doX(op)`:
   - Open the client through the same helper as the other ops (today `sandboxClient()`; after A7 a per-account
     client). **Never open an ImapFlow yourself.**
   - Preflight: check the state the op expects (the folder exists or does not exist). If it does not hold, return
     `conflict` with a short English reason. Never "fix it up".
   - **Idempotent replay:** a crash can happen after the server did the work and before the journal said `done`.
     On replay, detect that it is already done (for example, the target folder already exists with the expected
     name) and return `done`.
   - Folder mutex: hold it for every folder the op touches, deduplicated (see A2c).
   - Local update after the server succeeded, in one synchronous SQLite transaction.
   - `finally { await client.logout().catch(() => {}) }`.
4. Startup replay: `start()` replays `pending` and `running` ops after 5 s. Make sure your `doX` is safe to run twice.
5. Tests: unit (journal states, idempotent replay with a fake or real sandbox) and E2E (UI path, cleanup in
   `finally`).

### 4.3 Change the mail-store schema

`core/migrations.ts`: **append** a new `{ version: n+1, name, up }`. Never edit an existing migration. Every
migration runs in one transaction. Add a case to `tests/mail_store_migrations.test.ts` that opens a DB at the old
version and checks the upgrade. Remember the FTS index is external-content (`fts_source` view): any change to
indexed columns must keep the `messages_bd` trigger and `Store`'s explicit FTS writes consistent, and the test must
run `ftsIntegrityCheck()`.

### 4.4 Add an app-DB table (for example, `mail_link`, card C2)

Follow `docs/ARCHITECTURE.md` "Adding a new business object" and "Migrations": `src/main/db/schema.ts` →
`pnpm db:generate` → review the SQL (FK `ON DELETE` gets dropped for `ADD COLUMN`) → zod schema → repository
(`@injectable`, synchronous transactions) → service → mapper → router. **App data never goes into the mail store**,
since the mail store can be deleted and rebuilt.

### 4.5 Renderer conventions for mail

- Query keys always start with `['mail', accountId, <kind>, ...]`, so the event handler's invalidations reach them.
- Put pure logic (selection, draft building, formatting) in `components/mail/*.ts` with a vitest
  (`tests/mail_selection.test.ts` is the model). Components stay thin.
- React 19 + `react-hooks` lint (purity rules): no `Date.now()`, `Math.random()` or ref reads during render. Compute
  in event handlers or effects.
- UI text is German and follows `docs/UI_LANGUAGE.md`: plain words, no IT jargon ("E-Mail-Konto", not "IMAP
  account"), no exclamation marks, errors say what happened and what to do.
- Write actions are hidden (not just disabled) for `production-readonly` accounts. The E2E test checks this.
- Use Radix primitives from `components/ui/` (dialogs, menus) like the rest of the app.

---

## 5. Conventions and quality bar

- **Language:** code, comments, docs and commit messages in English; UI text in German.
- **Formatting:** prettier (`singleQuote`, no semicolons, `printWidth` 100, `trailingComma: none`, LF) for
  everything **except** `src/main/mailclient/core/**`, which keeps the prototype style (semicolons, long lines).
  Never run `pnpm format` / `prettier --write .` on the whole repo: it would reformat core and make every future
  port from the prototype unreadable. Format only the files you changed:
  `pnpm exec prettier --write <file> <file>` (non-core files only).
- **Comments** explain *why*, not what. Match the density of the surrounding code. No commented-out code, no TODOs
  without a card ID.
- **Errors:** user-facing texts in German, short; internal reasons (journal `error`, logs) in English, and never
  with mail content.
- **Types:** no new `any`. Use `unknown` plus narrowing. No `@ts-ignore`; `@ts-expect-error` only with a reason.
- **Empty `catch`:** not allowed silently. Either handle the error, or write `catch { /* why it is safe to ignore */ }`.
- **Size of changes:** one card = one focused commit (or a few). Do not refactor unrelated code in the same commit.
- **Tests come with the change.** A fix without a test that fails before and passes after is not done (exceptions:
  pure UI layout, which gets an E2E or screenshot check).
- **No new dependencies** without a reason in the commit message. Licenses must be permissive (MIT, Apache, BSD,
  ISC). No GPL, no MPL-only.
- **Prefer existing helpers** (`imap_options.ts`, `Store` methods, `writableEntry`, `listQuery.ts`, `components/ui`).
  Search before writing new ones.

---

## 6. Verification (run all of it before every commit)

From the repo root, in this order. Every command must pass; paste the summary lines (counts), not the output body.

```bash
pnpm -s typecheck
pnpm -s exec vitest run
pnpm -s lint
pnpm -s build
pnpm -s exec playwright test tests/e2e/mail-client.spec.ts
```

- **Baseline (2026-10-26, I16):** typecheck passes; vitest 777 passed / 2 skipped (the two e-invoice validators
  skip without KoSIT/veraPDF); lint 0 errors, 43 warnings; E2E mail 34/34 with the sandbox up. The old baseline
  (244 passed, 19 lint errors) is historical: T1 and I9 cleared both.
- After touching non-mail code, also run the full E2E suite: `pnpm -s exec playwright test` (it runs with one
  worker, so it takes a while: use a long timeout).
- **Sandbox check for E2E:** the E2E suite must leave the sandbox as it found it. Compare per-folder message counts
  of the E2E mailbox before and after (`node scripts/mail-sandbox-counts.mjs`; counts only, never
  subjects or addresses).
- **If the sandbox is down** (`127.0.0.1:10143` closed), the mail unit suites skip on CI and FAIL locally
  (`tests/helpers/sandboxGate.ts`), and the mail E2E tests skip. A skip is **not** a pass: say so
  in your report, and do not start or restart the containers yourself unless the user says so. Another agent's fuzz
  harness may be using them.
- If a gate fails and the failure is unrelated to your change, stop and report it with the output. Do not "fix"
  unrelated tests to get green.

---

## 7. The sandbox

- It lives in the prototype: `D:\Projects\Arbeit\Brainstorm\email-prototype\sandbox\` (docker compose). Dovecot
  IMAP on `127.0.0.1:10143` (CONDSTORE) and `:10144` (an IONOS-like profile without CONDSTORE), Mailpit SMTP on
  `:1025`, Mailpit web UI and API on `:8025`.
- bookingum's E2E mailbox: `bookingum-e2e@example.test` with password `testpass` (it is also in
  `tests/e2e/helpers/mailSandbox.ts`). The helper seeds 6 INBOX mails and a folder `Projekte` and cleans up by
  subject prefix.
- **Never use `testuser@example.test`.** That mailbox belongs to the prototype's fuzz harness.
- Never stop, restart or reset the containers, and never run the prototype's `reset.mjs` or `seed.mjs`, unless the
  user asks.
- Dovecot allows about 10 connections per user and IP. Keep tests serial.

---

## 8. Production (the real IONOS account)

- Read-only until the canary passes (gate 3), and only the user decides when. Account kind `production-readonly`;
  `writableEntry` refuses writes; `write_guard.ts` allows loopback hosts only.
- At most 2 simultaneous connections. **Never retry a failed login** (IONOS locks accounts); the core stops all
  contact after a rejected login, so keep that behavior.
- Do not connect to production at all unless a card says so **and** the user said go in this session.
- The production data dir must not be in a cloud-synced folder (OneDrive, Dropbox).

---

## 9. Safety rules (non-negotiable)

1. **Never print mail content**: bodies, subjects, sender or recipient addresses, attachment names. Not in chat,
   logs, reports, docs, commit messages or test names. This includes the sandbox mailboxes and Playwright artifacts
   (`test-results/`, `error-context.md`, traces, snapshots). Report counts and structure only.
2. **Never read `.env`** files (bookingum's or the prototype's), and never read `.opencode/orthos-key`.
3. **No real personal data in the repo**: no real names, addresses, IBANs or mails in code, seeds, tests, fixtures
   or commits. Sensitive master data goes only in the gitignored `sample_data/`. Test data uses `example.test` /
   `example.com` and made-up names.
4. **No writes to production** (see §8). Do not widen the write guard's allowlist. Do not add a code path that
   writes without going through `writableEntry` and the journal.
5. **Never copy prototype files over bookingum's core.** Port by hand, change by change (the assessment, §4).
6. **No GPL/MPL-only code or dependencies.**
7. **Do not delete user data** (mail data dirs, accounts.json, the app DB) without the user's explicit OK, and
   never through code paths that run automatically on start.
8. **Do not push**, and do not open PRs, unless the user says so. Commit on the current branch (`feat/mail-client`).
9. Commit messages follow the repo's rules (`.opencode/skills/git-commit-message-rules/SKILL.md` locally:
   conventional prefix `feat(mail):`/`fix(mail):`/`docs:`/`test:`/`chore:`, an imperative summary, a body that
   says why).

---

## 10. Traps (each of these has cost a session before)

1. **`message_key` is not stable.** It is `sha1(accountId|folderId|uidValidity|uid)`, so it changes when a mail
   moves or the folder's UIDVALIDITY changes. Never store it outside the mail store. Link with
   (account, Message-ID). Inside the store, after a move, look the row up again by the new key
   (`payload.movedTo.messageKey`).
2. **File paths:** always `path.join(<account data dir>, row.file_path)`. A bare `row.file_path` resolves against
   the process's working directory (that is bug F7). Inside `WriteEngine` the base is
   `this.store.dataDirResolved`, and in `MailCore` it is `entry.config.dataDir`. Both are the same folder today;
   do not introduce a third one.
3. **The FTS index is external-content.** Never `DELETE FROM fts ...` and never write to `fts` outside `Store`.
   Deleting a `messages` row fires the `messages_bd` trigger, which already removes it from the index. A second
   delete corrupts the index (F7).
4. **The folder mutex has no owner and is not reentrant.** Acquiring the same folder twice in one call chain
   deadlocks forever, and the serial op chain stops behind it. Deduplicate the folder list, and refuse a move whose
   source and target are the same (A2c).
5. **Never release a lock you do not own**, and never "time out" a lock by force. A timed-out op must stop touching
   the server before anything else can run (F2/F4).
6. **Send is exactly-once.** After SMTP `DATA` has started, the outcome is `unknown` (it may have been delivered),
   never `failed`. `unknown` is resolved by the probe, never by resending automatically (F3).
7. **Journal first.** Insert the op row before any server contact. Replays must be idempotent.
8. **Windows file locks:** Defender or the indexer can hold a freshly written file for a moment, so `rename` and
   `unlink` can fail with `EPERM`/`EBUSY`. Retry briefly. Never leave a DB row pointing at a name that does not
   exist (F1).
9. **The orphan sweep deletes files.** Anything that makes a row and its file disagree, even for a moment that can
   be interrupted by a crash, can lose a file once the sweep runs. That is why the sweep is not scheduled yet (A3).
10. **Radix modal dialogs hide the rest of the page from the accessibility tree.** In Playwright, `getByRole` finds
    nothing behind an open dialog. Close it (Escape) before checking the list.
11. **E2E order dependence:** a failure in an early test makes every later test fail with
    "Kein E-Mail-Konto eingerichtet" (the new worker lost `sandboxId`). Read the **first** failure only. T3 fixes the
    cause.
12. **`git checkout main` deletes `.opencode/`.** `main` still tracks `.opencode/`, but this branch untracked it. A
    checkout to `main` and back removes the local files. Do not switch branches in this checkout. If it happened,
    restore them with `git show 0cdf750:.opencode/opencode.json > .opencode/opencode.json` (and the same for
    `.opencode/skills/git-commit-message-rules/SKILL.md`).
13. **Core line endings:** four core files have CRLF working copies (`remote_images.ts`, `sanitize.ts`,
    `write_guard.ts`, and formerly `README.md`). Git normalizes them; do not "fix" them in a commit of their own,
    and do not let an editor convert whole files (that makes diffs unreadable).
14. **Structured clone at the IPC boundary:** return plain objects. A `Map`, `Set` or class instance arrives
    changed or broken. `Buffer` arrives as `Uint8Array`.
15. **better-sqlite3 transactions are synchronous.** Never `await` inside `db.transaction(() => ...)`.
16. **Two IMAP connections can reach the same new UID** (IDLE and sync). `storeMessage` must stay idempotent
    (`getByKey` check first).
17. **Dovecot's connection limit:** parallel tests or fuzz with more than one worker against the same user fail
    with login errors that look like bugs. Keep things serial.

---

## 11. Definition of done (for every card)

- [ ] The card's acceptance criteria are all met. Check each item and say how you checked it.
- [ ] New or changed behavior has tests: a unit test (fails before, passes after) and E2E where the UI is affected.
- [ ] All gates in §6 pass (or the card says which gate may stay red and why). Lint: no new errors or warnings in
      the files you touched.
- [ ] No mail content, no real personal data, no secrets in the diff, test names, logs or commit message.
- [ ] Docs updated where behavior changed: `docs/mail-client.md` (design), the card's status in
      `docs/mail-client-tasks.md` (mark it done with the commit hash), and the assessment's risk entry if a risk
      changed.
- [ ] The sandbox is left as it was (counts compared).
- [ ] One focused commit on `feat/mail-client`, not pushed.

## 12. When to stop and ask the user

- Anything that would contact production, change the write guard, or delete user data.
- When a card's premise turns out wrong (the code is not as the card says). Report what you found; do not improvise
  a different design.
- When a fix needs a design decision the docs do not make (for example the shape of the per-account write
  endpoint, A7).
- When a gate fails for reasons outside your change.
- Before starting the canary, the read-only pilot, or anything marked "user" in the task list.

## 13. How to report at the end of a card

Short, in this order:

1. The card ID and what changed (files).
2. How each acceptance criterion was verified.
3. The gate results (counts).
4. What is not done or not verified, and why.

No mail content. No full test output: summary lines only.
