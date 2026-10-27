# Mail client: critical review (2026-10-26)

**Scope:** branch `feat/mail-client` at `811f04a`, the about 100 commits since the handoff (`5dd65f6`), plus
prototype Task 6 (`REPORT6.md`). **Method:** five read-only reviews in parallel (core write path; sync, store
and recovery; host, IPC and security; renderer; tests, CI and docs), each finding re-checked in the code before
it was written down here. No app run against a real server, no e2e run, no mail content read. The five raw
reports, and the list of their findings that did not make it in here, are in `docs/mail-client-review-agents/`.

Each finding has an id (`MR-nn`), a place, a concrete failure scenario, a fix direction and a confidence:

- **confirmed**: the path was traced in the code and re-read by me;
- **code**: confirmed by one reviewer in the code, not re-traced by me;
- **plausible**: depends on timing or server behaviour nobody reproduced.

The suggested cards at the end turn this into work. Fixed findings carry a **Status** line under their heading (I1 and I2 so far).

---

## 1. Verdict

The mail client is far along as a *reader*. Sync, store, search, the reading pane, the link to bands, venues,
people, companies and events, and documents from attachments are built and mostly sound. The *write* side
grew fast in G2 to H (connection reuse, optimistic hiding, folder ops, batch move, canary, invoice sending).
That speed shows. The invariants the design is built on hold on the happy path but are broken on several
crash, timeout and retry paths:

1. **"Never send twice" does not hold.** A send interrupted after SMTP started is sent again on the next
   start (MR-01, MR-02). The editor invites a manual resend after an unclear result (MR-03). A double Ctrl+Enter
   or an Enter in the subject sends (MR-04). The invoice flow (C1) inherits all of this and adds problems of its
   own: garbled umlauts, a possibly missing PDF, the wrong account (MR-11, MR-12, MR-14).
2. **Untrusted mail HTML reaches live markup twice:** the sanitizer is bypassed with `</style >` (MR-07), and
   forwarded or replied text is pasted into the editor as HTML (MR-08).
3. **The sync can corrupt local state on IONOS.** The flag sweep reads flags from whatever folder was selected
   last (MR-09), and the hourly file repair shares the sync connection without a lock (MR-10).
4. **The canary is a UI toggle, not the approved constant.** It is enforced only in the renderer (MR-20), and
   real-mailbox writes that the plan calls phase 2 are recorded as already done (section 6).
5. **The test gate is red** (MR-17). The prototype's 2000-seed fuzz and 2-hour soak prove the prototype core,
   not this one (section 5).

**Recommendation:** nothing beyond the canary should write to a real mailbox until MR-01 to MR-06 and MR-09/10
are fixed and tested. Card group **I** at the end orders the work.

---

## 2. Findings

### Critical

#### MR-01: a send interrupted after SMTP started is sent again on the next start (confirmed)
**Status: fixed in I1.** A `running` send in the `smtp` phase is replayed as `unknown` and only probed; nothing that may have reached the server is sent again.
- **Where:**
  - `core/write_engine.ts:994-1020`: on replay only `state === 'unknown'` goes to the probe-only path;
  - `core/index.ts:599-611`: `replayPendingOps` replays `pending` and `running`;
  - `core/index.ts:1407-1419`: `close()`.
- **Scenario:** `sendMail` sets the op to `running`, and `doSend` writes `phase: 'smtp'` (line 1010).
  - The server answers 250. The app is then closed or the worker is killed before the op reaches `done`:
    - `close()` does not wait for in-flight writes, so the `journalUpdate` hits a closed database;
    - `MailClientService.stop()` kills the worker after 15 s.
  - At the next start the op is still `running`. `doSend` probes Sent by Message-ID. The mail was never filed,
    or the provider does not file it, or no Sent folder is known (`'unavailable'`), so the probe misses and the
    mail is sent again.
- **Fix:** on replay, treat `running` plus `phase === 'smtp'` exactly like `unknown`: probe, never resend.
  Make `close()` wait for the in-flight op, as `core/AGENTS.md` claims it does. Test: a send whose journal says
  `running`/`smtp` is replayed and does not reach SMTP.

#### MR-02: a failed connect leaves a send in `running`, and it goes out unasked at the next start (confirmed)
**Status: fixed in I1.** `execute` turns every throw into an outcome (`failed` before SMTP, `unknown` after it), and replay catches per op.
- **Where:** `core/write_engine.ts:1073`: `sentProbe` calls `writeClient()` outside its `try`. The same pattern
  is in `doFlag` (387), `doMoveLike` (438), `doMoveBatch` (556), the folder ops (724, 750, 791), `doExpunge`
  (923), `appendToSent` (1125) and `doDraftSave` (1150).
- **Scenario:** the login or connect throws, so `execute` rejects and `runOp` throws. `applyOpResult` never
  runs, so the op stays `running`. `sendMail`'s cancel branch is skipped too. The user sees a raw error, keeps
  the editor open and sends again, which creates a new op with a new Message-ID. At the next start the stranded
  op is replayed and delivered as well: two copies, and the Message-ID probe cannot match them.
  - Other ops stay `pending`/`running` with their optimistic effect applied (see MR-29).
  - One throwing op also aborts the whole `replayPendingOps` loop.
- **Fix:** one wrapper in `execute` that turns any exception into `failed`, or into `unknown` once
  `phase === 'smtp'`. Catch per op in `replayPendingOps`.

#### MR-03: an unclear send is never resolved, and the editor invites a duplicate (confirmed)
**Status: fixed in I1 (core), I2 (editor) and I3 (op panel).** Unknown sends are probed at start, the watchdog answers `unknown` in the SMTP phase, and the editor locks on an unclear result with "Im Ordner Gesendet prüfen" / "Als neue Mail senden". The Message-ID is stable per compose session.
- **Where:**
  - `core/index.ts:1046`: throws "Versand unklar …";
  - `components/mail/ComposeView.tsx:450-451`: shows "Senden fehlgeschlagen" for every error and leaves the
    editor open and sendable;
  - `core/store.ts:227`: `journalPending` selects only `pending`/`running`;
  - `protocol.ts`: `listOps`, `getOpCounts`, `retryOp`, `resolveOp` and `cancelOp` are allowlisted but used
    nowhere in the renderer;
  - `core/write_engine.ts:238-247`: the watchdog's `late` branch.
- **Scenario:** the SMTP connection drops after DATA, so the op is `unknown`. The user reads "Senden
  fehlgeschlagen" (the "unklar" text is only in the description), clicks Senden again, and the recipient gets
  two mails. The `unknown` op itself is never probed again: startup replay skips it, and there is no screen to
  resolve it. The resolution designed in `docs/mail-client.md` (probe Sent by Message-ID, or ask the user) is
  unreachable.
  - The watchdog makes this worse: if the body does not settle within 15 s after the abort, the result is
    `failed` whatever the phase. `sendMail` then marks it `cancelled` while SMTP may still complete.
- **Fix:**
  - An "unclear" result closes the editor, or locks it read-only, with "Prüfen" / "Als neue Mail senden".
  - Keep the Message-ID per compose session, so a retry is recognisable.
  - Probe `unknown` sends at startup.
  - The watchdog returns `unknown` in the SMTP phase.
  - An op-journal panel (card I3).

### High

#### MR-04: Ctrl+Enter twice, or Enter in the subject, sends the mail (confirmed)
**Status: fixed in I2.** A send gate taken before the first await, no submit button and no implicit submit; covered by an e2e test that fails on the old editor.
- **Where:** `ComposeView.tsx:403` (`send()` has no in-flight guard) and `:545-560`. The editor is a `<form>`
  with a `type="submit"` button, so Enter in the Betreff `<Input>` (~659) submits it. Enter in an empty
  recipient field does too (RecipientField ~167 returns without `preventDefault`).
- **Scenario:**
  - Ctrl+Enter twice, or a key repeat, starts two `sendMail` calls before `setBusy` re-renders, so two mails
    go out.
  - A user who presses Enter after typing the subject sends a half-written mail.
- **Fix:** a `sendingRef` guard at the top of `send()`. No implicit submit: send only via the button and
  Ctrl+Enter.

#### MR-05: `retryOp` on an unknown send resends without the probe (code)
**Status: fixed in I1.** `retryOp` refuses a send that is `unknown` or in the `smtp` phase and points to `resolveOp`.
- **Where:** `core/index.ts:623-631`. It accepts `unknown`, resets it to `pending`, and `doSend` then skips
  `resolveUnknownSend`.
- **Scenario:** today only reachable via the API. Once an op panel exists (MR-03), "Erneut versuchen" sends a
  second copy.
- **Fix:** refuse `retryOp` for `kind === 'send' && state === 'unknown'`. Resolving goes through `resolveOp`.
  Resending is an explicit new mail.

#### MR-06: deleting a folder can destroy mail on the server (code)
- **Where:** `core/write_engine.ts:787-805` (`doFolderDelete`) and `core/index.ts:704-712` (undo of
  `folder_create`).
- **Scenario:** IMAP DELETE removes a folder together with its mails, bypassing Trash. `deleteFolder` checks
  only the local count:
  - that count excludes mails with in-flight moves;
  - it is stale for mail moved in by another client.
  The undo of a `folder_create` journals a `folder_delete` with no check at all. So: create a folder, move mail
  into it, undo the create, and the mail is gone for good.
- **Fix:** `STATUS (MESSAGES)` on the server inside the op, and refuse when it is not 0. Apply the same check,
  including subfolders, in undo.

**Status: fixed in I8 (2026-10-26).** `doFolderDelete` asks the server right before the DELETE: a subfolder in LIST or a `STATUS (MESSAGES)` other than 0 is a conflict (`folder not empty: ...`), and a failed STATUS is retried, never taken as empty. `deleteFolder` and the undo of a `folder_create` share `refuseFolderDelete` (local mail, local subfolders, pending ops), and both throw when the server refused, so the user is told instead of seeing it done. `tests/mail_folder_delete.test.ts` covers both sides.

#### MR-07: the HTML sanitizer is bypassed with `</style >` (confirmed, reproduced by the reviewer)
- **Where:** `core/sanitize.ts:139` (lift-out regex) and `:220` (the CSS pasted back as a raw string).
- **Scenario:** `<style>a{}</style ><form>…<a href="ms-settings:…">…<style>b{}</style>`.
  - The regex reads up to the second `</style>`, so everything in between skips DOMPurify.
  - The browser closes the style at `</style ` (the space is legal), so that markup is live in the reading
    pane: forms, meta, links to any scheme that are missing from the links manifest.
  - Scripts and form submission stay blocked by the iframe sandbox and CSP. With
    `allow-popups-to-escape-sandbox`, a click can still launch a protocol handler. Phishing and UI-spoofing
    are open.
- **Fix:** insert the CSS via DOM (`textContent`) and serialise the document, or reject CSS containing `<`.
  Regression tests for `</style >`, `</STYLE\t>` and nesting.

**Status: fixed in I5 (2026-10-26).** `sanitize.ts` lifts the style blocks with the HTML parser (`liftStyleBlocks`), and the CSS it puts back holds no `<` (`cssWithoutMarkup`). `tests/mail_sanitize.test.ts` covers `</style >`, `</STYLE	>`, `</style
>`, `</style/>`, nesting and an Outlook comment-wrapped block.

#### MR-08: reply and forward text is put into the editor as HTML (confirmed)
- **Where:** `components/mail/composeBody.ts:166`: `if (/<[a-zA-Z/][^>]*>/.test(body)) return body`.
  `ComposeView.tsx:256` puts the result into `innerHTML`.
- **Scenario:** every forward of a sender with a display name contains `Name <a@example.test>`
  (`composeDraft.ts:108`). The whole text is then parsed as HTML: line breaks collapse and `<a@example.test>`
  disappears, so the sent mail has a one-line quote with the addresses missing. A subject or body an attacker
  controls (`<style>…`) restyles the privileged app window, where `style-src 'unsafe-inline'` applies.
- **Fix:** never sniff. Escape plain text always. HTML only from `bodyHtml`, after the compose allowlist.
  Tests for a forward header, `<https://…>` and a literal `<b>`.

**Status: fixed in I5 (2026-10-26).** `toEditorHtml(text, html?)` never sniffs: a plain text is always escaped, a stored HTML body goes through the compose allowlist. `tests/mail_compose_body.test.ts` covers a forward header, `<https://...>`, a literal `<b>` and the round trip.

#### MR-09: the flag sweep reads flags from the wrong folder (confirmed; inherited from the prototype)
- **Where:** `core/sync.ts:1264-1308` (`pollOnce`) and `:1349-1380` (`flagSweep`). `pollOnce` only sends
  STATUS, which selects nothing. `flagSweep` then fetches on whatever mailbox the sync client last selected.
- **Scenario:** IONOS has no CONDSTORE (`docs/mail-client.md:33`), so INBOX is swept on every poll. INBOX rows
  get the flags of the same UIDs in another folder, so read/unread and flagged state flip locally and unread
  counts are wrong. Nothing is written to the server.
  - Not reported from the manual pass. Folders with low UIDs barely overlap INBOX, so verify on the real
    mailbox before ranking it lower.
- **Fix:** take the folder mutex and `getMailboxLock(path, { readOnly: true })` inside `flagSweep`, and check
  UIDVALIDITY. Test with two folders that share UIDs.

**Status: fixed in I4 (2026-10-26).** `flagSweep` runs through `SyncEngine.withSelected`: folder mutex, a read-only lock (EXAMINE) and a UIDVALIDITY check. `tests/mail_mailbox_selection.test.ts` covers two folders that share UID 1.

#### MR-10: the file repair shares the sync connection without a lock and SELECTs on production (code)
- **Where:**
  - `core/index.ts:1345-1376` (`repairMissingFiles`), scheduled in `worker.ts:94-112`;
  - `whenIdleForMaintenance` (`index.ts:1281`) runs `fn()` anyway after its 120 s timeout.
- **Scenario:** two minutes after start, in the middle of a first download, the repair calls `mailboxOpen` on
  the sync client:
  - it takes no mutex and no lock, and it is not `readOnly`, so it sends SELECT and not EXAMINE on the
    read-only account;
  - it does not check UIDVALIDITY.
  A running folder sync then gets the other folder's UID list. It expunges local rows and downloads the wrong
  UIDs under this folder's keys (plausible). After a UIDVALIDITY change the repair points a row at a
  different mail's file (code).
- **Fix:** the folder mutex, `getMailboxLock` with `readOnly`, a UIDVALIDITY check, a gate that skips instead
  of proceeding, and all accounts rather than only the active one.

**Status: fixed in I4 (2026-10-26).** The repair fetches through `withSelected` per folder, skips a folder whose UIDVALIDITY changed, and covers every account. The maintenance gate returns `false` on timeout and the worker skips the round.

#### MR-11: the invoice mail (C1) garbles umlauts (confirmed)
- **Where:** `main/index.ts:195` encodes the draft as UTF-8 base64. `pages/MailWindowPage.tsx:51` decodes it
  with bare `atob()`, which is Latin-1.
- **Scenario:** "über" in the template arrives as "Ã¼ber" at the customer. The C1 e2e test never asserts the
  body.
- **Fix:** `new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)))`, plus an e2e assertion
  on the body text.

**Status: fixed in I7 (2026-10-26).** `composeRequest.ts` decodes the draft's bytes with `TextDecoder('utf-8', { fatal: true })`. `tests/mail_compose_request.test.ts` covers "Grüßen" and the en dash; the C1 e2e asserts an umlaut of the template in the delivered body (as a boolean).

#### MR-12: C1 sends from the first sandbox account (confirmed)
- **Where:** `main/index.ts:535`: `listMailAccounts().find((a) => a.kind === 'sandbox')`.
- **Scenario:**
  - If that account is the local Mailpit sink, the invoice is marked "emailed" with a Message-ID although the
    customer received nothing.
  - If it is the canary, every customer address is refused (`sendRefusal`).
  - In production there is no writable account, so the feature cannot be used.
- **Fix:** an explicit sending account in the settings, validated in main as writable for that recipient,
  failing closed with a clear message. Product-wise this depends on the canary going to phase 2 (section 7).

**Status: fixed in I7 (2026-10-26).** Einstellungen › E-Mail › "Senden von" stores `invoiceMailAccountId`. `invoice:email` validates it in main before anything is written (`invoiceSendAccount`: none chosen, deleted, `writeRefusal`, `sendRefusal` for the recipient) and fails closed with the reason. Production stays unusable until the canary reaches phase 2.

#### MR-13: the account signature (B8) is never shown and is wiped on save (confirmed)
**Status: fixed in I10.** `toDto` carries `signature` again, and a save that omits it keeps the stored one (an explicit empty string clears it). Round-trip tests in `tests/mail_account_signature.test.ts`, each with a mutation check.
- **Where:** `mailclient/accounts.ts:129-139`: `toDto` leaves out `signature`. `:191` saves
  `input.signature`, which is undefined when the form had no value.
- **Scenario:** the renderer reads `account.signature` (MailPage ~509, MailWindowPage ~164/227,
  MailAccountsCard ~132) and always gets undefined:
  - new mails never carry the signature;
  - opening and saving the account form deletes it.
  Broken since `a0171c6`. Only the pure `withSignature` helper is tested.
- **Fix:** put `signature` in the DTO. A round-trip test: create, read, save without signature, signature still
  there.

#### MR-14: an invoice mail can go out without the invoice PDF (confirmed)
- **Where:** `ComposeView.tsx:428-437`. If `readComposePdf` returns `''` (the file moved, a read error), the
  attachment is skipped silently. `main/index.ts:568-575`.
- **Fix:** a missing PDF is a hard error for an invoice mail. Better: main attaches the PDF itself instead of
  a base64 round trip through the renderer.

**Status: fixed in I7 (2026-10-26).** Main attaches the PDF itself (`mail.sendInvoice` → `sendInvoiceMail`). A PDF that cannot be read or is empty stops the send before anything is queued.

#### MR-15: draft-save replay protection does nothing in production (code)
**Status: fixed in I1.** The probe runs when the op has been attempted before (`attempts > 0`), and `saveDraft` journals the Message-ID.
- **Where:** `core/index.ts:988-998`: `saveDraft` never passes `messageId` to `journalEnqueue`, so
  `findDraftByMessageId` returns null at once (`write_engine.ts:1160`). `journalBumpAttempts` is never called.
- **Scenario:** APPEND done, journal update lost (a crash or a close), so the replay appends a second copy.
  `mail_draft_replay.test.ts` sets `messageId` directly and never goes through `saveDraft`, which is why it is
  green.
- **Fix:** journal the built Message-ID. Call `journalBumpAttempts`. Test through `saveDraft`.

#### MR-16: the watchdog's "do not release the mutex" is not true (code)
**Status: fixed in I1.** The watchdog keeps the mutex until the abandoned body settles, and `close()` drains the op in flight (bounded).
- **Where:** `core/write_engine.ts:238-247` and `core/sync.ts:196-201`.
- **Scenario:** after `late`, `withWatchdog` returns, so `withFolderMutex`'s `finally` sees a matching owner
  token and deletes the entry. Sync takes the folder while the abandoned body still runs and applies local
  effects. `execute` also drops the client the body is using. The owner-token test covers only a replaced
  holder.
- **Fix:** keep the mutex for real (resolve a separate promise for the caller), or correct the comment and the
  design. The SMTP-phase part is in MR-03.

#### MR-17: the test gate is red (confirmed)
**Status: fixed in I9 (2026-10-26).** The two-account case now logs its imapflow clients out before
closing a fake server, so no socket is reset under a live client and `pnpm test` exits 0. Verified twice in
a row, and the fix is not a swallowed error: reverting it brings the unhandled ECONNRESET straight back.
- **Where:** `tests/mail_write_guard.test.ts:140` closes the second fake server while an imapflow client is
  still connected. `read ECONNRESET` is an unhandled error, so `pnpm test` exits 1 (673 passed, 2 skipped,
  1 error).
- **Fix:** log the clients out before closing the servers. CI (`.github/workflows/ci.yml`) is red with this,
  on any OS.

#### MR-18: the canary e2e spec cannot pass and is safe only by accident (code)
**Status: fixed in I6 (2026-10-27).** The spec moved to `tests/e2e-canary/` with its own `playwright.canary.config.ts`, so `npx playwright test` no longer finds it. It skips unless `BOOKINGIUM_CANARY=1`; once that is set it needs `BOOKINGIUM_E2E_USER_DATA` and fails on a wrong setup. It finds the account through `listAccounts` by mode `canary` (exactly one), selects it, and sends its requests in the shape `mail-client.spec.ts` uses. The core reported a canary as `sandbox`, because `accountMode` read the flag from the sync config, which never carried it; it now reads the write account. The spec itself was not run.
- **Where:** `tests/e2e/mail-canary.spec.ts`. It uses the account id `'canary'`, but ids are `randomUUID()`
  (`accounts.ts:183`), and `getAccount()` takes no parameter. `.catch(() => null)` turns every error into a
  skip.
- **Scenario:** a plain `npx playwright test` includes the spec. If someone "fixes" the id lookup, every full
  e2e run against a copy of the real profile sends through the real provider. Only `sendRefusal` (own address)
  still stands in between.
- **Fix:**
  - an explicit opt-in (`BOOKINGIUM_CANARY=1`);
  - find the account by its flag;
  - fail rather than skip when the opt-in is set but the setup is wrong;
  - keep it out of the default `testDir`.

### Medium

#### MR-19: the write connection is a third connection, and a half-open socket stops the queue (code)
**Status: fixed in I15a (2026-10-27).** Sync, IDLE and the write connection share one `ConnectionBudget` per account. A write asks for its slot as urgent, and the IDLE connection gives its slot back and catches up when it returns. The write connection answers a NOOP (10 s) before reuse, logs out after 30 s idle, uses `IMAP_TIMEOUTS`, and is closed without a LOGOUT when the watchdog gives up, so a hung op settles as `failed`. `tests/mail_connections.test.ts`.
- **Where:** `core/write_connection.ts` and `core/write_guard.ts:179-190`. Sync caps itself at 2 (sync + IDLE);
  the write pool holds a third one with no idle timeout. `connectWriteImap` does not use `IMAP_TIMEOUTS`, so
  imapflow's ~5 min applies.
- **Scenario:**
  - On the canary this breaks the "at most 2 connections" rule.
  - After sleep or wake, `usable` stays true on a dead socket. The next op hangs until the watchdog, comes back
    `late`, and the queue stops: "restart bookingum". This is likely on laptops.
- **Fix:** an idle timeout and a NOOP before reuse, `IMAP_TIMEOUTS`, closing the client on abort, and counting
  the pool against `maxConnections`.

#### MR-20: canary admission is enforced only in the renderer (code)
**Status: fixed in I6 (2026-10-27).** Main decides when an account is saved (`settingsRefusal`, also checked by the router before the connection test): a sandbox kind on a non-loopback host is accepted only as the canary, SMTP needs encryption off loopback for every kind, and a packaged build admits a canary only with `BOOKINGIUM_ALLOW_CANARY=1` (also when the worker starts). The flag ends when host, port, user, address, SMTP host or SMTP port changes, and unchecking it revokes it; either way the account is saved read-only. The address is now part of the admission, so `sendRefusal` compares against an address the user confirmed. The allowlist is loopback only. The core treats any account the guard refuses as read-only with the production pacing, and `writableEntry` asks the guard before an op is journaled. Tests in `tests/mail_canary_save.test.ts` and `tests/mail_canary_main.test.ts`.
- **Where:** `api/routers/mail.router.ts:35-53`, `accounts.ts:175-196` and `core/write_guard.ts:117-129`.
- **What's wrong:**
  - **Main trusts the renderer.** Main accepts `kind: 'sandbox'` and `canary: true` for any host, in any
    build; the DEV-only gate lives in `MailAccountsCard`. A canary is writable for everything: flags, moves,
    empty Trash, folder delete and send.
  - **Changing the account keeps the flag.** Changing host or user gives a new id but keeps the flag when the
    form sends it, so a different real mailbox becomes writable without a new confirmation.
  - **`sendRefusal` relies on a free-text field.** It compares against `account.email`, which the user can
    type in, so "own address only" holds only by convention.
  - **SMTP security is never checked.** `smtpSecurity` is not validated against `allowsPlainLogin(smtpHost)`,
    so AUTH can go out in cleartext on a real host (`accounts.ts:142-153`).
  - **The allowlist includes DNS names.** `sandbox-dovecot` and `sandbox-mailpit` get
    `rejectUnauthorized: false`.
  - **`writableEntry` accepts too much.** It journals ops for a sandbox-kind account on a real host without
    the flag. They wait and would be sent once the flag is set later (MR-02 makes them stick).
- **Fix:**
  - Main refuses sandbox kind on a non-loopback host without the canary, and the canary in packaged builds
    unless a main-side switch allows it.
  - Clear the flag on any change of host, port, user or email.
  - Check SMTP security in main.
  - `writableEntry` asks `writeRefusal`.
  - See section 6 for the design decision.

#### MR-21: the compose-PDF guard registers itself (code)
- **Where:** `main/index.ts:176-219`. `openComposeWindow` adds `input.pdfPath`, taken from the renderer, to
  `composePdfs`. `:568` then reads any registered path.
- **Scenario:** renderer code that can run (see the design note on `window.electron`) reads `accounts.json` or
  any other file via `mail:composeWindow` plus `mail:readComposePdf`. The set never shrinks.
- **Fix:** register only in the `invoice:email` handler that wrote the PDF. Pass an opaque token, and remove
  it after use.

**Status: fixed in I7 (2026-10-26).** `mail:composeWindow` and `mail:readComposePdf` are gone. Only `invoice:email` registers a compose, under a random token, with the path it wrote; the window gets the token and the file name. `sendInvoice` honours a token only for the account it was opened with, and the token is released when the window closes.

#### MR-22: remote images have no body timeout, no streaming size cap and no LAN filter (confirmed)
- **Where:** `core/remote_images.ts:53-78`. The timer is cleared once the headers arrive. `arrayBuffer()` has
  no limit, and the size is checked only afterwards. `redirect: 'follow'` with no private-IP check. The URLs
  come from the renderer, not from the stored manifest.
- **Scenario:** an endless image response makes the worker run out of memory. A crash loop then triggers the
  crash lockout. "Bilder laden" sends GETs to `192.168.x.x` or the router.
- **Fix:**
  - keep the timer running through the body;
  - a byte cap while streaming, and a Content-Length check;
  - block private ranges on every redirect hop;
  - take the URLs from the message in main.

**Status: fixed in I11 (2026-10-26).** `core/remote_images.ts` uses `http`/`https` with its own DNS lookup: every answer must be public (loopback, private, link-local, CGNAT, multicast and reserved ranges are refused, IPv4-mapped IPv6 included), literal IPs are checked per hop, redirects are followed by hand (at most 5, http(s) only), a declared Content-Length over the cap is refused, the body is read under a streaming byte cap, and the per-image timer covers the body. `loadRemoteImages` fetches only URLs the stored mail's manifest lists. `tests/mail_remote_images_guard.test.ts`, plus a wiring test.

#### MR-23: opening an attachment: no Mark-of-the-Web, an incomplete executable list, RTLO (code)
- **Where:** `api/routers/mail.router.ts:140-178` and `mailclient/attachments.ts`.
- **What's wrong:**
  - **No Mark-of-the-Web.** Temp files open without a Zone.Identifier, so there is no SmartScreen and no Office
    Protected View for `docm`/`xlsm`.
  - **The executable list has gaps.** It is missing `url`, `cpl`, `msc`, `wsf`, `chm`, `iso`, `img`, `vhd(x)`,
    `msix`, `appinstaller`, `settingcontent-ms`, `html`/`svg` and more.
  - **The renderer decides.** The filename and `openAnyway` come from the renderer.
  - **RTLO is not stripped.** U+202E stays in the name, so a name can disguise its real extension.
- **Fix:** write `Zone.Identifier` (ZoneId=3). An allowlist of safe types; everything else goes to "Speichern
  unter". Take the name from the stored metadata. Strip bidi characters. Confirm in main.

**Status: fixed in I11 (2026-10-26).** "Öffnen" hands only an allowlist of types to the OS (`SAFE_TO_OPEN` in `attachments.ts`); anything else gets a native dialog in main that offers "Speichern unter …" only. The name comes from the stored attachment metadata, not from the renderer, and bidi/invisible characters are stripped. The temp file gets a `Zone.Identifier` (ZoneId=3) before it is opened; if that write fails, nothing is opened. `openAnyway` is gone. `tests/mail_attachments.test.ts` and the e2e attachment test (which reads the stream on Windows).

#### MR-24: `uid_next` is max(UID)+1, and every poll compares it with the server's UIDNEXT (code)
- **Where:** `core/sync.ts:747-750` and `:643` write it. The incremental sync never updates it. `:1280`
  compares.
- **Scenario:** every folder whose newest mail was moved or deleted (Drafts after sending, Trash after
  emptying, empty folders) never matches again. It is fully resynced every 120 s: SELECT plus `UID FETCH 1:*`.
  That is constant load on IONOS and counts toward the circuit breaker. The number of affected folders on
  production is unmeasured.
- **Fix:** store `mailbox.uidNext` from SELECT, in both the full and incremental paths.

**Status: fixed in I4 (2026-10-26).** `uid_next` is the server's UIDNEXT on the full, the incremental and the validity sync.

#### MR-25: disk full stops only the current full sync (code)
- **Where:** `core/sync.ts:1087-1091` sets `diskFull`. Only `resume()` reads it (306).
- **Scenario:** poll, IDLE and `startPolling` keep downloading. Each file fails half-way, the status flips
  between "disk full" and "idle", and `lastSyncAt` keeps moving (`pollOnce` calls `noteSuccess` after errors
  it swallowed).
- **Fix:** check `diskFull` in poll, IDLE, `syncFolder`, `syncAll` and repair. No `noteSuccess` when every
  folder failed.

**Status: fixed in I4 (2026-10-26).** A full disk stops poll, IDLE, `syncFolder`, `syncAll` and the repair. A poll in which no folder answered is not server contact (L3).

#### MR-26: corrupt-store recovery catches only damage to page 1 (code)
**Status: fixed in I12 (2026-10-27).** Every statement is watched; the first corruption error writes a `.check` marker, and the next open (or one after an unclean shutdown) runs `PRAGMA quick_check` and quarantines on failure. Extended codes, `SQLITE_IOERR_SHORT_READ` and the `cause` chain are matched. Each account opens in its own try/catch, and corruption found by the contacts backfill reopens (and rebuilds) that account once. A rebuild salvages the file map into `relinks` (migration 3) and adopts `.eml` files whose size matches instead of downloading them. `.corrupt-*` files are still kept. `tests/mail_store_integrity.test.ts`.
- **Where:** `core/store.ts:134-148`, `core/store_recovery.ts` and `core/migrations.ts:54-58`.
- **What's wrong:**
  - **Detection works only at open.** It triggers only when opening throws. A damaged data or FTS page opens
    fine, and every later query then fails with `SQLITE_CORRUPT`, with no recovery.
  - **The error code is lost on the way.** `runMigrations` wraps errors without `code`, so corruption reached
    during a migration is not recognised.
  - **One bad account stops all.** `backfillContactsOnce` runs inside the accounts loop (`index.ts:167-171`),
    so one corrupt account stops every account from loading.
  - **Extended codes are missed.** Extended codes such as `SQLITE_CORRUPT_VTAB` are not matched (plausible).
  - **Recovery itself is expensive.** It re-downloads about 14 GB. All old `.eml` files become orphans and are
    kept for 7 days, so disk use roughly doubles, which leads into MR-25. `.corrupt-*` files are never cleaned
    up.
- **Fix:**
  - `PRAGMA quick_check` after an unclean shutdown;
  - match `code?.startsWith('SQLITE_CORRUPT')` and look at `cause`;
  - a try/catch per account;
  - re-link surviving `.eml` files instead of downloading them again.

#### MR-27: search: the prefix cap misses capitalised words, an all-capped query returns everything, operators alone throw (code)
- **Where:** `core/store.ts:664-700` and `core/index.ts:397-416`.
- **Scenario:**
  - `fts_vocab` holds folded terms, but the probe uses `'Ver'`, so nothing is capped. German nouns are
    capitalised, so the 5-10 s worker stalls from 2026-10-23 come back.
  - If every term is capped, `matchExpr` is `''`, and search returns all mail with no text filter.
  - "NOT" or "x OR" alone produce an invalid MATCH, so the search throws.
- **Fix:** lowercase and fold the probe word like the tokenizer. An empty expression returns no hits. Drop
  bare operators.

#### MR-28: mail linking: full rescans, missed mail after a rebuild, dismissed links come back (code)
- **Where:** `services/MailLinkService.ts:278-290` and `:156-170`; `main/index.ts:675`.
- **What's wrong:**
  - **A deleted cursor row forces a full rescan.** `storeHasRowAt` needs a row exactly at the cursor. If that
    mail was deleted, the cursor goes back to 0, and the whole mailbox is rescanned synchronously in the main
    process, with no transaction per batch: a UI freeze of seconds.
  - **A rebuilt store can be missed.** One with a row at that id is not recognised as rebuilt, so new mails
    are never linked.
  - **Dismissed owners come back.** `threadOwners` ignores `dismissed`, so a link the user dismissed returns
    with every reply.
  - **Errors are swallowed and some Sent folders are skipped.** Linker errors are swallowed without a log.
    Only INBOX and paths matching `*SENT` are linked, so "Gesendete Objekte" is skipped.
- **Fix:**
  - key the cursor by store generation plus id, with `<=` semantics;
  - one transaction per batch, yielding between batches;
  - filter out dismissed owners;
  - log errors;
  - use special-use `\Sent`.

#### MR-29: optimistic effects stay until the next restart (code)
**Status: fixed in I3.** A failed flag, move, delete, expunge or draft delete, and a send with only filing left, is retried while the account is online (1 minute, doubling, at most 15). A refused login is never retried. The op panel lists what is waiting, rejected or stuck; discarding an op resyncs its folders, so the optimistic effect gives way to the server.
- **Where:** `core/index.ts:590-595`: `failed` goes back to `pending`, and the only retry is at `start()`.
- **Scenario:** a failed move keeps the mail hidden (`listByFolder` excludes it), and a failed flag keeps its
  local value, sometimes for hours. The replay then runs against a mailbox that has changed since.
- **Fix:** a retry with backoff, or roll the effect back on `failed` and show it (op panel, card I3).

#### MR-30: transient errors become terminal conflicts (code)
**Status: fixed in I15a (2026-10-27).** A conflict needs the server's own NO with NONEXISTENT, TRYCREATE or no code. A NO with a transient code, a BYE, a timeout or a closed socket is `failed`, and the client is dropped. `tests/mail_connections.test.ts`.
- **Where:** `preflight` (`write_engine.ts:303-368`) and `preflightBatch` (616-623).
- **Scenario:** every `mailboxOpen` error, including a socket reset, becomes the conflict "folder gone". The
  connection is kept after a conflict.
- **Fix:** separate NONEXISTENT/TRYCREATE from network errors; network errors return `failed` and drop the
  client.

#### MR-31: renaming a folder races with the folder list, and a crash leaves the op stuck (code)
- **Where:** `write_engine.ts:752-781`, `store.ts:279-316` and `sync.ts:479-491`. `syncFolderList` takes no
  mutex.
- **Scenario:**
  - A LIST between RENAME and the re-key, or a crash before the re-key, creates a row for the target.
  - `rekeyFolder` then fails on the primary key, so the op is `failed` and goes back to `pending`.
  - `refusePendingOpsIn` then blocks every folder op in that subtree, and the folder is downloaded a second
    time.
  - Subfolders are not locked.
- **Fix:** make the re-key merge into an existing target row, have the sync skip paths with a pending rename,
  and lock the subtree.

**Status: fixed in I4 (2026-10-26).** The re-key merges into an existing target row, the folder list and `syncFolder` skip paths under a journalled rename, and the write engine locks both subtrees. A rename stuck in `pending` pauses that subtree until the op is resolved.

#### MR-32: resuming a batch move can mark it done wrongly (code)
**Status: fixed in I15a (2026-10-27).** The target's UIDNEXT is journaled before a MOVE or COPY. A batch resumes only when every source UID is gone, every member has a Message-ID, and each one is found exactly once at or above that UIDNEXT, on distinct UIDs. The single move follows the same UIDNEXT rule, and ops journaled before I15a are not resumed. `tests/mail_batch_move.test.ts`, `tests/mail_connections.test.ts`.
- **Where:** `write_engine.ts:559-563` and `:670-697`; `resumeHalfMoved` (814).
- **Scenario:** after any preflight failure, the target is searched by Message-ID and `found[0]` is taken. A
  copy that was already there (a list mail, a CC duplicate) marks the op `done`. Local rows are re-keyed to
  someone else's UID, and members without a Message-ID are dropped silently.
- **Fix:**
  - resume only when every source UID is gone;
  - require every member to be found;
  - accept only UIDs at or above the recorded UIDNEXT.

#### MR-33: the connection test sends the stored password to any host (code)
- **Where:** `api/routers/mail.router.ts:115-128`.
- **Scenario:** a test with an `id` and no password uses the stored password against the host and port in the
  form. A typo in the host sends the IONOS password elsewhere.
- **Fix:** use the stored password only when host, port and user match the stored ones. Otherwise ask for it.

**Status: fixed in I11 (2026-10-26).** `storedPasswordFor` returns the stored password only when host, port and user match the stored account; otherwise the test asks for one. Saving an account that changes host, port or user without a new password is refused ("Passwort fehlt"). `tests/mail_host_hardening.test.ts`.

#### MR-34: path traversal in `invoice:email` (pre-existing, code)
- **Where:** `main/mail/openEmail.ts:136-137`: `` join(folder, `${fileName}.pdf`) `` with `fileName` from the
  renderer.
- **Fix:** `safeAttachmentName`, then check that the resolved path is inside the folder. An invoice name
  containing `/` fails today.

**Status: fixed in I11 (2026-10-26).** `openEmail.ts` cleans the name with `safeAttachmentName` and builds the pdf, eml and txt paths with `safePathIn`, which throws when the result would leave the folder. `tests/mail_host_hardening.test.ts`.

#### MR-35: the renderer can start writes on a read-only account (confirmed)
**Status: fixed in I10.** The rule moved to `components/mail/readingActions.ts`; both pages derive from it and pass no write callback on a read-only account. `tests/mail_readonly_actions.test.ts`.
- **Where:** `components/mail/MessageView.tsx:350-363` and `:523-541`. `MailPage.tsx:1295` and
  `MailWindowPage.tsx:226` always pass `onWriteTo`.
- **Scenario:** clicking a sender on the production account opens an editor. The autosave fails silently
  (`.catch(() => undefined)`, ComposeView 308), and the typed text is lost at the end.
- **Fix:** pass `onWriteTo` only when `canWrite`.

#### MR-36: archiving inside Archive hides mails until a restart (confirmed)
**Status: fixed in I10.** `components/mail/archiveActions.ts`: the action filters its ids, is hidden when nothing qualifies, every uncovered hidden mail is shown again, and the toast counts what the core archived. `tests/mail_archive_actions.test.ts`.
- **Where:** `MailPage.tsx:643/668/1292`: `hasArchive` is global. `core/index.ts:477-479` skips self-moves and
  returns `[]`. The G7 release effect only shows a mail again once it has left the list.
- **Scenario:** "Archivieren" in Archive shows "Archiviert", the mails disappear and do not come back until an
  account switch or a restart. A mixed selection does the same.
- **Fix:** filter like `trashable`, and hide the action in Archive. In `moveAway`, show again every id that no
  returned op covers.

#### MR-37: global shortcuts ignore dialogs and buttons (code)
**Status: fixed in I10.** `shortcutBlocked()` in `shortcuts.ts` covers dialogs, alert dialogs, menus, popovers, the compose form and an open editor. `tests/mail_shortcuts_guard.test.ts`.
- **Where:** `components/mail/shortcuts.ts` (`isTypingTarget`) and the `MailPage.tsx` keydown effect
  (842-895).
- **Scenario:** Entf while focus is on a confirm dialog, a popover or a compose button moves the selected list
  mail to Trash. Ctrl+N or Ctrl+R on a compose button replaces the open editor.
- **Fix:** return early for `[role=dialog]`, `[role=alertdialog]`, the compose area, and while compose is
  open for destructive keys.

#### MR-38: autosave races with send and re-uploads every attachment (code)
**Status: partly fixed in I2.** No draft save while a send is in flight or unclear. Hashing attachments for the dirty check is still open.
- **Where:** `ComposeView.tsx:304-312` and `:403-454`; `toDraftInput`.
- **Scenario:**
  - The autosave timer fires during `sendMail` and appends a new draft after the send, an orphan in Entwürfe.
  - Every save carries all attachments as base64 over IPC and APPEND, and `isDirty` stringifies them on every
    check. With 10-20 MB attached, typing is sluggish and each save is a multi-MB APPEND.
- **Fix:** stop the timer and refuse saves while sending. Hash attachments for the dirty check.

#### MR-39: the IDLE wait leaks timers (confirmed)
**Status: fixed in I15a (2026-10-27).** One check interval and one cap timer, both cleared by the same `done()` (`idleWait` in `core/sync.ts`). `tests/mail_connections.test.ts`.
- **Where:** `core/sync.ts:1190-1196`. On a `dirty` wakeup only `poll` is cleared. `stopCheck` (500 ms) and
  `cap` (25 min) keep running.
- **Scenario:** after a day with many IDLE events, hundreds of 500 ms intervals run in the worker.
- **Fix:** one `done()` that clears all three.

#### MR-40: every core event reaches the renderer twice (confirmed)
**Status: fixed in I15a (2026-10-27).** `core.on(name, cb)` delivers only events of that name, and the worker subscribes to each name once. `tests/mail_connections.test.ts`.
- **Where:** `core/index.ts:111`: `on()` ignores the name. `worker.ts:47-49` subscribes twice.
- **Fix:** filter by name or subscribe once.

#### MR-41: the UIDVALIDITY swap cannot resume, and nothing guards against mass expunge (code)
**Status: fixed in I12 (2026-10-27).** An expunge of 20 or more messages that is over 20 % of the folder needs EXAMINE's EXISTS to agree with the UID list, in full sync, incremental sync and the swap. Staging survives a failed pass, the next pass downloads only what is missing, and staged rows are hidden from folders, cross-folder search, facets and threads. Also fixed: staged rows had been inserted into the real folder. `tests/mail_store_integrity.test.ts`.
- **Where:** `core/sync.ts:620-676`.
- **What's wrong:**
  - An interrupted swap throws away all staged data. On a flaky connection a large INBOX can restart forever.
  - An empty or truncated `UID FETCH 1:*` deletes all local rows and files of the folder, with no sanity
    check.
- **Fix:** refuse to expunge more than X % of a folder in one pass unless EXAMINE's EXISTS confirms it. Make
  the staging resumable.

#### MR-42: `storeMessage` can leave a row without its file (code)
**Status: fixed in I12 (2026-10-27).** The contacts upsert runs after the insert, in its own try/catch that only warns. `tests/mail_store_integrity.test.ts`.
- **Where:** `core/sync.ts:962-1002`. `insertMessage` commits, then `rememberContactsOf` runs in the same
  `try`, and its catch deletes the file.
- **Fix:** put the contacts upsert in the insert transaction, or outside the try as non-fatal.

#### MR-43: a mail that was sent but not filed is reported as sent and never filed (confirmed)
**Status: fixed in I1.** Phase `sent` makes filing into Sent its own retry, which never resends.
- **Where:** `core/write_engine.ts:1036-1049`. The op becomes `done` with the reason "will file, not resend",
  but nothing ever appends to Sent again. `sendMail` reports success.
- **Fix:** a separate `file_sent` op, or a retry of the APPEND only, plus a note in the UI.

### Low
- **Renderer:**
  - `hiddenIds` survive an account switch (`MailPage.tsx:936-945`).
  - Reopening a saved draft loses its formatting (`composeDraft.ts` sets `bodyHtml: null`).
  - `MailWindowPage` spins forever when `getDraft` fails (114-128).
  - `addFiles` does not set `edited.current`.
  - The preset PDF is not counted against `MAX_ATTACHMENT_BYTES`.
  - `search.pdfName` is threaded through but never used.
  - Events of other accounts are dropped, and sync events don't invalidate `search`.
  - The signature is applied twice (`MailPage.tsx:1295`, harmless).
  - Reader icon buttons lack `aria-label`.
  - The keyboard effect re-subscribes on every render.
- **App:**
  - `InvoiceForm.tsx:182-186` loads only the first 100 non-archived events. An invoice for an archived or
    older event shows an empty selection, and the e-invoice check reads `eventDate` as null.
  - The renderer bundle is one 3.3 MB chunk.
- **Core:**
  - The instance lock has no `O_EXCL`, and Windows PID reuse can block for 7 days. The header promises a
    SQLite backstop and an exit handler; neither exists.
  - `connection_test.ts:63` opens a third connection.
  - `pollOnce` calls `noteSuccess` when every STATUS failed (H1's fix moves the time without real contact).
  - `getSyncStatus` runs a full table scan plus a `readdir` of about 32k files on every status poll
    (`index.ts:261`/`1381`).
  - `close()` does not cover syncs started by poll or IDLE, and timers survive it.
  - `console.log` in `store.ts`, against the folder's own rule.
  - LIKE filters do not escape `%` and `_`.
- **Write path:**
  - With a partial COPYUID the move happened but the op is a conflict, and undo is impossible
    (`write_engine.ts:588-596`).
  - A resume after the local apply loses `newKey`.
  - The 500-mail chunks of a batch are not atomic together.
  - The ambiguity regex misses `EPIPE`, `ENETRESET` and bare `ETIMEDOUT` (1025).
  - `storeAppendedDraft` compares UIDVALIDITY with itself (G6).
  - `undoOp` can run twice.
- **Host:**
  - `closing` is never reset after a held close fails.
  - Compose windows are not in `mailWindows`, so the app keeps running after the main window closes.
  - Closing during a send can report `sent: false` before `composeSent`, so the invoice is not marked.
  - macOS Cmd+Q stops the worker before drafts are saved.
- **Migrations:**
  - 0011-0014 have no meta snapshots.
  - The `mail_link` coalesce unique index is not in `schema.ts`, so a future `db:generate` may drop it.

---

## 3. Design weaknesses

1. **The send state lives in three places.** `state`, `payload.phase` and the Sent probe each hold part of it,
   and replay reads only the first. One `send_phase` column with guarded transitions would make "never resend
   after SMTP started" structural instead of a convention (MR-01, MR-03, MR-05).
2. **Errors are classified per op, by where the `try` happens to be.** One wrapper in `execute` that maps every
   exception to `failed` or `unknown` by phase would remove the MR-02 class of bugs.
3. **The folder mutex is not authoritative.** The watchdog cannot keep it (MR-16), and the folder list, the
   flag sweep and the repair ignore it (MR-09, MR-10, MR-31). Every user of a selected mailbox should go
   through one `withSelected(path, readOnly, fn)` helper.
4. **Admission is spread over four places:** `kind`, the `readOnly` builder, `writeRefusal` and the renderer's
   DEV gate. `writableEntry` should ask `writeRefusal`, and main should own the decision (MR-20).
5. **The renderer is more privileged than it needs to be.** Preload exposes `window.electron` (generic
   `ipcRenderer.invoke/send` on any channel, `preload/index.ts:81`), and the windows run with
   `sandbox: false`. The per-channel API in `window.api` is therefore not a boundary. CSP blocks scripts today;
   one bypass would reach every `ipcMain` handler (MR-21, MR-34).
   **I11 (2026-10-26):** `window.electron` is no longer exposed; the renderer has only `window.api`. `sandbox: false` remains.
6. **Optimistic UI without a way back.** Hidden mails and flags rely on the op eventually succeeding. There is
   no rollback, no periodic retry and no place where the user sees what is stuck (MR-29, MR-36).
7. **`MailPage.tsx` (1313 lines) and `core/index.ts` (1474 lines) are past the size where review catches
   ordering bugs.** The keyboard effect, the optimistic release effect and the compose lifecycle would be
   easier to test as hooks.
8. **The invoice flow (C1) is built on a test account.** Real invoice sending needs a production write path,
   which the plan does not allow yet. The feature is wired but cannot be used for its purpose (MR-12).

---

## 4. Tests and CI

**Gates on 2026-10-26 (Windows):**

| Gate | Result |
|---|---|
| `pnpm test` | **exit 1**: 92 files, 673 passed, 2 skipped (no KoSIT or veraPDF), 1 unhandled ECONNRESET (MR-17) |
| `pnpm lint` | exit 0, 0 errors, 44 warnings (43 prettier in new tests) |
| `pnpm typecheck` | exit 0 |
| `pnpm build` | exit 0 |
| `npx playwright test` | **not run.** It mutates the shared sandbox, and the canary spec has no opt-in (MR-18). |

**CI** (`.github/workflows/ci.yml`):
- **Ubuntu only.** There is no Windows job for a Windows-first app.
- **Test, lint, typecheck and build, no e2e.** The sandbox suites skip under `CI`, so green CI proves nothing
  about crash safety or sending.
- **The better-sqlite3 ABI is unverified.** `postinstall` rebuilds it for Electron, while vitest runs under
  Node. One CI run on the branch settles it.

**Tests that prove less than they say:**
- **`mail_crash_points.test.ts`.**
  - It kills no process and starts none (header, lines 2-4).
  - It leaves its mail in CrashB.
  - Test 2 passes with 0 deliveries and when Mailpit is unreachable.
  - Test 1 never checks that the source copy is gone.
- **`mail_draft_replay.test.ts`.** It never goes through `saveDraft` (MR-15).
- **`mail_store_recovery.test.ts`.** It damages only page 1 (MR-26).
- **`mail_disk_full.test.ts`.** It stubs the download and checks one `syncAll` (MR-25).
- **`mail_sync_time.test.ts`.** It asserts that the time moves, which is exactly the wrong behaviour of L3.
  **Fixed in I4:** it now also asserts the time does NOT move when no folder answered.
- **`helpers/fakeImap.ts`.** It advertises `UIDPLUS` and `MOVE` and answers every unknown command with `OK`,
  so any future move test using it passes falsely.
- **`helpers/fakeSmtp.ts`.** It advertises `AUTH LOGIN` but accepts it without credentials.
- **`mail-client.spec.ts`** (2050 lines, about 40 tests).
  - It is order-dependent: the first test deletes all accounts.
  - Data-dependent skips (around line 1369) can mean it never runs.
  - Cleanup errors are swallowed.
  - It uses fixed sleeps.

**Missing entirely:**
- `flagSweep`, `repairMissingFiles`, `sweepOrphans` and `whenIdleForMaintenance`;
- replaying a `running`/`smtp` send, `retryOp` on `unknown`, and a connect failure in any op;
- the watchdog `late` path with the mutex;
- a non-empty folder delete and undo of a create;
- the rename re-key with an existing target;
- a batch resume with a duplicate at the target;
- the canary refused in main;
- any renderer component test (only pure helpers are tested).

---

## 5. What the prototype evidence covers

Task 6 (`REPORT6.md`) is strong evidence *for the prototype core*: F1 to F6 were fixed, the 2000-seed × 30-op
fuzz is clean on both profiles (5.2 h and 16.7 h), and the 2-hour soak showed zero drift. Two things remain
open even there:

- The soak's own verdict is `SOAK FAIL invariantFails=1` (one transient orphan that healed itself).
- Seed 33 failed 1 of 20 runs on profile B, and the failing invariant was never captured.

It does not carry over to bookingum, because bookingum's core has gone its own way since the port:
- one write connection reused per op chain (G2);
- optimistic hiding and released effects (G4 to G7);
- folder create, rename, delete and move (B1);
- batch UID MOVE (B4);
- opaque random file names (A3);
- the canary, C1 sending, store recovery and disk full.

Several findings here sit exactly in those parts (MR-01, MR-02, MR-16, MR-19, MR-31, MR-32). MR-09 sits in code
that both share, and the fuzz did not find it, because a flag sweep on the wrong mailbox does not break any
invariant the fuzz checks.

**bookingum has no fuzz or soak harness of its own.** Porting the prototype's op generator and invariant
checker to `tests/` (against the sandbox, nightly rather than in CI) is the one step that would give the
port the same kind of evidence.

---

## 6. Process and governance

- **The canary is not what was approved.** Card A7 part 2 approved one constant `CANARY_ACCOUNT_ID` in
  `write_guard.ts`, "never from the UI". `8ca6fd4` replaced it with a flag and a danger toggle in the account
  dialog. The `write_guard.ts` header still describes the constant. Either sign the new design off explicitly
  and enforce it in main (MR-20), or go back to the constant.
  **Decided 2026-10-27:** the user signed off the flag and the danger toggle in the account dialog, enforced
  in main. I6 did the enforcing; the `write_guard.ts` header records the decision.
- **Phase-2 writes are recorded as done.** `docs/mail-client-tasks.md` says A9 phase 2 (writes beyond sending
  to oneself) needs its own go-ahead. G2 and G4 record deletes and moves on the real IONOS mailbox, and A9 is
  still listed as blocked. Record the go-ahead, or correct the record.
  **Open (2026-10-27):** waits for the user's decision; I6 did not change the record.
- **PII:**
  - `docs/mail-client-tasks.md` (around line 892) contains one real-looking mailbox address.
  - `docs/TODOS.md` (Data section, from before this branch) contains two real-looking person names.
  - `tests/no_pii.test.ts` does not scan `docs/` or `*.md`, nor any source file other than `seed.ts`, nor
    commit messages, so nothing flags these.
  - Branch history has deleted test files with addresses:
    - `mail_contacts_backfill.test.ts`: 8 addresses on a freemail domain, added in `f2047f5` and removed in
      `26d2888`;
    - `mail_recipient_lookup*.test.ts` and `mail_address_guard.test.ts`: likely synthetic.
  - Commit messages:
    - `26d2888` names two real company or provider domains;
    - `4999e93` has one address that needs a human look.
  - If any of these are real, squashing before merging to `main` is the only way to remove them.

---

## 7. Missing features and app integration

**The client cannot do the job it is for yet.** Production is read-only, so the user cannot reply, file,
delete, or send an invoice from bookingum with their real mailbox. Everything below assumes the write path is
fixed first (card group I).

**Mail client:**
- **No op-journal UI.** There is no place to see stuck, failed or unclear operations, nor to retry, resolve or
  cancel them. The API exists (`listOps`, `getOpCounts`, `retryOp`, `resolveOp`, `cancelOp`). Unclear sends
  cannot be resolved at all today (MR-03).
- **No thread view** (`listThreads` exists and is unused), and **no search filters** in the UI (facets exist
  in the store).
- **No new-mail notification**: no desktop notification, no badge on the "Mail" menu entry, no tray.
- **No production onboarding.** There is no guided first sync (14 GB, about 32k mails): no disk-space check
  before starting, no estimate, no "pause until on mains power".
- **Contacts:** "Als Kontakt speichern" was decided in H7 and is not built.
- **H8 release cleanup** (the read-only/sandbox account dropdown) is decided and not built.
- **No rules and no auto-filing.** Mail is never moved automatically to a band or event folder.
- **No vacation or out-of-office**, and no templates for mail other than invoices (contract mail, booking
  requests, follow-up reminders).
- **Missing robustness:**
  - nothing handles laptop sleep and resume during IDLE;
  - there is no multi-day soak;
  - the write connection does not recover after waking (MR-19).

**Integration into bookingum:**
- **Mail history covers too few objects.** It appears on band, venue, person, company and event, but not on
  contracts or invoices. An invoice does not show the mail it was sent with, although C1 knows the Message-ID.
- **No mail from contracts.** Contracts have no "per Mail senden" equivalent to C1.
- **Follow-ups (Wiedervorlagen) don't know about mail.** A follow-up is not closed by a reply, and "no answer
  after N days" is not detected.
- **Search mixes poorly.** The global search palette finds documents (D2) but not mails. Mails and app records
  are searched in two places.
- **Linking is one-way.** Linking is automatic by address only. There is no manual "link this mail to event X"
  from the reader, and no way to undo a dismissal.
- **Events can't be created from mail.** A booking request in the inbox cannot become an event with
  pre-filled venue and date.
- **Archived events (D3) still appear in a band's mail history** (`mail_link.router.ts:53`). That is probably
  right for an audit trail, but undocumented.
- **E-invoice validation is not in CI** (`validate:einvoice` needs Java). The 2028 deadline makes this worth a
  scheduled job.

---

## 8. Docs drift

| Where | Says | Fact |
|---|---|---|
| `AGENTS.md` and `src/main/AGENTS.md` (anti-patterns) | Sending mail from the app: "nothing is transmitted" | The mail client sends over SMTP (C1, canary). Only the old `mail/` path writes files. Misleads agents. |
| `src/main/mailclient/AGENTS.md:40-41` | `sandbox` is one global endpoint (R1) | A7 part 1 made the guard per account. |
| `docs/mail-client-assessment.md` (R1, lines 45/105/146) | One global `SandboxConfig` | Fixed in A7 part 1. |
| `core/write_guard.ts:8-11`, `tests/e2e/mail-canary.spec.ts:4-6` | Canary "admitted by name", "revoked by deleting one constant" | A flag set from the UI (`8ca6fd4`). |
| `docs/mail-client-tasks.md:36`, `:502-510` | A7 part 2 "approved, not yet built" | Built differently (section 6). |
| `docs/mail-client-tasks.md:29`, `:549-550` | P1 open | Done with residuals (section 5). |
| `docs/mail-client-tasks.md:38` | A9 blocked on A7 part 2 and P1 | Phase 1 done manually, phase-2 writes recorded (section 6). |
| `docs/mail-client-tasks.md:539-540` | Sandbox tests `it.skip` when closed | Since `393dcfa` they fail locally and skip only with `CI` or `BOOKINGIUM_NO_SANDBOX=1`. |
| `core/AGENTS.md`, `core/index.ts` `close()` | `close()` finishes the current journal transition | It does not (MR-01). |
| `core/README.md:205-206` | A move renames the file | Since A3 a move updates only the row. |
| `core/README.md:124` | `sweepOrphans` not scheduled | Scheduled in `worker.ts:77/87`. |
| `core/instance_lock.ts` header | A SQLite `BEGIN EXCLUSIVE` backstop and an exit handler | Neither exists. |
| `mailclient/AGENTS.md`, `core/AGENTS.md`, `components/mail/AGENTS.md`, `pages/AGENTS.md`, `tests/AGENTS.md`, `tests/e2e/AGENTS.md` | File sizes and counts (`sync.ts` 1306, `index.ts` 918, `ComposeView` 538, `MailPage` 944, 33 test files, `mail-client.spec.ts` 692 lines / 14 tests, `probe.spec.ts`) | 1465, 1474, 739, 1313, 92 files, 2050 lines / about 40 tests; `probe.spec.ts` is deleted and `mail-canary.spec.ts` is missing from the list. |
| `docs/mail-client-handbook.md:199` | Baseline: vitest 244 passed, lint 19 errors | 673 passed plus 1 error; lint 0 errors. |
| `docs/TODOS.md` | Mail: see `NEXT_STEPS.md` | `NEXT_STEPS.md` is stale; `mail-client-tasks.md` is the living plan. |
| `tests/mail_write_guard.test.ts:3-4`, `tests/mail_crash_points.test.ts:2-4, 11-12` | Real sandbox; kill and fresh process; all mail removed | `fakeImap`; same process; it leaves mail behind. |
| worker comment on remote images | "opt-in" | `enabled: true` is hard-coded; the opt-in is the per-message click. |

---

## 9. Suggested cards (group I)

The order is by risk. I1 to I4 are the precondition for any further real-mailbox write.

| Card | Content | Findings |
|---|---|---|
| **I1** | Send state machine: replay of `running`/`smtp` as unknown, one exception wrapper in `execute`, per-op catch in replay, watchdog `unknown` in the SMTP phase, `retryOp` refuses unknown sends, `close()` waits for the op, Sent filing as its own op, tests for each | MR-01, 02, 03 (core part), 05, 15, 16, 43 |
| **I2** | Compose send UX: in-flight guard, no implicit submit, an "unclear" result locks the editor, a stable Message-ID per compose session, autosave stopped while sending | MR-03 (UI part), 04, 38 |
| **I3** | Op-journal panel: list stuck, failed and unclear ops; resolve, retry, cancel; badge in the mail header | MR-03, 29 |
| **I4** | Mailbox selection discipline: `withSelected(path, readOnly)` for flag sweep, repair and folder list; real UIDNEXT; disk-full stops everything; maintenance gate skips | MR-09, 10, 24, 25, 31 |
| **I5** | HTML safety: style handling in the sanitizer, no HTML sniffing in the editor, with regression tests | MR-07, 08 |
| **I6** | Canary in main: refuse in main, clear the flag on host change, check SMTP security, `writableEntry` asks `writeRefusal`, canary spec opt-in; record the decision | MR-18, 20, section 6 |
| **I7** | C1 done right: UTF-8 decode, a hard error without the PDF, an explicit sending account, main attaches the PDF, the mail visible on the invoice | MR-11, 12, 14, 21 |
| **I8** | Folder delete safety: server STATUS before DELETE, undo checks | MR-06 |
| **I9** | Gate green: ECONNRESET fix, fake servers answer BAD, crash-point test made able to fail, one CI run to check the ABI | MR-17, section 4 |
| **I10** | Small renderer fixes: signature DTO, read-only write buttons, archive in Archive, shortcuts in dialogs, account switch | MR-13, 35, 36, 37, low items |
| **I11** | Host hardening: remote images, attachments with Mark-of-the-Web, connection-test password, `invoice:email` traversal, remove `window.electron` | MR-22, 23, 33, 34, design note 5 |
| **I12** | Store robustness: corruption detection, re-linking files after a rebuild, mass-expunge guard, `storeMessage` order | MR-26, 41, 42 |
| **I13** | Fuzz and soak harness in bookingum (port the op generator and invariants, run nightly against the sandbox) | section 5 |
| **I14** | Docs drift and PII cleanup | sections 6 and 8 |
