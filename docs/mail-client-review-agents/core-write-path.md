## Write-path review: IMAP mail core (feat/mail-client)

This was a read-only review: no edits, no commits, no server connections, no mail content opened. I did not run any vitest. Every finding comes from reading the code and the tests. All paths are under `C:\Users\benni\Documents\repos\bookingum-app\src\main\mailclient\`.

### CRITICAL

**C1. A send left in `running` is sent again on the next start, because `phase:'smtp'` is ignored on replay.**
- **Where:** `core/write_engine.ts:994-1020`, plus `core/index.ts:1036`, `:599-611` and `:1407-1419`.
- **How it happens:**
  - `sendMail` journals the op and sets `state:'running'`.
  - `doSend` writes `phase:'smtp'` (line 1010) before SMTP starts.
  - On replay, the only special case is `state==='unknown'`. A `running` op goes straight to `sentProbe`, and if the result is `absent` or `unavailable` it calls SMTP again. Nothing reads `phase`, except the watchdog.
- **Concrete ways to reach it:**
  1. **Quit during a send.** SMTP returns 250, then the user quits. `close()` does not wait for in-flight writes: it calls `writes.close()` (logout) and then `store.close()`. `appendToSent` fails. The `journalUpdate(done)` at 1042 then throws on the closed database, so the op stays `running` with phase smtp. At the next start, `replayPendingOps` probes Sent, finds nothing (it was never filed), and sends again.
  2. **Worker killed or crashed.** `MailClientService.stop()` kills the worker after 15 s. If that happens between the SMTP ack and the Sent APPEND, the result is the same.
  3. **Provider does not auto-file, or Sent is not set.** If `sentFolderPath` is null, `sentProbe` returns `'unavailable'`, which also leads to a resend.
- **Confidence:** high.
- **Fix direction:** when replaying, treat `state==='running' && phase==='smtp'` exactly like `unknown`, i.e. go to `resolveUnknownSend` and never resend. Also make `close()` wait for in-flight ops, as its docs and `core/AGENTS.md` say it does.

### HIGH

**H1. A connect failure strands a send in `running`, and it then goes out unasked at the next start.**
- **Where:** `core/write_engine.ts:1073` (`sentProbe` calls `writeClient()` outside its try) and `core/index.ts:1036-1045`.
- **How it happens:**
  - The connect or login throws, so `execute` rejects and `runOp` throws.
  - `applyOpResult` never runs, and the `cancelled` branch in `sendMail` is skipped.
  - The user sees a raw error, keeps the editor open and sends again under a new Message-ID.
  - At the next start, the stranded `running` op is replayed and delivered as well. That is two deliveries, and the Message-ID probe cannot catch it because the IDs differ.
- **Same pattern elsewhere:** `writeClient()` is also outside the try in `doFlag:387`, `doMoveLike:438`, `doMoveBatch:556`, the folder ops (724/750/791), `doExpunge:923`, `appendToSent:1125` and `doDraftSave:1150`. Those ops are left pending or running, with their optimistic local effects still applied.
- **Confidence:** high.
- **Fix direction:** move `writeClient()` inside each try, or catch in `execute` and turn the error into `failed` (or `unknown` once phase is smtp). Also wrap `replayPendingOps` per op, because today one throw aborts the whole loop.

**H2. `retryOp` on an `unknown` send resends without the probe.**
- **Where:** `core/index.ts:623-631`.
- **How it happens:** `retryOp` accepts `unknown`, resets it to `pending` and runs it. `doSend` then skips `resolveUnknownSend`, which only applies when `state==='unknown'`. It probes Sent and resends on `absent`. This goes against the "never auto-resend unknown" rule in `core/AGENTS.md`.
- **Confidence:** high.
- **Fix direction:** refuse `retryOp` for `kind==='send' && state==='unknown'`, or route it through `resolveOp`. Resending should be an explicit "send as a new mail" action.

**H3. The watchdog's `late` path returns `failed` even in the SMTP phase, and it releases the folder mutex.**
- **Where:** `core/write_engine.ts:238-247`, `core/sync.ts:196-201`.
- **Send case:**
  - If the body does not settle within 15 s of the abort, the result is `failed`, whatever the phase.
  - `sendMail` (index.ts:1040) then marks the op `cancelled` and tells the user "Senden fehlgeschlagen" while the SMTP transaction may still complete. A manual resend then duplicates the mail.
  - On replay the op goes to `pending`.
- **Mutex case:** the comment says "do NOT release the mutex". In fact `withWatchdog` returns, `withFolderMutex`'s `finally` sees a matching owner token and deletes the entry. The sync engine can then take the folder while the abandoned body is still running, including its local effects. In addition, `execute` calls `dropClient()`, which logs out the connection the body is using. The owner-token test (`mail_watchdog.test.ts:150`) only covers a replaced holder.
- **Confidence:** high.
- **Fix direction:** return `unknown` when `phase==='smtp'` in the late branch as well. Either keep the mutex for real (do not resolve the outer promise; resolve a separate one for the caller) or fix the comment and the design doc.

**H4. Folder DELETE can destroy mail: there is no server-side emptiness check, and undoing a `folder_create` has no check at all.**
- **Where:** `core/write_engine.ts:787-805`, `core/index.ts:704-712`.
- **How it happens:**
  - `doFolderDelete` sends IMAP DELETE whenever the folder is listed. IMAP DELETE removes the mailbox together with its messages.
  - `deleteFolder` checks only the local count. That count also excludes mails with in-flight moves (the `countByFolder` filter), and it is stale for mail delivered or moved by other clients that has not been synced yet.
  - `undoOp(folder_create)` journals a `folder_delete` without even the local check. Example: create a folder, move mail into it, then undo the create. The folder and its mail are deleted permanently, bypassing Trash.
- **Confidence:** high (code path). Whether the UI offers undo on a `folder_create` after later ops is not verified.
- **Fix direction:** in `doFolderDelete`, run `STATUS path (MESSAGES)` and refuse with a conflict if the count is non-zero. Apply the same checks in undo, including subfolders.

**H5. Draft-save replay protection (A5/F5) does not work in production.**
- **Where:** `core/index.ts:993-998`, `core/write_engine.ts:1160-1161` and `:1224`.
- **How it happens:**
  - `saveDraft` never passes `messageId` to `journalEnqueue`, so `op.message_id` is null and `findDraftByMessageId` returns null immediately.
  - So when a crashed draft_save (APPEND done, journal update lost) is replayed, it appends a second copy.
  - Also, `saveDraft` sets `running` before the first run, so the probe branch is entered on every first attempt; it only does nothing because the id is null.
  - `journalBumpAttempts` is never called anywhere, so `attempts` is always 0.
- **Why the tests miss it:** `mail_draft_replay.test.ts` enqueues ops with `messageId` set directly and never goes through `saveDraft`.
- **Confidence:** high.
- **Fix direction:** pass the built `messageId` into the journal, call `journalBumpAttempts` in `runOp`/`execute`, and add a test that goes through `saveDraft`.

### MEDIUM

**M1. The canary admission is enforced only in the renderer.**
- **Where:** `api/routers/mail.router.ts:37,52`, `accounts.ts:182-196`, `core/write_guard.ts:117-129`.
- **How it happens:**
  - The zod input accepts `kind:'sandbox'` and `canary:true` for any host, in any build.
  - The DEV-only gate on the sandbox kind lives in `MailAccountsCard.tsx`.
  - Any IPC caller can turn a real mailbox into a writable account, including in packaged builds.
  - An existing sandbox account can also be repointed at a real host and given the flag through the normal UI. `sameMailbox` then keeps or replaces the id, but nothing in main re-confirms the change.
- **TLS:** verification is kept for non-allowlisted hosts. `rejectUnauthorized` stays at its default, and `tls` is only overridden for allowlist names.
- **Fix direction:**
  - In main, refuse `kind:'sandbox'` on a non-allowlisted host unless `canary` is set.
  - In main, refuse `canary` in packaged builds unless an explicit main-side flag allows it.

**M2. SMTP security is not validated, so canary AUTH can go out in cleartext.**
- **Where:** `accounts.ts:142-153` (checks only IMAP `security`), `core/write_guard.ts:205-220`.
- **How it happens:** with `smtpSecurity:'none'` on a real host, nodemailer runs `secure:false` without `requireTLS`, and `auth` is always passed. If the server does not offer STARTTLS, or a MITM strips it, the password is sent in clear. The renderer's SMTP options list is built from the IMAP host's rules, not the SMTP host's.
- **Fix direction:** check `smtpSecurity` against `allowsPlainLogin(smtpHost)` in `checkMailAccountSettings`. In `writeSmtp`, assert that `security==='none'` is used only with an allowlisted host.

**M3. The persistent write connection is a third connection, and a dead pooled socket stops the queue.**
- **Where:** `core/write_connection.ts`, `core/write_guard.ts:179-190`, `core/sync.ts:59,86`.
- **Connection count:**
  - Sync caps itself at 2 (1 sync + 1 IDLE). The pool holds a third connection to the same server indefinitely, with no idle timeout.
  - That breaks the documented "never more than 2" rule for the canary on a real server, where per-IP or per-user limits apply.
- **Dead socket:**
  - `connectWriteImap` does not use `IMAP_TIMEOUTS.socketTimeout`, so imapflow's default of about 5 min applies, which is longer than the 120 s watchdog.
  - After sleep/wake or a NAT timeout, `usable` can stay true on a half-open socket. The next op hangs until the watchdog fires; the body does not watch the abort signal while awaiting IMAP, so it is `late`, the queue stops, and a restart is required.
  - This is likely to happen regularly on laptops.
- **Stale SELECT:** handled, because each op calls `mailboxOpen` again.
- **Credentials:** fine, because the engine is restarted when an account is saved.
- **Fix direction:**
  - Add an idle timeout to the pool (logout after N s idle) and a NOOP before reuse.
  - Pass `IMAP_TIMEOUTS` to the write connection.
  - In the watchdog, close the client on abort.
  - Count the write connection against `maxConnections`.

**M4. Optimistic effects are not rolled back or retried until the next restart.**
- **Where:** `core/index.ts:590-595`, `:599`.
- **How it happens:**
  - `failed` goes back to `pending`, and nothing retries periodically: replay happens only in `start()`, after 5 s.
  - A pending move or batch stays hidden through the `listByFolder`/`countByFolder` exclusion.
  - A pending flag keeps its optimistic local value; the sync skips keys with in-flight ops.
  - Both stay that way until the app restarts, and the replay can then happen hours later against a changed mailbox.
- **Fix direction:** add a periodic or backoff retry of pending ops, or roll the optimistic effect back on `failed`.

**M5. Transient errors become terminal conflicts.**
- **Where:** `core/write_engine.ts` `preflight` (303-368) and `preflightBatch` (616-623).
- **How it happens:** any `mailboxOpen` error, including a socket reset, is turned into the conflict "folder gone". The connection is kept on conflict (`execute:192` drops only on failed or unknown), so a broken socket can be handed to the next op. The `usable` check limits the damage.
- **Fix direction:** classify the error (NONEXISTENT/TRYCREATE versus network) and return `failed` for network errors.

**M6. Ops pile up behind a refused account.**
- **Where:** `core/sync.ts:93-104` (`makeSandboxAccount` has `readOnly:false` for any host) and `core/index.ts` `writableEntry` (checks only `readOnly`).
- **How it happens:**
  - Take a sandbox-kind account on a non-loopback host without the canary flag. `writableEntry` accepts it, ops are journaled and optimistic effects applied, and then `connectWriteImap` throws WRITE GUARD.
  - Through H1 the ops stay pending or running forever.
  - If the canary flag is set later, all queued ops are replayed against the real mailbox, sends included.
- **Fix direction:** have `writableEntry` call `writeRefusal()` before journaling.

**M7. The folder-rename local re-key races with the sync's LIST, and a crash between RENAME and the re-key leaves the op stuck.**
- **Where:** `core/write_engine.ts:752-781`, `core/store.ts:279-316`, `core/sync.ts:479-491`.
- **How it happens:**
  - `syncFolderList` takes no mutex. If it runs between `mailboxRename` and `rekeyFolder` (one LIST plus one SELECT round trip), or after a crash before the re-key, it calls `upsertFolder(to)`, which creates a row with the target id.
  - `rekeyFolder`'s `INSERT INTO folders(id=newId)` then hits the primary key. The catch at 777 retries the same insert and throws again, so the outcome is `failed` and the op goes back to `pending`.
  - `refusePendingOpsIn` now blocks every folder op in that subtree. The folder is downloaded a second time under `to`, and the old rows stay as duplicates until prune gate 1 (two passes) removes them.
- **Subfolders:** the rename locks only `from`, not the subfolders. A concurrent sync of `from/Sub` inserts under the old folder id after the re-key deleted it, which fails the foreign key (sync error, no data loss).
- **Fix direction:** make the re-key merge into an existing target row, or let the sync skip paths with a pending rename. Lock the subtree.

**M8. `resumeBatchMoved` runs on any preflight failure and can falsely mark a batch as moved.**
- **Where:** `core/write_engine.ts:559-563`, `:670-697`.
- **How it happens:**
  - If one member vanished (expunged by another client), the UIDVALIDITY changed, or the identity does not match, the code still searches the target by Message-ID.
  - It only checks the members that have an ID (`withId`), and it takes `found[0]`.
  - If a copy of the same Message-ID already exists in the target (list mail, CC duplicates, an earlier copy), the op is marked `done`. Local rows are re-keyed to someone else's UID, possibly colliding on the UNIQUE `message_key`, and the server never moved anything. Members without an ID are silently left out.
- **Fix direction:** resume only when the preflight shows that all source UIDs are gone. Require every member to be found. Map duplicates via UIDNEXT, i.e. only UIDs at or above the op's recorded `uidNext`. `resumeHalfMoved` (814) has the same `found[0]` weakness.

### LOW

- **L1. Partial COPYUID** (`write_engine.ts:588-596`): if any member lacks a mapping, the server has already moved everything but the op returns `conflict` and records nothing. Undo is impossible, and only the source is resynced (`applyOpResult:585`); the target waits for the next pass. Fix: record the partial `movedTo`, return done-with-detail, and resync both folders.
- **L2. Resume after the local apply** (`:551-553` and `:699-701`): `applyMoveLocallyForKey` finds no row for the old key, so `newKey` is overwritten with undefined and undo drops those members. Fix: keep an existing `newKey`. The resume path also calls `applyBatchLocally` outside the try.
- **L3. Batch splitting** (`index.ts:466-510`): each chunk of 500 is its own op and the chunks are not atomic together. One vanished UID turns a whole chunk into a conflict, and `retryOp` fails again the same way because the member list is stale.
- **L4. Sent but not filed is never filed later** (`write_engine.ts:1040-1049`): the op is set to `done`, so nothing appends to Sent again, despite the "will file" text.
- **L5. Ambiguous-error regex** (`:1025`): `EPIPE`, `ENETRESET` and plain `ETIMEDOUT` codes without "timeout" in the message are classified as definitive failures.
- **L6. `storeAppendedDraft`** (`write_engine.ts:1186-1197`, `index.ts:190-198`): it passes the local `uid_validity`, not the server's APPENDUID validity, so the G6 check `draftStoreValidity(x, x)` compares a value with itself. After a server-side UIDVALIDITY reset of Drafts, the row is keyed wrong until the staged swap. It also adds to `passInsertedMsgIds` outside a sync pass, which affects move correlation. Duplicate rows are otherwise prevented by `getByKey` plus UNIQUE.
- **L7. Stale draft copy:** a draft save stranded in `running` (H1) is replayed at the next start and appends an old version after the user has already saved a newer one.
- **L8. `undoOp` can run twice:** no state marks an op as undone. Undoing a flag op twice toggles the flag back.
- **L9. Sandbox allowlist hosts:** `sandbox-dovecot` and `sandbox-mailpit` are DNS names, not loopback, yet they get `rejectUnauthorized:false` and write admission without the canary. A DNS search-suffix resolution on a LAN could point them anywhere. `allowsPlainLogin` excludes them, so cleartext is blocked, but TLS is not verified.
- **L10. Doc drift:** `close()` (`index.ts:1407`) and `core/AGENTS.md` say close finishes the current journal transition; it does not, which is the root of C1, scenario 1.

### Verified as OK

- The deduplication of a self-move mutex (`execute:176`).
- The mutex lock order: writes are serialized and sync holds only one folder, so there is no lock-order deadlock.
- `yieldFolderToWrites` hand-back under the owner token.
- `storeMessage` idempotency.
- The expunge path: Trash-only, UIDPLUS-gated, row deleted before the file.
- At most one canary is enforced on save.
- TLS is verified off the allowlist.
- `sendRefusal` limits the canary to its own address.

### Test gaps

- No test replays a `running` send with `phase:'smtp'`. `mail_crash_points.test.ts:221` covers only a send that never ran, and it skips silently when Mailpit is unreachable.
- No test for `retryOp` on an `unknown` send.
- No test for the watchdog `late` path with phase smtp, or for whether the mutex is still held after `late`.
- `mail_draft_replay.test.ts` injects `messageId` directly and never goes through `saveDraft` (H5). "does not probe on first attempt" uses `pending`, which production never does.
- Nothing covers a `writeClient()` connect failure in any op, or `replayPendingOps` stopping after a throw.
- No server-side emptiness test for folder delete, and no test for undoing a `folder_create` on a non-empty folder.
- No test for the rename re-key when the target row already exists (LIST race or crash replay), or for a concurrent subfolder sync.
- Batch: no test for a duplicate Message-ID at the target during resume, partial COPYUID, members without Message-ID, splitting above 500 with a middle-chunk failure, or undo after a resume.
- `mail_write_connection_reuse.test.ts` does not cover a half-open socket where `usable` stays true, an idle timeout, or connections counted against `maxConnections`.
- Canary: no main-process test that the router or `saveMailAccount` refuses `kind:'sandbox'` on a real host, `canary` in a packaged build, or `smtpSecurity:'none'` on a non-loopback SMTP host.
- No test that `close()` during an in-flight send leaves a state that is safe to replay.

### Design weaknesses

- The send state machine uses three signals (`state`, `payload.phase`, and the Sent probe), and replay looks at only one of them. A single `send_phase` column with a guard that rejects invalid transitions would make "never resend after SMTP started" structural.
- Errors are classified in many places with ad-hoc try placement. A single wrapper in `execute`, mapping exceptions to failed/unknown by phase, would remove the H1 class of bugs.
- The write engine's own mutex is not authoritative: the watchdog cannot truly keep it, and folder-list discovery ignores it entirely.
- Admission is spread across `kind`, the `readOnly` builder choice, `writeRefusal` and the renderer's DEV gate. `writableEntry` should ask `writeRefusal` directly, so that nothing is journaled for an account that can never write.