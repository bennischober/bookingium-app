# The mail core

Self-contained mail engine. It was extracted in the prototype (Task 5 Step 1) and has been
developed in bookingum since 2026-10-23: this copy is the source of truth (see
docs/mail-client.md). Changes from the prototype are ported by hand, never by copying files
over this folder (docs/mail-client-assessment.md §4 lists what would be lost).

Nothing in this folder imports Electron, the renderer, tRPC or anything UI-related; there are
no `process.env` reads and no hard-coded paths, ports or URLs except the sandbox allowlist in
`write_guard.ts`. The host is `../MailClientService.ts` (main process) and `../worker.ts`
(the utility process that runs the core). The prototype's static boundary check
(`test-core-boundary.ts`) has not been ported yet (docs/mail-client-tasks.md, A8).

## Module map

| File | Role |
|---|---|
| `index.ts` | `createMailCore(options)` factory + `MailCore` (implements the full `Api` contract), lifecycle (`start()`/`close()`), orphan sweep |
| `store.ts` | SQLite/FTS5 storage: folders, messages, threads, contacts, **search** (weighted BM25, facets, snippets), **operation journal** |
| `migrations.ts` | Versioned schema migrations (`PRAGMA user_version`): append-only list, one transaction each, a DB from a newer build is refused |
| `sync.ts` | `SyncEngine`: two-way IMAP sync (CONDSTORE/QRESYNC tiered + UID-sweep fallback), IDLE, pacing, circuit breaker, staged UIDVALIDITY swap |
| `write_engine.ts` | `WriteEngine`: crash-safe execution of flag/move/delete/expunge/send/draft ops, serialized playback, verify-before-replay |
| `write_guard.ts` | THE write guard: fixed sandbox allowlist + `assertSandboxHost`; sandbox endpoints are injected (`injectSandboxConfig`), never read from env |
| `compose.ts` | MIME building for new mail, reply, reply-all, forward and drafts (built once, sent and appended as the same bytes) |
| `connection_test.ts` | One-shot staged connection test for the account dialog (DNS, TCP, TLS, login, folders) |
| `imap_options.ts` | Shared ImapFlow options (timeouts, socket error listener) |
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

## Factory

```ts
import { createMailCore } from './core/index';

const core = createMailCore({
  dataDir: '/abs/path/data',           // REQUIRED absolute; accounts get subdirs <dataDir>/<id>
  accounts: [{
    id: 'main',
    kind: 'sandbox',                   // or 'production-readonly'
    host: 'imap.example.com',
    port: 993,
    credentials: async () => ({ user: 'u', pass: 'p' }),  // host supplies (Electron safeStorage)
    email: 'me@example.com',           // optional display identity (From header fallback)
  }],
  sandbox: { imapHost, imapPort, smtpHost, smtpPort, user, pass },  // REQUIRED if any account is writable; hosts must be on the guard allowlist
  sinkProbe: async (messageId) => boolean,   // optional send-sink probe (Mailpit)
  log: { info?, warn?, error? },             // default: silent
  clock: () => number,                       // default Date.now (deterministic tests)
  remoteImages: { enabled: true, ... },      // omit = remote images stay blocked
  forceNoCondstore: false,                   // test hook: force the UID-sweep sync strategy
});

core.api;        // MailCore IS the Api implementation (types.ts)
core.on('sync-event', cb);   // sync progress events (see below)
core.on('op-event', cb);     // write-op journal state changes
core.start();    // initial sync + IDLE + polling + pending-op replay (5 s after start)
core.sweepOrphans();  // remove .eml files without rows (grace 10 min) — host schedules it (not yet scheduled, see docs/mail-client-tasks.md A3)
await core.close();   // shutdown contract, see below
```

Note on `sandbox`: it is ONE global endpoint for all writable accounts (the host passes the
first sandbox account). With more than one sandbox account, writes for the second one would go
to the first one's mailbox. See docs/mail-client-assessment.md R1 and task A7.

Credentials are resolved **lazily per connection** through the host-provided
`credentials()` function and are cached only in memory (`ensureCredentials`). The core
never reads `.env`, never logs credentials, and never stores them on disk.

## Events emitted

Subscribed via `core.on(name, cb)`:

| Event | Payload | Meaning |
|---|---|---|
| `sync-event` | `SyncEvent` (`{ type: 'folder-list' \| 'folder-start' \| 'folder-done' \| 'error', path, message }`) | per-folder sync progress; also drives the pollable `getSyncStatus()` |
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
- **imapflow / mailparser**: `sync.ts`, write paths, attachment parsing.
- **nodemailer**: `write_engine.ts` (SMTP send).
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
the SQLite DB (+ WAL/SHM) and the `.eml` files, and the `.mailcore.lock` file. The `.eml`
file name is `<message_key>.eml` and the row's `file_path` holds it; a move renames the
file and updates the row. Always open a file as `path.join(<account dir>, row.file_path)`,
never relative to the working directory. All of it can be rebuilt from the server: nothing
that must survive (links to persons, invoices) may live here — that belongs in bookingum's
app database.
