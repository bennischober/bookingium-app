# The mail core

Self-contained mail engine, extracted in the prototype (Task 5 Step 1) and developed in
bookingum since 2026-10-23: this copy is the source of truth (see docs/mail-client.md). Nothing in this folder imports the HTTP server,
the browser client, or anything UI-related; there are no `process.env` reads and no
hard-coded paths, ports or URLs anywhere in `app/core/`. Static regression checks for
all of these claims live in `app/scripts/test-core-boundary.ts` (8 checks).

## Module map

| File | Role |
|---|---|
| `index.ts` | `createMailCore(options)` factory + `MailCore` (implements the full `Api` contract), lifecycle (`start()`/`close()`), orphan sweep |
| `store.ts` | SQLite/FTS5 storage: folders, messages, threads, contacts, **search** (weighted BM25, facets, snippets), **operation journal** |
| `sync.ts` | `SyncEngine`: two-way IMAP sync (CONDSTORE/QRESYNC tiered + UID-sweep fallback), IDLE, pacing, circuit breaker, staged UIDVALIDITY swap |
| `write_engine.ts` | `WriteEngine`: crash-safe execution of flag/move/delete/expunge/send/draft ops, serialized playback, verify-before-replay |
| `write_guard.ts` | THE write guard: fixed sandbox allowlist + `assertSandboxHost`; sandbox endpoints are injected (`injectSandboxConfig`), never read from env |
| `sanitize.ts` | HTML mail sanitizer (DOMPurify + jsdom) — the only module needing a DOM |
| `remote_images.ts` | opt-in remote-image fetch (URL → data: URI, size/type limited) |
| `types.ts` | data types + `Api`/`Transport` contracts (moved from `shared/api.ts`; `shared/api.ts` re-exports them) |
| `instance_lock.ts` | single-instance protection: data-dir lock file + PID liveness check |

Import direction is one-way: `server/` (HTTP host) → `core/`, `client/` → `shared/api.ts` → types in `core/types.ts`. The core imports nothing back.

## Factory

```ts
import { createMailCore } from './core/index.js';

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
  sinkProbe: async (messageId) => boolean,   // optional send-sink probe (Mailpit in the prototype)
  log: { info?, warn?, error? },             // default: silent
  clock: () => number,                       // default Date.now (deterministic tests)
  remoteImages: { enabled: true, ... },      // omit = remote images stay blocked
  forceNoCondstore: false,                   // test hook: force the UID-sweep sync strategy
});

core.api;        // MailCore IS the Api implementation (same method surface as shared/api.ts)
core.on('sync-event', cb);   // sync progress events (see below)
core.on('op-event', cb);     // write-op journal state changes
core.start();    // initial sync + IDLE + polling + pending-op replay (5 s after start)
core.sweepOrphans();  // remove .eml files without rows (grace 10 min) — host schedules it
await core.close();   // shutdown contract, see below
```

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
`close()` and on process exit. This makes the Task 4 double-server incident
(two processes racing the same SQLite store) structurally impossible.

Note: constructing `Store`/`SyncEngine` directly (as test suites do) bypasses the lock
by design — the lock protects whole app instances, not individual components.

## What needs what

- **jsdom + DOMPurify**: only `sanitize.ts`. Pure JS, creates its own DOM — runs in a
  plain Node process or Electron main/utility process. Never needed in a renderer.
- **better-sqlite3**: `store.ts` (native module — rebuild for Electron's ABI).
- **imapflow / mailparser**: `sync.ts`, write paths, attachment parsing.
- **nodemailer**: `write_engine.ts` (SMTP send).
- **Node built-ins only** otherwise (`fs`, `path`, `crypto`, `net`, `events` semantics
  via plain callbacks). `process.memoryUsage()` is read for the `getSyncStatus()`
  `serverRssMB` field (observability; works in Electron main/utility too).

## Dependencies & licenses (app/core runtime deps)

| Package | Version | License |
|---|---|---|
| better-sqlite3 | 13.0.3 | MIT |
| imapflow | 2.9.0 | MIT |
| mailparser | 3.12.3 | MIT |
| nodemailer | 10.2.1 | MIT-0 |
| dompurify | 3.4.17 | (MPL-2.0 OR Apache-2.0) |
| jsdom | 29.1.1 | MIT |

All permissive; none GPL/MPL-only. `dotenv` is a **host** concern (server/index.ts),
not a core dependency.

## State to copy

The core owns and creates everything it needs under the host-provided `dataDir`:
per-account SQLite DBs (`<id>.db` + WAL/SHM), `.eml` blob files named by
`message_key`, and the `.mailcore.lock` file (runtime). Copying `app/core/` into the
Electron app requires no other files except `core/types.ts`'s consumers:
`app/shared/api.ts` re-exports the same types for the UI (keep that file or inline it).
