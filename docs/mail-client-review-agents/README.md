# Raw reports behind `docs/mail-client-review.md`

These are the five read-only agent reports that `docs/mail-client-review.md` (commit `d59b8e9`) was written
from. They are kept unedited, so the evidence behind each MR entry (line numbers, imapflow traces, test
names) is not lost. Line numbers are as of `811f04a` and have moved since.

| File | Area |
|---|---|
| `core-write-path.md` | op journal, write engine, send, folders, batch moves, canary guard |
| `core-sync-and-store.md` | sync, flag sweep, repair, store, recovery, search, IDLE, instance lock |
| `host-ipc-security.md` | worker host, IPC, preload, sanitizer, remote images, attachments, mail linking, migrations |
| `renderer-mail-ui.md` | ComposeView, MailPage, MailWindowPage, MessageView, shortcuts, InvoiceForm |
| `tests-ci-docs-drift.md` | gates, CI, weak tests, fake servers, docs drift, PII |

## Coverage check (2026-10-26)

Every Critical, High and Medium finding in the five reports is in the review doc, as its own MR entry, merged
into one, or in the Low list. The items below are the ones that were **not** carried over, or only in part.
None of them is above Medium. Pick them up from here; the source report is named in brackets.

### Not in the review doc

**Write path and core**
- A `draft_save` stranded in `running` is replayed at the next start and appends an older version after the
  user saved a newer one [write path L7]. I1 stops connect failures from stranding ops (MR-02), so check
  whether a crash between APPEND and the journal update still gets here. The `attempts > 0` probe from MR-15
  finds the old copy by Message-ID, but the replay may still run on a stale body.
  **Fixed in I17:** a draft save carries its compose key; a replay that a newer save of the same compose
  superseded is a noop and removes only its own copy, and a save also removes the copy the latest earlier
  save appended.
- `storeAppendedDraft` adds to `passInsertedMsgIds` outside a sync pass, which skews move correlation
  [write path L6].
  **Fixed in I17:** it stores the draft outside the pass's correlation set.
- The UIDVALIDITY swap [sync M9]:
  - after a hard kill the `__staging__/` folder is visible in the UI;
  - the swap needs twice the folder's size on disk;
  - `Math.max(...set)` hits the argument limit on folders well above 100k mails.

  **Fixed in I12:** staging is hidden from the folder list and every cross-folder view, and a stopped swap
  resumes. The spread `Math.max` went in I4.
  **Fixed in I18:** the swap checks the free space before it downloads and stops through the disk-full path,
  naming the folder and the missing room.
- The IDLE client is created outside `connectionCount`, so the sync cap of 2 does not count it [sync L2].
  The review doc has only the connection-test half.
  **Fixed in I15a:** sync, IDLE and writes share one budget per account. The connection test stays outside
  it (a one-shot check before the account is saved).
- Corrupt-store recovery: extended codes (`SQLITE_CORRUPT_VTAB` from FTS, `SQLITE_IOERR_SHORT_READ` for a
  truncated file) fall through `isCorruptStoreError` [sync M3, plausible]. MR-26's `startsWith` fix covers
  the first, not the second.
  **Fixed in I12:** extended codes, `SQLITE_IOERR_SHORT_READ` and the `cause` chain are matched.

**Host**
- The temp folder for opening attachments, `${messageId}-${partId}`, can collide across accounts
  [host M5].
  **Fixed in I17:** the folder name carries a hash of account, message and part (`attachmentSubfolder`).
- The shared-address cap of the mail linker counts contacts, not owners, and aliases of the user's own
  address are not excluded, so own mail can be linked to many records [host L3].
  **Fixed in I15b:** the cap counts the records behind the address, and every configured account's address
  (and its login, when that is an address) counts as the user's own.
- An invoice whose send ended "Versand unklar" is never marked emailed [host H3, scenario 3]. **Partly fixed
  by I2:** "Im Ordner Gesendet prüfen" calls `onSent`, which reports `composeSent`. Still open when the
  compose window was closed and the startup probe confirms the send later: nothing marks the invoice then.
  The report also suggests refusing a second send per invoice in main.
  **Fixed in I7:** the send is recorded as pending under its send key before it goes out; the send itself or
  any later `send` op that settles `done`/`noop` (startup probe, "Prüfen") confirms it and marks the invoice
  once, in one transaction. A second send per invoice is not refused: each is its own mail.

**Renderer**
- The compose branch of `MailWindowPage` renders `ComposeView` without a `canWrite` check (defence in depth
  only) [renderer 17].
  **Fixed in I16.**
- `MailWindowPage` invalidates only folders and the message, so an `isDraft` or folder change of the shown
  mail is not picked up until a refetch [renderer 18].
  **Fixed in I16:** the window follows every event of its account.
  **Fixed in I18:** `MailPage` marks another account stale on its events, and a sync refreshes `search`.
- The "Archiviert" toast counts `ids.length`, including ids the core skipped [renderer 20]. MR-36 covers the
  hiding, not the count.
  **Fixed in I10.**
- The "Alle Anhänge" `<div aria-label>` has no role, so the label is ignored [renderer 22].
  **Fixed in I16.**
- `MailWindowPage.tsx:199` (`presetPdfPath` in the non-compose branch) is unreachable [renderer 15]. The
  review doc has only the unused `search.pdfName`.
  **Fixed in I16**, together with the unused `pdfName`.

**Tests, CI and PII**
- `fakeSmtp` does no dot-unstuffing [tests 3].
  **Fixed in I9.**
- `mail_crash_points` queries Mailpit with `limit=500`, so on a busy sandbox it can miss the message
  [tests 3].
  **Fixed in I9:** `limit=1000`.
- `mail-canary.spec.ts` never removes its `onMessage` listeners [tests 3]. Still true after I6 moved it to
  `tests/e2e-canary/`: electron-trpc's exposed `onMessage` gives no way to remove one.
- CI neither fails nor annotates when the sandbox suites skip [tests 2].
  **Fixed in I9:** a skipped sandbox suite writes a `::warning::` annotation.
- `tests/no_pii.test.ts` skips comment lines and detects only email addresses and IBANs: no names, phone
  numbers, postal addresses or BICs [tests 5]. The review doc covers only which files it scans.
  **Fixed in I17:** comment lines are scanned, and phone numbers, BICs and street addresses are detected.
  The fixtures that already held some are counted per file until a person checks them. Names are not
  detected: no pattern tells a real name from an invented one.
- Docs drift rows missing from section 8 [tests 4]:
  - `docs/mail-client-tasks.md:534` claims `mail_uidplus` runs on the sandbox; unverified, the suite is not
    a `sandboxGate` user;
  - `docs/mail-client-tasks.md:26` "T2 done (this commit)" is a stale relative reference;
  - the `write_guard.ts` header implies the canary is a send-only exception, but the flag admits every write
    (flags, moves, folder delete, expunge); `sendRefusal` restricts only recipients.

  **Fixed in I17:** all three rows.

**Test gaps** named by the reports but not in section 4:
- `mail_prune_gates` has no folder-level mass-expunge case (empty or truncated `UID FETCH 1:*`);
- nothing tests `uid_next` semantics, the IDLE timer cleanup, the double event delivery, or `close()`
  during a poll-triggered `syncFolder`;
- `mail_search_oracle` was not checked for capitalised or umlaut prefixes, an all-capped query, or
  operator-only queries;
- `mail_compose_body` has no forward-header, `<url>` or `<addr>` case for `toEditorHtml` (this is MR-08's
  regression test).

**Fixed:** the mass expunge in I12 (`mail_store_integrity`), `uid_next` in I4 (`mail_mailbox_selection`), the
IDLE timer and the double events in I15a (`mail_connections`), the search cases in I15b
(`mail_search_fold`), the forward header in I5 (`mail_compose_body`). `close()` during a poll-triggered
`syncFolder` in I17 (`mail_close_during_sync`): it was a real bug, `close()` waited only for a full pass and
closed the store under a poll or a folder sync.

### Corrected, not dropped

- **Seed 33.** The tests report says it "failed 19 of 20 runs on profile B". The prototype's numbers are
  20/20 on A and 19/20 on B, i.e. **one** failure. The review doc's "failed 1 of 20" is right.

### Deliberately left out

- Items each report listed under "Verified OK".
- Synthetic test addresses and phone-like fixtures in branch history (`a54a1f0`, `mail_signature.test.ts`):
  the reports themselves rate them as fixtures. The items that need a human look are in review section 6.
- The one lint warning outside the mail tests (`data-table.tsx:94`): the review counts it in its 44 warnings.
