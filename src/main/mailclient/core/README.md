# The mail core

Self-contained mail engine. It was extracted in the prototype (Task 5 Step 1) and has been
developed in bookingum since 2026-10-23: this copy is the source of truth (see
docs/mail-client.md). Changes from the prototype are ported by hand, never by copying files
over this folder: that would silently drop what bookingum added, among it the versioned
migrations, the bodies table, the connection-test stages, the stop after a rejected login,
moves that return ops (batch undo), the compose core and the utility-process host.

Nothing in this folder imports Electron, the renderer, tRPC or anything UI-related; there are
no `process.env` reads and no hard-coded paths, ports or URLs except the sandbox allowlist in
`write_guard.ts`. The host is `../MailClientService.ts` (main process) and `../worker.ts`
(the utility process that runs the core). `tests/mail_core_boundary.test.ts` (A8, ported from
the prototype's `test-core-boundary.ts`) holds this boundary.

## Module map

| File | Role |
|---|---|
| `index.ts` | `createMailCore(options)` factory + `MailCore`: events, sync status/trigger/pause/resume, lifecycle (`start()`/`close()`); every other `Api` method is a one-line delegation to the modules below |
| `account_entries.ts` | `AccountEntries`: builds one store + sync engine + write engine per account, lazy credentials, `getAccount`/`listAccounts`/`selectAccount`, `entry`/`writableEntry` |
| `message_views.ts` | `MessageViews`: the read calls (folders, lists, threads, message, raw source, attachments, remote images, search, header lookups, contacts, `matchInboxSince` for mail rules) and the row-to-DTO mapping |
| `mail_rules.ts` | #124: `ruleMatches`/`matchingRules` (a rule's sender, To/Cc and subject conditions against a stored mail) and `recipientsOf`; pure |
| `message_keys.ts` | `messageFallbackKey` + `normalizeMessageId`, the keys mail linking matches on (re-exported from `index.ts`) |
| `op_api.ts` | `OpApi`: flags, move, trash, archive, expunge from Trash, the op journal calls (list, counts, retry, resolve, cancel, undo), replay and the retry schedule, `MOVE_BATCH_LIMIT` (re-exported from `index.ts`) |
| `folder_api.ts` | `FolderApi`: create, rename, move and delete folder, and the folder-delete refusals |
| `draft_api.ts` | `DraftApi`: save/send/delete/discard/get draft and the MIME assembly they share |
| `maintenance.ts` | `Maintenance`: orphan sweep, missing-file repair, the idle wait both run behind |
| `store.ts` | SQLite/FTS5 storage: folders, messages, threads, contacts, **search** (weighted BM25, facets, snippets), **operation journal** |
| `migrations.ts` | Versioned schema migrations (`PRAGMA user_version`): append-only list, one transaction each, a DB from a newer build is refused |
| `sync.ts` | `SyncEngine`: the sync façade (status, pause/resume, disk full, folder list, `syncAll`, the sync button's change pass `syncChanges`, move detection); wires the six modules below |
| `folder_locks.ts` | `FolderLocks`: the per-folder mutex sync and writes share, yielding a folder to waiting writes |
| `sync_connection.ts` | `SyncConnection`: the sync and IDLE clients, capability detection, backoff, circuit breaker, connection state |
| `message_ingest.ts` | `MessageIngest`: storing a fetched message or an appended draft (body file + row), the fault-injection hook |
| `folder_sync.ts` | `FolderSync`: one folder's pass (CONDSTORE/QRESYNC tiered + UID-sweep fallback), staged UIDVALIDITY swap, downloads, mass-expunge check |
| `idle_poll.ts` | `IdleLoop` + `Poller`: IMAP IDLE on INBOX, the STATUS poll (through `status_check.ts`), the tiered flag sweep |
| `status_check.ts` | #156: `StatusCheck`, the STATUS round (LIST-STATUS where advertised, else per-folder STATUS paced by the pacer) and the one "folder changed" rule (MESSAGES, UIDNEXT, HIGHESTMODSEQ, UNSEEN) the poll and `syncChanges` share; remembers UNSEEN after a sync that went through; `censusPauseOf`, `parseCensusPause` |
| `pacer.ts` | #157: `Pacer`, the adaptive pause of the sync connection's census, flag sweep and download batches (floors from the account, a learned part that doubles on a throttling signal and recovers on normal answers, remembered in kv); `throttleSignalOf` |
| `pass_summary.ts` | #156: `passSummaryLine`, the one content-free log line after a pass the user started |
| `sync_activity.ts` | #159: `SyncActivity`, the last 10 passes and the sync errors still standing (per folder or per masked message, counted, dismissable), in memory; `SyncStatus.passHistory` / `syncErrors` |
| `write_engine.ts` | `WriteEngine`: crash-safe, serialized playback of journaled ops: the queue, `execute`, the watchdog, the write connection, `preflight`, flags and expunge; the other op kinds go to the four modules below |
| `write_moves.ts` | `WriteMoves`: single and batch moves (delete, archive and draft delete are moves too), the batch preflight, the resume after a crash, the local half |
| `write_send.ts` | `WriteSend`: send with its phases, the unknown-outcome probe, filing to Sent, draft save and removing old draft versions; `smtpRefused` (re-exported from `write_engine.ts`) |
| `write_folders.ts` | `WriteFolders`: folder create, rename, delete; `FOLDER_DELETE_REFUSED` (re-exported from `write_engine.ts`) |
| `write_select.ts` | `folderMissing` + `selectFailed`: how a preflight reads a failed SELECT (`folderMissing` re-exported from `write_engine.ts`) |
| `write_connection.ts` | `WriteConnectionPool`: one reused write connection, NOOP before reuse, closed after 30 s idle |
| `connection_budget.ts` | `ConnectionBudget`: the account's `maxConnections`, shared by sync, IDLE and writes |
| `write_guard.ts` | THE write guard: `writeRefusal` per account ("Nur lesen", no cleartext login off loopback, IMAP or SMTP), `settingsRefusal` for main's save check (I6); certificate checks relaxed on the fixed loopback allowlist only |
| `compose.ts` | MIME building for new mail, reply, reply-all, forward and drafts (built once, sent and appended as the same bytes) |
| `connection_test.ts` | One-shot staged connection test for the account dialog (DNS, TCP, TLS, login, folders) |
| `imap_options.ts` | Shared ImapFlow options (timeouts, socket error listener) |
| `parse.ts` | the one door to the MIME parser (mailparser): `parseMessage(source)` at ingest, `parseStoredMessage(store, file_path)` for a stored .eml |
| `skeleton.ts` | S1: a large message without its large parts, rebuilt from BODYSTRUCTURE and fetched sections so mailparser reads it like the whole; size estimates (pure) |
| `skeleton_fetch.ts` | S1: the threshold check and the fetch of one message's skeleton, for the download pass and repair |
| `message_complete.ts` | S1: `ensureComplete`, the one download of a skeleton row's whole message before a door reads its file; `adoptWholeSource` (also used by repair); the API's `completeMessage` is the UI's way in |
| `sanitize.ts` | HTML mail sanitizer (DOMPurify + jsdom) — the only module needing a DOM |
| `remote_images.ts` | opt-in remote-image fetch (URL → data: URI, size/type limited) |
| `types.ts` | data types + the `Api` contract (the renderer imports these types; the worker calls `MailCore` methods by name) |
| `instance_lock.ts` | single-instance protection: data-dir lock file + PID liveness check |

Import direction is one-way: `../worker.ts` → `core/`; the renderer reaches the core only over
IPC (`mail.call` in `src/main/api/routers/mail.router.ts`, allowlisted by `MAIL_API_METHODS` in
`../protocol.ts`). The core imports nothing back.

The renderer imports from here in two ways, and only these are allowed:
- **types** (`types.ts`, `connection_test.ts` as `import type`) - erased at build, so no core code
  reaches the browser bundle.
- **node-free value modules** - `address.ts`, `folders.ts`, `imap_options.ts` - the same pattern as the
  other pure main modules (`einvoice/`, `calendar/`, `payment/`) that the renderer imports directly.

A value import of a module that pulls a Node dependency (imapflow, better-sqlite3, fs, ...) breaks the
renderer build, which is the guard for this direction; the static test in
`tests/mail_core_boundary.test.ts` guards the other one (the core importing outward).

Code style: this folder keeps the prototype's style (semicolons, long lines) and is not
prettier-formatted, so hand-ports stay diffable. Do not run `prettier --write` on it.

## A corrupt store is set aside, not fatal

Every row in the store came from the server, so the file is **rebuildable** - but it used to be
rebuildable only by deleting the folder by hand, which silently lost all local mail. Worse, the
constructor runs inside `for (const a of options.accounts)` in `account_entries.ts`, so a throw from one corrupt
store meant **every** account failed to load and the app had no mail at all.

`store_recovery.ts` handles it: on a corruption code (`SQLITE_CORRUPT*`, `SQLITE_NOTADB` or
`SQLITE_IOERR_SHORT_READ`, also when it is wrapped in an error's `cause`) the store file is **renamed**
(never deleted - it still holds the user's message bodies) to `<account>.db.corrupt-<timestamp>`, its
`.db-wal` and `.db-shm` travel with it, and the store is reopened **once**. A warn goes through the
injected `log` so the user is not left guessing where their mail went.

Two things it deliberately does not do:

- **Only corruption codes count.** Measured: a locked DB and a zero-byte file both open fine, and
  `SQLITE_IOERR`, `SQLITE_BUSY` and `SQLITE_CANTOPEN` are transient. Setting a good store aside on a
  transient failure would be worse than the bug it fixes.
- **Exactly one retry.** A second failure is a broken data dir, not corruption, so it throws instead of
  reopening the same file in a loop.

I12 (MR-26) closed the gaps that left:

- **A damaged data page opens fine.** Only the query that reads it throws. So every statement is watched:
  the first corruption error writes a `<account>.db.check` marker and warns once. On the next start the
  marker, or a `-wal` left behind by an unclean shutdown, makes the open run `PRAGMA quick_check` first,
  and a failed check takes the quarantine path above. A clean start skips the check: it reads the
  whole file, which costs seconds on a large store.
- **A rebuild re-links the files.** Before the rebuilt store syncs, `salvageRelinks` reads what it can
  of the quarantined file into the `relinks` table (migration 3): folder path, UIDVALIDITY, UID, file and
  size, only for a stored `.eml` path (`isStoredMessagePath`) whose file still has the recorded size. The sync then adopts such a
  file for a UID the server reports with the same size and downloads only the rest. The orphan sweep
  leaves re-linked files alone until the entry is older than the orphan TTL.
- **One account is not every account.** `createMailCore` opens each store inside its own try/catch, so
  an account whose store cannot be opened is skipped with a warning; only when none opens does it throw
  (and release the data-dir lock). The contacts backfill reads every row and so is where damage usually
  shows: a corruption error there closes the store and reopens it once, which checks and rebuilds.

`.corrupt-*` files are never cleaned up automatically; they hold the user's mail.

`tests/mail_store_recovery.test.ts` and `tests/mail_store_integrity.test.ts` cover both directions,
including that a store from a newer build is still refused (`StoreVersionError`) and quarantines nothing.

## A UIDVALIDITY swap resumes, and a short UID list is not a mass expunge

I12 (MR-41). An empty or cut-off `UID FETCH 1:*` looks exactly like a server that expunged everything.
An expunge of 20 or more messages that is also more than a fifth of the folder therefore needs the UID
list to be at least as long as the EXISTS of this sync's EXAMINE; otherwise nothing is removed this pass
and a warning says so. The UIDVALIDITY swap goes through the same guard before it replaces the folder.

The swap stages new rows in a `__staging__/<path>` folder (`STAGING_PREFIX`). Staging survives a failed
or stopped pass and the next pass downloads only what is not staged yet. Staging of another UIDVALIDITY
is dropped first, and so is staging whose real folder was pruned. Staged rows are keyed by the real
folder id and are hidden from `getFolders`, cross-folder search, facets and threads until the swap moves
them.

## A full disk pauses sync and says so

A local-first client writes every body to disk and every row to SQLite, so a full disk is a matter of
time, not an edge case. Before this it was unmodelled: a failed write inside a folder sync was swallowed
by the per-folder catch in `syncAll`, which only consulted the circuit breaker and the connection state -
so the app either retried the same failing download forever or reported **"offline"**, sending the user to
check their network when the actual problem was the drive.

`disk_full.ts` classifies the failure (`SQLITE_FULL`, `ENOSPC`, `EDQUOT` - measured: SQLite raises
`SQLITE_FULL`, portable to force with `PRAGMA max_page_count`). The rule is deliberately narrow: a BUSY,
CORRUPT or EACCES failure is **not** disk-full and keeps its own handling, because a retry can fix those.

On a disk-full write the pass stops in phase `disk-full`, `SyncStatus.diskFull` carries the reason, and the
connection state is left alone. `resume()` clears it - the host wires that to the UI retry. Nothing is deleted
automatically: freeing space is the user call.

Two traps this cost, both worth knowing before touching the path:

- `syncFolderInner` catches a folder error and rethrows **only** when the circuit breaker opens. Without an
  explicit rethrow for disk-full the error never reaches `syncAll` and the state stays `idle`.
- `syncAll` returns a status object assembled before its `finally` settles; assert on `getStatus()`, not on the
  returned value, or the phase reads stale.

`BOOKINGIUM_FAULT_WRITE=<code>` makes the worker fail every local write with that code, so an e2e can exercise
the real path. It is a QA seam, off unless set.

## The first download of a large mailbox

#63. A first download is planned before it starts, so a large mailbox neither fills the drive halfway nor
leaves the user guessing.

- **Size.** The STATUS sweep of `syncAll` asks for `SIZE` too (imapflow sends it only with `STATUS=SIZE` or
  IMAP4rev2). With every folder's size, `SyncStatus.bytesTotal` is their sum; otherwise the account's
  `QUOTA` usage (`getQuota('INBOX')`, no command without the capability); otherwise null. IONOS: not
  measured yet.
- **Space check.** In an `initial` pass, `downloadSpaceNeeded` (what the server holds less what is stored,
  by `size_bytes`, with the swap's 1.2 share and 50 MB reserve) against `freeBytes(dataDir)`. Too little
  holds the pass paused (it waits at its next `gate()`) with `SyncStatus.spaceWarning`; `resume()` clears
  it and the run does not ask again. The need is an upper bound: messages above `lazyAboveBytes` are stored
  as skeletons. A disk that does fill up still stops on the disk-full path below. Unknown sizes do not hold.
- **Time left.** `SyncStatus.secondsLeft` from `download_estimate.ts`: the message rate since the pass or the
  last resume, after 30 s and 20 messages; null otherwise, and while paused.
- **Pause across a restart.** `pause()` sets the store's `kv` flag `sync_paused`; `resume()` removes it. A new
  engine applies it once the pass knows the download is not done (holding at construction would block the
  pass at its first `gate()` before it could find out); an `incremental` pass drops it, so new mail never
  waits behind it. The space hold is not saved: after a restart it is checked again.

Tests: `tests/mail_large_mailbox.test.ts` (fake server with `STATUS=SIZE` / `QUOTA`).

## The sync button syncs what changed

#156. Without CONDSTORE every folder sync is a SELECT, a `UID FETCH 1:*` and a `FETCH 1:* FLAGS`, so a
`syncAll` over a large mailbox takes minutes even when nothing changed. `MailCore.triggerSync(false, …,
openFolderId)` runs `SyncEngine.syncChanges({ openFolder })` instead; `triggerSync(true)` stays the full
`syncAll` (the deep check, the sync bar's „Alle Ordner prüfen“).

- **Priority folders** (`SyncProgress.changePass = 'priority'`): the open folder, INBOX, then the folders
  with special use `\Sent`, `\Drafts`, `\Trash`, each once, synced fully after one STATUS (for UNSEEN).
- **The check** (`changePass = 'check'`): `StatusCheck.round` over every other folder, synced only when
  `StatusCheck.changed`: no UIDVALIDITY yet, MESSAGES against the stored rows, UIDNEXT, HIGHESTMODSEQ
  (only asked where imapflow sees CONDSTORE), or UNSEEN against `folders.unseen`. A NULL stored value
  never counts; an unchanged folder takes the server's UNSEEN as its baseline.
- **UNSEEN is remembered** (`syncAndRemember`) only after a sync that went through: the rename was not
  pending and the folder reported no error meanwhile (`syncFolder` swallows folder errors, so the engine
  counts `error` events per path). The value is the one asked BEFORE the sync, so a change during the
  sync shows in the next round. `syncAll` stores it the same way, which is how the start pass sets the
  first baseline.
- **Falls back to `syncAll`** while the store is not complete: no finished pass, a folder without
  UIDVALIDITY, a paused or held first download.
- **LIST-STATUS.** Advertised: one `client.list({ statusQuery })` (`StatusCheck.listStatus`); a folder
  missing from the inline answer gets its own STATUS. `syncAll`'s STATUS sweep (the deep check, the
  start pass) uses the same call with SIZE added (imapflow drops it without STATUS=SIZE) and counts
  in `rounds.listStatus` too; its pass summary says `list-status=yes`. IONOS advertises it (seen
  2026-11-13). A server that advertises it but rejects it makes imapflow fall back to an
  UNPACED STATUS per folder and set `skipListStatusArgs`; `StatusCheck` then latches `listStatusBroken`
  and uses the paced path from the next round on. A server that silently ignores the RETURN option
  cannot be told apart and pays that unpaced round each time.
- **Pacing (#157, `pacer.ts`).** One `Pacer` per `SyncEngine` paces the per-folder STATUS
  (`StatusCheck.statusOf`, `syncAll`'s sweep: kind `census`), the flag sweep's chunks (`sweep`) and the
  download batches (`batch`). Each kind has a fixed floor (`censusPauseOf(account)`, `requestDelayMs`,
  `interBatchDelayMs`: 0, 0 and 100 ms for the real-mailbox builders); the learned part on top starts at
  0 (or the value in kv `pacer_pause_ms`), doubles on a throttling signal (`throttleSignalOf`: RFC 5530
  `[LIMIT]`/`[UNAVAILABLE]`/`[INUSE]`, `ETHROTTLE`, BYE, a lost connection; `answered`: a STATUS or flag
  chunk slower than 750 ms and 3× the median of the last 31) up to 2 s, and shrinks by a fifth every
  five normal answers. Downloads only count as normal answers (`normal`): their time says more about
  their size. `SyncConnection` reports a closed sync client (`syncClientClosed`) and, through the
  logger it hands imapflow, the errors imapflow swallows (STATUS answers `false` for a `NO [LIMIT]`:
  `syncCommandFailed`; only the error object, nothing is logged). `Pacer.failed` reads each error once,
  and `timed` does not count a `false` answer as normal. The circuit breaker
  stays the last resort. The host can still set the census floor with `MailCoreOptions.censusPauseMs`
  (the worker reads `BOOKINGIUM_MAIL_CENSUS_PAUSE_MS` through `parseCensusPause`, 0 to 10000 ms; the core
  itself reads no environment).
- **The opened folder** (`SyncEngine.syncOpened`, `MailCore.syncOpenedFolder`): synced on the sync
  client after one STATUS, never on a new connection. During a pass it becomes `openRequest`, which the
  pass's folder loop (`syncAll`) or `takeOpened` (`syncChanges`, before each priority folder and inside
  the check) takes next; `passSynced` makes sure a pass syncs no folder twice, and a request still open
  when the pass ends is run by `endPass`. Skipped (`'skipped'`) while its mutex is held, it is already
  being synced because it was opened, a rename is pending, before `lastSyncAt`, paused, the circuit
  open, not online or the disk full. `inFlight` counts it, so `close()` waits for it.
- **The pass summary** (`SyncProgress.lastPass`, a `PassSummary`): set by `endPass` only for passes
  started with `report: true`, i.e. from `MailCore.triggerSync`; the background passes leave it alone.
  Counts and times only: LIST-STATUS used, census pause and duration (the STATUS round without the
  syncs inside it), folders checked and synced, total time, error events during the pass, the phase
  and connection at the end, and (#157) `pacing`: the pacer's learned pause at the end and at its
  highest, and its throttling signals. `triggerSync` logs it once with `passSummaryLine`.
- **Not covered by the button:** flag changes other than `\Seen` in unchanged non-priority folders, and
  `\Seen` changes that cancel out in the count. The poll's tiered flag sweep and the deep check do.
- **„Nur beim Öffnen“ (#158).** `syncsOnOpen(f)` (`folders.sync_mode = 'on_open'`): `syncAll` asks the
  folder for STATUS but leaves it out of `syncedHere` (so also out of `messagesTotal`, the bytes and the
  `initial` phase), the check and the poll call `StatusCheck.rememberCounts` instead of syncing or
  sweeping, and a never-downloaded one does not make the store incomplete. `rememberCounts` stores
  MESSAGES and UNSEEN in `status_messages`/`status_unseen` while the folder has no UIDVALIDITY;
  `syncAndRemember` clears them after a sync that went through. `syncOpened` syncs such a folder even
  without a first sync, and with `evenUndownloaded` any folder (`MailCore.downloadSwitched`, after a
  switch to `always`). Seeding at INSERT only: `seedSyncModes(list)` in `syncFolderList` (anything but
  `subscribed: true` from imapflow counts as not subscribed; no ordinary folder subscribed → all
  `always`), `upsertFolder`'s UPDATE keeps the mode, `rekeyFolder` carries it to the new path.
  `MailCore.setFolderSyncMode` and `adoptSubscriptions` refuse staging and protected folders
  (`isProtectedFolder`).

Tests: `tests/mail_change_pass.test.ts` (`tests/helpers/scriptedImap.ts` with `capabilities`, UNSEEN and
LIST-STATUS; the census pause, the opened folder, the pass summary), the migration in
`tests/mail_store_migrations.test.ts`; `capabilityNames` in `tests/mail_connection.test.ts`.

## A large message is stored without its large parts

S1. With `AccountConfig.lazyAboveBytes` set (every account builder sets `LAZY_ABOVE_BYTES`, 5 MB; real
mailboxes since the first IONOS run), a message whose server size is above it is stored as a **skeleton**: `skeleton_fetch.ts`
fetches BODYSTRUCTURE and the sections below the threshold, and `skeleton.ts` rebuilds a MIME file that mailparser
reads like the whole message, minus the large parts' bytes. The row has `complete = 0`, `size_bytes` is the server's,
and `attachments_json` carries the estimated sizes.

Every door that reads the stored file (`getAttachment`, `getRawEml`, documents, forward drafts) calls
`MessageCompletion.ensureComplete` first (`message_complete.ts`). It downloads the whole message once (callers share the
download), and `adoptWholeSource` points the row at the new file with `complete = 1` and the real attachment list in
one transaction. Two rules that each cost a bug:

- The write goes through `Store.updateMessage`. The FTS index is external-content with no update trigger, so a direct
  `UPDATE messages` leaves the index on the skeleton's text (an integrity check with rank 1 shows it).
- The download logs in on the engine's connection, which loads the account's credentials first (below). imapflow
  reports a missing password as a rejected login, which would stop the account for good.

Offline, `ensureComplete` throws `OFFLINE_MESSAGE` and the row stays partial; a message gone from the server throws
`GONE_MESSAGE`; a full disk is the disk-full path above. Nothing evicts a completed message. Tests: the unit suite
`mail_message_complete`, the sandbox suites `mail_skeleton_sandbox`, `mail_partial_ingest_sandbox`,
`mail_complete_sandbox`, and the e2e "a large attachment is loaded when it is opened".

## One connection budget per account

I15a (MR-19, sync L2). Sync, IDLE and the write engine draw from one `ConnectionBudget` per account,
created in `createMailCore` from `maxConnections` (default 4; both account profiles set 2). Before
this, sync counted its own connection, IDLE was opened outside the cap and the write engine opened a third,
so production saw three logins where the rule allows two.

- A write asks for its slot as **urgent**. A slot that comes free goes to it first, and a holder that
  registered a yielder is asked to give its slot back. The IDLE connection is that holder: it closes at once
  and reconnects once a slot is free again, and the reconnect starts dirty, so whatever arrived meanwhile is
  synced.
- The write connection is reused across ops (`WriteConnectionPool`). Before reuse it must answer a NOOP
  within 10 s, because `usable` stays true on a socket that died while the laptop slept. After 30 s
  without an op it logs out, which gives the slot back for IDLE.
- When the op watchdog gives up, the pool closes the connection without a LOGOUT. That rejects the
  hung command, so the op settles as `failed` instead of stopping the queue.
- The write connection uses the sync engine's `IMAP_TIMEOUTS` and has an `error` listener.
- **After sleep** (`MailCore.afterSystemResume()`, sent by the host on a wake): every account closes its
  sync and IDLE connection (`SyncEngine.dropConnections()`, cleared before closing so the circuit breaker
  counts no disconnect) and an idle write connection (`WriteEngine.dropIdleConnection()`; one an op is
  using stays). After a pass already running it runs one `syncAll()`; further wake signals join the
  pending catch-up, and an account whose login was rejected is skipped. IDLE reconnects dirty.

The account dialog's `connection_test.ts` is a one-shot test outside the budget: it runs before the account
is saved, with its own 15 s deadline.

## A failed SELECT is not always a missing folder

I15a (MR-30). `folderMissing(error)` in `write_select.ts` decides it from the server's own answer: a tagged
`NO` with `NONEXISTENT` or `TRYCREATE`, or with no response code (servers before RFC 5530), means the folder
is gone, and the op is a conflict. A `NO` with a transient code (`UNAVAILABLE`, `INUSE`, `LIMIT`,
`SERVERBUG`, `OVERQUOTA`), a `BYE`, a timeout or a closed socket is `failed`: the client is dropped and a
retry can succeed.

## A move resumes only with proof that it happened

I15a (MR-32). Before a MOVE or COPY the engine journals the target's `UIDNEXT` (`targetUidNext`). After a
crash the op is resumed from the target only when:

- every source UID is gone (one still there means the move did not happen),
- every member has a Message-ID, and
- each Message-ID is found exactly once at or above the recorded `UIDNEXT`, with no two members on one UID.

Anything else is a conflict and the next sync settles it. An op journaled before I15a has no `UIDNEXT` and
is never resumed this way.

## Factory

```ts
import { createMailCore } from './core/index';

const core = createMailCore({
  dataDir: '/abs/path/data',           // REQUIRED absolute; accounts get subdirs <dataDir>/<id>
  accounts: [{
    id: 'main',
    readOnly: false,                   // true = "Nur lesen": the core writes nothing to it
    host: 'imap.example.com',
    port: 993,
    credentials: async () => ({ user: 'u', pass: 'p' }),  // host supplies (Electron safeStorage)
    email: 'me@example.com',           // optional display identity (From header fallback)
  }],
  sinkProbe: async (messageId) => boolean,   // optional send-sink probe (Mailpit)
  log: { info?, warn?, error? },             // default: silent
  clock: () => number,                       // default Date.now (deterministic tests)
  remoteImages: { enabled: true, ... },      // omit = remote images stay blocked
  forceNoCondstore: false,                   // test hook: force the UID-sweep sync strategy
});

core.api;        // MailCore IS the Api implementation (types.ts)
core.on('sync-event', cb);   // sync progress events (see below); delivered by name only
core.on('op-event', cb);     // write-op journal state changes
core.start();    // initial sync + IDLE + polling + pending-op replay (5 s after start)
core.sweepOrphans();  // remove .eml files without rows (grace 10 min) — host schedules it (`worker.ts`, 10 min after start then every 6 h)
await core.close();   // shutdown contract, see below
```

Writes go to each account's own IMAP and SMTP endpoints (A7); there is no global sandbox endpoint.
An account's mode is `read-only` ("Nur lesen" or settings the guard refuses), `sandbox` (loopback
host, the local test server) or `live` (a real server, paced like a production mailbox).

Credentials are resolved **lazily per connection** through the host-provided
`credentials()` function and are cached only in memory (`ensureCredentials`). The core
never reads `.env`, never logs credentials, and never stores them on disk. The sync engine
loads them in `SyncConnection.connect()` before every login (the factory passes
`ensureCredentials` as the engine's `credentials` option), so a sync, polling, the repair sweep
and the S1 download all have them, whichever comes first; IDLE logs in only after the main
connection is online. Without a password the engine does not contact the server and the account
is offline, not stopped. `isAuthFailure` leaves out imapflow's local "No password configured":
only a login the server refused stops an account.

## Events emitted

Subscribed via `core.on(name, cb)`. A listener gets only the events of the name it subscribed to; before
I15a (MR-40) the name was ignored, so a host that subscribed twice got every event twice.

| Event | Payload | Meaning |
|---|---|---|
| `sync-event` | `SyncEvent` (`{ type: 'folder-list' \| 'folder-start' \| 'folder-done' \| 'error', path, message }`) | per-folder sync progress; also drives the pollable `getSyncStatus()`. The core adds the folder's `specialUse` to `folder-done`, so main finds Sent by `\Sent` (MR-28) |
| `op-event` | `{ opId, kind, outcome, reason? }` | emitted after every write-op execution and journal state change |

There is deliberately **no** `log` event: the core calls the injected `log` sink
(`info/warn/error`) for operational messages. The host decides what to do with them.

## Shutdown contract (`close()`)

1. Stops polling and IDLE — no new server contact after `close()` returns.
2. Waits (bounded, default 10 s) for an in-flight sync to finish; on timeout it gives up
   safely (next `start()` re-syncs).
3. In-flight write ops finish their current journal state transition — they are
   crash-safe by design (journal-first); a hard kill mid-op is recovered by the next
   `start()` replay, never retried blindly.
4. Closes SQLite handles (WAL checkpoint on close).
5. Releases the data-dir instance lock.

`close()` does **not** replay failed ops and does not retry sends — replay happens on
the next `start()`. `close()` is idempotent.

## Single-instance protection

`createMailCore` takes an exclusive lock on the data dir (`<dataDir>/.mailcore.lock`,
PID + start time inside). A second instance — same process or child process — throws
`InstanceLockError` immediately with the holder's PID. Stale locks (dead PID, or a
PID-reuse victim older than 7 days) are broken automatically. The lock is released on
`close()` and on process exit. This makes the prototype's Task 4 double-server incident
(two processes racing the same SQLite store) structurally impossible. bookingum also takes
Electron's single-instance lock (`app.requestSingleInstanceLock()`).

Note: constructing `Store`/`SyncEngine` directly (as test suites do) bypasses the lock
by design — the lock protects whole app instances, not individual components.

## What needs what

- **jsdom + DOMPurify**: only `sanitize.ts`. Pure JS, creates its own DOM — runs in a
  plain Node process or Electron main/utility process. Never needed in a renderer.
- **better-sqlite3**: `store.ts` (native module — rebuilt for Electron's ABI on install).
- **imapflow / mailparser**: `sync.ts`, write paths; mailparser only through `parse.ts`.
- **nodemailer**: `write_send.ts` (SMTP send), through `writeSmtp` in `write_guard.ts`; `compose.ts` (MIME).
- **Node built-ins only** otherwise (`fs`, `path`, `crypto`, `net`, `events` semantics
  via plain callbacks). `process.memoryUsage()` is read for the `getSyncStatus()`
  `serverRssMB` field (observability; works in the utility process too).

## Dependencies & licenses (core runtime deps)

| Package | Version | License |
|---|---|---|
| better-sqlite3 | 13.0.3 | MIT |
| imapflow | 2.9.0 | MIT |
| mailparser | 3.12.3 | MIT |
| nodemailer | 10.2.1 | MIT-0 |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) |
| jsdom | 29.1.1 | MIT |

All permissive; none GPL/MPL-only (DOMPurify is used under Apache-2.0). Do not add GPL or
MPL-only dependencies.

## Data on disk

The core owns and creates everything it needs under the host-provided `dataDir`
(`<userData>/mail/data` in bookingum): one folder per account (`<dataDir>/<id>/`) with
the SQLite DB (+ WAL/SHM) and the `.eml` files, and the `.mailcore.lock` file. A new
`.eml` file gets a random name and sits in one of 256 subfolders named after its first two
characters (`3f/3f….eml`), so no folder holds more than a few thousand files; files
written before that stay at the top level. The row's `file_path` holds the relative path
(`/` as separator) and a move keeps the file. `listMessageFiles()` (`files.ts`) reads both
places. Always open a file as `path.join(<account dir>, row.file_path)`,
never relative to the working directory. A row with `complete = 0` points at a skeleton
(S1), not the whole message; `ensureComplete` replaces it before anything reads the large
parts. All of it can be rebuilt from the server: nothing
that must survive (links to persons, invoices) may live here — that belongs in bookingum's
app database.
