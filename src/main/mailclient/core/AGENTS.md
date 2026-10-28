# src/main/mailclient/core - Mail Engine

**Score:** 9 (distinct domain: dependency-free engine with its own rules)

## OVERVIEW
The mail engine itself: SQLite/FTS5 store, IMAP sync, crash-safe write playback,
MIME compose, sanitizing. Runs in the utility process; `core/README.md` is the full
module map and factory reference - read it before changing anything here.

## WHERE TO LOOK
| Task | Location |
|---|---|
| Add/change an `Api` method | `types.ts` (contract) + the collaborator that implements it (`message_views.ts`, `op_api.ts`, `folder_api.ts`, `draft_api.ts`, `maintenance.ts`, `account_entries.ts`) + its one-line delegation in `index.ts` (`MailCore`) |
| Mail schema change | `migrations.ts` (append-only, `PRAGMA user_version`) |
| Message/folder/thread queries, search | `store.ts` (weighted BM25, facets, op journal) |
| IMAP sync, IDLE, UIDVALIDITY | `sync.ts` (façade) -> `folder_sync.ts`, `idle_poll.ts`, `sync_connection.ts` |
| Flag/move/delete/expunge/send playback | `write_engine.ts` (queue, watchdog, preflight, flags, expunge) -> `write_moves.ts`, `write_send.ts`, `write_folders.ts` |
| Which host may be written to | `write_guard.ts` - the only write-path guard |
| Reply/forward/draft MIME | `compose.ts` |
| MIME parsing | `parse.ts` - every `simpleParser` call goes through it; do not import mailparser elsewhere |
| Large message without its large parts (S1) | `skeleton.ts` (pure); equivalence proven by `tests/mail_skeleton_sandbox.test.ts` |
| Storing a large message as its skeleton (S1) | `skeleton_fetch.ts`, used by `folder_sync.ts` downloadMessages and `maintenance.ts` repair; `lazyAboveBytes` in `sync.ts` |
| Reading a stored file's large parts (S1) | ask `ensureComplete` (`message_complete.ts`) first, through the views' or drafts' context; never parse a `complete = 0` row's file for attachment bytes |
| HTML mail sanitizing | `sanitize.ts` (DOMPurify + jsdom, the only DOM user) |
| Remote images | `remote_images.ts` |
| Account dialog connection test | `connection_test.ts` |
| Single-instance data-dir lock | `instance_lock.ts` |

## CONVENTIONS
- Dependency-free by design: no Electron, tRPC, renderer, `process.env`, console or
  hard-coded paths/ports/URLs (the sandbox allowlist is the one exception). The host
  injects `dataDir`, `sandbox`, `credentials()`, `log` and `clock` via
  `createMailCore`; `log` defaults to silent.
- Style is the prototype's (semicolons, long lines) and deliberately NOT
  prettier-formatted, so hand-ports stay diffable.
- `dataDir` must be absolute; one folder per account; `.eml` files are always opened
  as `path.join(<account dir>, row.file_path)`.
- `close()` is idempotent and bounded: first drain the write op in flight (8 s by
  default, so a send is not cut off mid-SMTP), then stop IDLE/polling, wait for an
  in-flight sync, checkpoint WAL, release the lock. Replay happens on the next
  `start()`, never in `close()`; a send left in the `smtp` phase or `unknown` is
  probed there, never resent.
- Sandbox endpoints are injected, never read from env.

## ANTI-PATTERNS
- `prettier --write` on this folder; copying prototype files over it.
- Writing outside `write_guard.ts` - the sync engine must never write.
- Wiping local data before a staged swap; UIDVALIDITY reset must never wipe.
- More than 1 sync + 1 IDLE connection, or skipping the per-folder mutex.
- Trusting a cached SELECT in the write path (`write_engine.ts`, `write_moves.ts`); blanket `EXPUNGE`; auto-resending
  a send whose outcome is unknown; awaiting the imapflow fetch AsyncGenerator.
- Editing a shipped migration, or opening a store from a newer build.
- Two instances on one store (the lock makes that structurally impossible).

## HOTSPOTS
- `index.ts` 363 + `op_api.ts` 463 + `message_views.ts` 373 - `MailCore` after R2: events, lifecycle and
  delegations; the op journal calls; the read calls. `account_entries.ts`, `folder_api.ts`, `draft_api.ts`,
  `maintenance.ts` and `message_keys.ts` hold the rest.
- `write_engine.ts` 625 + `write_moves.ts` 486 + `write_send.ts` 391 - op playback after R3: queue, watchdog,
  preflight, flags and expunge; moves; send and drafts. `write_folders.ts` and `write_select.ts` hold the rest.
- `store.ts` 993 - schema, FTS5 search, op journal (has `as any[]` and one
  `console.log` that violate the folder's own rules).
- `sync.ts` 746 + `folder_sync.ts` 515 + `idle_poll.ts` 481 - the sync engine after R1:
  façade, one folder's tiered pass, IDLE and polling.
