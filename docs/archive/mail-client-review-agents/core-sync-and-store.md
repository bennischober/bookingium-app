> **Archived 2026-10-28.** A historical working document from building the mail client, kept as a record; it is not maintained. The current description is `docs/mail-client.md`.

MAIL CORE REVIEW: SYNC / STORE / FILES / RECOVERY / SEARCH (read-only)

This was a read-only review. I made no edits and did not run the app or any test file. I read every file in my area, plus the imapflow 2.9.0 source for mailboxOpen and fetch, and checked the mail tests that cover this area.

**Confidence labels:**
- **"Confirmed (code)"**: I traced the path in our code, and in imapflow where it matters.
- **"Plausible"**: depends on timing or server behaviour I could not reproduce.
- Nothing below was confirmed end to end against a live server.

---

## HIGH

### H1. The flag sweep reads FLAGS from the wrong mailbox, and on IONOS it scrambles read/unread state
- **Where:** `core/sync.ts:1264-1308` (pollOnce) and `1349-1389` (flagSweep, the fetch at about line 1372).
- **What happens:**
  - `pollOnce` only issues `STATUS` for each folder, which does not select it.
  - When the counts match, it calls `flagSweep(client, f)`, which runs `client.fetch(range, {flags}, {uid:true})` on whatever mailbox the shared sync client last selected. imapflow's `fetch` uses `this.mailbox` (imap-flow.js:3271).
  - Without CONDSTORE (IONOS), INBOX is tier 1 and is swept on every poll. So INBOX rows get the flags of the same UIDs in the last folder that `syncAll` or `syncFolder` selected, for example an archive folder.
- **Effect:** read/unread and flagged state flips silently. Unread counts go wrong, and the next poll overwrites them again, possibly with a different folder's flags. Nothing is written to the server: the sync engine is read-only and the damage is local.
- **Confidence:** confirmed (code).
- **Fix:** inside `flagSweep`, take `withFolderMutex(f)`, then `getMailboxLock(f.imap_path, {readOnly: true})`. Check that `client.mailbox.uidValidity` equals the stored `uid_validity` before applying anything, and release the lock afterwards.
- **Test gap:** no test calls `flagSweep`. `mail_sync_time.test.ts` uses `pollOnce` only to check that `lastSyncAt` moves.

### H2. `repairMissingFiles` shares the sync client with no lock or mutex, does not check UIDVALIDITY, and opens production read-write
- **Where:** `core/index.ts:1345-1376`, scheduled in `worker.ts:94-112`.
- **What the code does:**
  - It calls `client.mailboxOpen(folder.imap_path)` on `e.engine.connection()`, the same client sync uses.
  - It takes no folder mutex and no `getMailboxLock`, and it does not pass `readOnly`, so on production-readonly accounts it sends SELECT, not EXAMINE.
  - It never compares the server's UIDVALIDITY with `folder.uid_validity`.
- **Why the maintenance gate doesn't help:** `whenIdleForMaintenance` (index.ts:1281) only waits while the phase is `'initial'`, and on its 120 s timeout it returns normally, so `fn()` runs anyway. Repair therefore runs 2 minutes after start, in the middle of a first download, and hourly during any incremental or poll sync.
- **How imapflow makes this unsafe:** `mailboxOpen` is a bare `run('SELECT')`, and imapflow's own doc comment (imap-flow.js:3776) says it has "no guarantees" against a lock holder.
- **Failure scenarios:**
  - (a) Repair switches the selected mailbox while `syncFolderInner` holds its lock. Sync's following `UID FETCH 1:*` returns the other folder's UID set. Local rows missing from that set are expunged and their files unlinked, and wrong UIDs are downloaded under this folder's keys.
  - (b) After a UIDVALIDITY change, repair fetches a different message for the same UID number and points the row at its file. The row's headers and FTS then describe one mail while the body is another.
- **Confidence:**
  - The missing lock, the missing readOnly and the missing validity check are confirmed (code).
  - The interleaving in (a) is plausible.
  - Locally lost data is re-downloadable, but sync churns and shows wrong content until then.
- **Smaller points:**
  - Repair only ever covers the active account (`entry(undefined)` resolves to `activeId`).
  - Each call reads all rows plus a full readdir (see M8).
- **Fix:** run repair through `engine.withFolderMutexPublic(path, ...)` and `getMailboxLock(path, {readOnly})`, compare `mailbox.uidValidity` with the row's folder before writing, make the gate actually skip on timeout rather than proceed, and iterate over all accounts.

---

## MEDIUM-HIGH

### M1. `uid_next` is stored as max(UID)+1 but compared with the server's UIDNEXT, so folders re-sync fully on every poll
- **Where:**
  - Written at `sync.ts:747-750` (full sync) and `643` (UIDVALIDITY swap).
  - The incremental path never updates it.
  - Compared at `sync.ts:1280`.
- **What happens:** the server's UIDNEXT is the next UID it will assign, not the highest existing UID plus one. Any folder whose newest mail was moved or deleted never matches again. That covers Drafts after sending, Trash after emptying, and any empty folder that once held mail (stored value 1, server value above 1).
- **Effect:** each poll (every 120 s) runs `syncFolder` on each of those folders: a SELECT, a `UID FETCH 1:*` and a flags fetch, plus journal queries. On a 276-folder account that is likely dozens of folders, a steady load on IONOS that also counts toward the circuit breaker.
- **Count trigger:** the message-count comparison (`st.messages !== localCount`) has the same effect whenever a message was skipped, for example a fetch that returned no source.
- **Confidence:** confirmed (code). How many folders are affected on production is unmeasured.
- **Fix:** store `mailbox.uidNext` from the SELECT response, in both the full and incremental paths, and stop using max+1 as UIDNEXT.

### M2. The disk-full state stops nothing except the current `syncAll` pass
- **Where:** `sync.ts:1087-1091` sets `diskFull`; the only place that reads it is `resume()` (`sync.ts:306`).
- **What happens:**
  - `pollOnce` then calls `syncFolder`. `syncFolderInner` rethrows the disk-full error (line 605), but `pollOnce`'s per-folder `catch {}` swallows it and then calls `noteSuccess()` and `noteServerContact()`.
  - IDLE keeps downloading.
  - If `lastSyncAt` is null (the first pass never finished), `startPolling` reruns `syncAll` every interval.
- **Effect on a full disk:** repeated downloads that fail half-way, with the file written and then removed. The status flips between disk-full and idle or incremental, while the "last sync" time keeps advancing.
- **Confidence:** confirmed (code).
- **Fix:** check `diskFull` at the start of `pollOnce`, the IDLE wakeup, `syncFolder`, `syncAll` and repair, and don't call `noteSuccess` when every folder failed.
- **Test gap:** `mail_disk_full.test.ts` stubs `downloadMessages` and only checks the phase after one `syncAll`. It proves nothing about poll, IDLE or repair behaviour while the disk is full.

### M3. Corrupt-store recovery only catches corruption on page 1; mid-file corruption is never detected and runtime corruption is not handled
- **Where:** the `store.ts:134-148` constructor, `store_recovery.ts`, and `migrations.ts:54-58`.
- **How detection works:**
  - Corruption is detected only if `openStore` throws. For a current-version DB, that means `pragma journal_mode`, `user_version` or the no-op migration loop has to fail.
  - The test's `corruptMiddle` overwrites bytes 100-4000, which is page 1 (the schema).
  - Damage to any data, index or FTS page opens without error. Every later query then throws `SQLITE_CORRUPT`, and nothing recovers from that.
- **Further gaps:**
  - On the first start after the upgrade, `backfillContactsOnce` runs synchronously inside the accounts loop (`index.ts:167-171`). A corrupt page hit there throws, and every account fails to load, which is the very failure this commit set out to prevent.
  - `runMigrations` wraps any error in `new Error(..., {cause})` with no `code`. So corruption hit during a migration (for example splitBodies' copy and 'rebuild' on an upgrade) fails `isCorruptStoreError`, and the error is rethrown into the accounts loop.
  - Extended codes are not matched (exact set membership). Based on how better-sqlite3 reports error codes, I expect `SQLITE_CORRUPT_VTAB` from FTS and `SQLITE_IOERR_SHORT_READ` for a truncated file to fall through; this is plausible, not tested.
- **Consequences when recovery does trigger:**
  - All ~13.5 GB is re-downloaded.
  - Every old `.eml` becomes an orphan. The sweep parks them in `orphans/`, and they are deleted only after 7 days, so disk use roughly doubles for a week. On a nearly full disk this cascades into M2.
  - Quarantined `.corrupt-*` DB files are never cleaned up.
- **Confidence:** confirmed (code). The behaviour for extended codes is plausible.
- **Fix:**
  - Run `PRAGMA quick_check` (or an FTS integrity-check) at open, or after an unclean shutdown.
  - Test `err.code?.startsWith('SQLITE_CORRUPT')` and look at `err.cause` as well.
  - Wrap per-account construction in a try/catch.
  - Consider re-linking surviving `.eml` files rather than re-downloading them.

### M4. Search: the prefix guard is bypassed for capitalised or umlaut terms, a fully capped query returns unfiltered mail, and operator-only queries throw
- **Where:** `store.ts:664-700` and `index.ts:397-416`.
- **The guard is case- and diacritic-sensitive:**
  - `capPathologicalPrefixes` probes `fts_vocab` with `term >= 'Ver' AND term < 'Ves'`. Vocab terms are case-folded and diacritic-stripped (unicode61 with remove_diacritics 2), so the range is empty, docs is 0, and nothing is capped.
  - German nouns are capitalised, so the guard misses the most common queries. The 5-10 s worker stalls measured on 2026-10-23 come back, and every core call queues behind them.
  - Confirmed (code).
  - **Fix:** lowercase and fold diacritics on the probe word in the same way as the tokenizer.
- **A fully capped query returns everything:** if every term is dropped, `kept.join(' ')` is `''`. `if (matchExpr)` is then false, and search returns the folder's (or every folder's) mail with no text filter. Confirmed (code).
- **Operator-only queries throw:** `ftsEscapeUserQuery` keeps a bare `OR`/`AND`/`NOT`. So "NOT", "x OR" (x below the minimum length) or "foo NOT" produce an invalid MATCH and the search throws.
- **Smaller points:**
  - `console.log` in core violates the folder's own rule.
  - The LIKE filters (from, to, subject) don't escape `%` and `_`.

---

## MEDIUM

### M5. The IDLE wait leaks timers on every wakeup
- **Where:** `sync.ts:1190-1196`.
- **What happens:**
  - When it resolves through `dirty`, it clears `poll` but not `stopCheck` (a 500 ms interval) or `cap` (a 25 min timeout).
  - When it resolves through `cap`, `stopCheck` leaks.
  - The leaked intervals run until `close()`, so over a day of IDLE events hundreds of 500 ms intervals pile up, a slow CPU and memory creep in the worker.
- **Confidence:** confirmed (code).
- **Fix:** have a single `done()` that clears all three timers.

### M6. Every event reaches the renderer twice
- **Where:** `index.ts:111` and `worker.ts:47-49`.
- **What happens:** `on(_name, cb)` ignores the name, and the worker subscribes twice, so every sync, op and image event is posted twice. That doubles the IPC and re-render traffic, and it inflates progress counts if the renderer accumulates them.
- **Confidence:** confirmed (code).
- **Fix:** filter by name or subscribe once.

### M7. `storeMessage` can leave a row without its file
- **Where:** `sync.ts:962-1002`.
- **What happens:**
  - `insertMessage` commits first. `rememberContactsOf` then runs inside the same `try`.
  - If the contacts upsert throws (for example `SQLITE_FULL` or `SQLITE_BUSY`), the catch calls `removeFile(relPath)`. The committed row now points to a missing file and is never re-downloaded, since its key is known.
  - An error whose message contains "UNIQUE" from the contacts path is swallowed as an insert race.
- **Confidence:** confirmed (code); it is likely under disk-full.
- **Fix:** put the contacts upsert inside the insert transaction, or move it out of the try and treat its failure as non-fatal.

### M8. `getSyncStatus` does a full scan on every call
- **Where:** `index.ts:261`, which calls `checkFileConsistency` (`index.ts:1381`).
- **What happens:** every status call runs `SELECT file_path FROM messages` over 32k rows plus a `readdir` of about 32k entries. The UI polls status, so this is a constant, avoidable load on the worker's single thread.
- **Fix:** cache the result and refresh it from the maintenance timer.

### M9. UIDVALIDITY staged swap: no resume, no blast-radius guard
- **Where:** `sync.ts:620-676`.
- **Aborted swaps start over:** an interrupted swap (network drop, disk full, app close) deletes every staged row and file in the `finally`, so a large INBOX on a flaky line can restart forever. The rows do persist after a hard kill, but the `__staging__/` folder is then visible in the UI.
- **No guard on empty UID lists:** the full or incremental sync never sanity-checks a `UID FETCH 1:*` that returns empty or truncated, so one bad response deletes all local rows and files for that folder. The data is re-downloadable, but it's a 13.5 GB-scale risk if it hits big folders. This interacts with H2.
  - **Fix:** refuse to expunge more than X% of a folder in one pass unless EXAMINE's EXISTS count confirms it.
- **Disk:** the swap needs twice the folder's size on disk.
- **Low:** `Math.max(...set)` hits the call-argument limit on very large folders (well over 100k).

### M10. `close()` doesn't cover poll- or IDLE-triggered syncs, and timers survive it
- **Where:** `index.ts:1407-1419`, `sync.ts:1400-1405`, and `worker.ts:74-112`.
- **What happens:**
  - `isSyncing()` is only true for `syncAll`. A `syncFolder` started by poll or IDLE keeps running while `store.close()` runs, and its next statement throws "database connection is not open".
  - The 5 s replay timer from `start()`, the poll loop's non-unref'd `setTimeout` and the worker's maintenance intervals are never cleared.
- **Impact:** low in production, because the worker calls `process.exit` straight after. Tests and any in-process restart are affected.
- **Confidence:** confirmed (code).

---

## LOW

- **L1. Instance lock** (`instance_lock.ts`):
  - It is a plain `writeFileSync` with no O_EXCL, so two simultaneous starts can both "acquire" it.
  - Windows PID reuse after a worker crash can block the core for up to 7 days.
  - A real instance running longer than 7 days loses protection.
  - The header comments claim a SQLite `BEGIN EXCLUSIVE` backstop and an exit handler, and neither exists.
  - Electron's single-instance lock reduces the practical risk.
  - Confirmed (code).
- **L2. Connection cap** (`sync.ts:437`): `connectionCount` counts main clients only. The IDLE client is created outside it, and `connection_test.ts:63` opens a third connection while sync and IDLE are running. This conflicts with the "max 2" rule, though it is user-triggered.
- **L3.** `pollOnce` calls `noteServerContact` and `noteSuccess` even when every STATUS call failed and was swallowed. `lastSyncAt` then advances with no real contact; the test only covers a failed connect.
- **L4.** `repairMissingFiles` and `checkFileConsistency` only ever cover the active account.

---

## Verified OK

- **Migrations:**
  - Append-only, and there are no changes to `migrations.ts` since 5dd65f6.
  - Each step is an IMMEDIATE transaction that includes the `user_version` bump.
  - A store from a newer build is refused.
- **FTS consistency:**
  - Every insert goes through `Store.insertMessage` (messages, bodies and FTS in one transaction), including the G5 `storeAppendedDraft` path.
  - Deletes go through `messages_bd`.
  - Flag, folder and key updates don't touch FTS-indexed columns.
  - `updateMessage` deletes and re-inserts the FTS entry by hand.
- **Prune:** gates 0-3 are intact (`sync.ts:479-553`).
- **UIDVALIDITY swap:**
  - Keys are derived from the real folder id (an earlier bug, now fixed).
  - Old files are unlinked only after the swap commits.
- **Files:** written tmp, then fsync, then rename, and the tmp file is kept if the rename fails.
- **Source fetches** use `BODY.PEEK` (imapflow fetch.js:58-70), so a sync never sets `\Seen`.

## What the tests don't prove

- **Untested entirely:** `flagSweep`, `repairMissingFiles`, `sweepOrphans` and `whenIdleForMaintenance`. Nothing tests sharing the sync client with maintenance.
- **mail_store_recovery:** only damages page 1 (bytes 100-4000) or writes a non-DB file. It never covers a corrupt data or FTS page, corruption reached during a migration or the contacts backfill, extended error codes, or the orphan and disk-space consequences of a rebuild.
- **mail_disk_full:** stubs `downloadMessages` and checks one `syncAll`. It never checks poll, IDLE or the `lastSyncAt` loop, or that the banner clears without `resume()`.
- **mail_sync_time:** asserts the timestamp moves, which is the behaviour L3 shows to be wrong. It says nothing about flags.
- **mail_prune_gates:** covers LIST gates only. There is no test of a folder-level mass expunge from an empty or truncated `UID FETCH`.
- **mail_search_oracle:** I have not checked whether it covers capitalised or umlaut prefixes against the vocab cap, all terms being capped (an empty MATCH returning everything) or operator-only queries; a grep for those cases would settle it.
- **Never tested at all:** `uid_next` semantics, the IDLE timer cleanup, double event delivery from `on()`, and `close()` during a poll-triggered `syncFolder`.

## Files

All under `C:\Users\benni\Documents\repos\bookingum-app\src\main\mailclient\`:
- `core\sync.ts`
- `core\index.ts`
- `core\store.ts`
- `core\store_recovery.ts`
- `core\migrations.ts`
- `core\instance_lock.ts`
- `core\connection_test.ts`
- `worker.ts`

Tests: `C:\Users\benni\Documents\repos\bookingum-app\tests\mail_store_recovery.test.ts`, `mail_disk_full.test.ts`, `mail_sync_time.test.ts`, `mail_prune_gates.test.ts`, `mail_files.test.ts`.