# src/main/mailclient - Built-in IMAP Client

**Score:** 12 · 18 files, 5k LOC, 62 import references

## OVERVIEW
A complete IMAP/SMTP mail client living in the main process: host service, account
store, a utility-process worker, and the self-contained `core/` engine.

## STRUCTURE
| Path | Role |
|---|---|
| `MailClientService.ts` | host: starts/stops the utility process, relays calls, events and credential requests, crash cap (3 / 60 s) |
| `worker.ts` | utility-process entry (second electron-vite main input `mailWorker`), hosts the core |
| `protocol.ts` | `ToWorker`/`FromWorker`/`MailEvent` messages + `MAIL_API_METHODS` allowlist (33 methods) |
| `accounts.ts` | `<userData>/mail/accounts.json`, password via `safeStorage` only |
| `core/` | the engine - see `core/AGENTS.md` |

## WHERE TO LOOK
| Task | Location |
|---|---|
| Add a callable mail method | `core/types.ts` (`Api`) -> `protocol.ts` (`MAIL_API_METHODS`) -> `api/routers/mail.router.ts` |
| Account CRUD / credential handling | `accounts.ts` |
| Worker lifecycle and status | `MailClientService.ts` (`startIfConfigured`, `status`, `call`) |
| Renderer-facing procedures | `../api/routers/mail.router.ts` (`call`, `status`, `events`) |
| Sync/store internals | `core/README.md` |

## CONVENTIONS
- Import direction is one-way: `worker.ts` -> `core/`; the core imports nothing
  back and never Electron, tRPC or the renderer. The renderer only imports types
  (`core/types.ts`, `allowsPlainLogin`).
- The worker runs SQLite, sync and FTS indexing off the main process; the main
  process stays responsive. `MailClientService` never blocks on a core call.
- Passwords exist only in `accounts.ts` (encrypted) and are decrypted per
  connection on request from the worker; they never reach the renderer.
- Adding a core method is a three-file change: the `Api` contract, the
  `MAIL_API_METHODS` allowlist, then the router. Anything not on the allowlist is
  refused.
- `mailRoot()` is `<userData>/mail`; the core's `dataDir` is `<userData>/mail/data`
  with one folder per account.
- `sandbox` is one global endpoint for all writable accounts (known limitation,
  docs/mail-client-assessment.md R1) - never assume per-account sandboxes.

## ANTI-PATTERNS
- Storing or logging a plaintext password; saving an account when `safeStorage`
  is unavailable.
- Exposing credentials or `mailCredentials()` to the renderer.
- Calling the core directly from the main process to bypass the worker (blocking
  SQLite work).
- Running `prettier --write` over `core/**` or copying prototype files over it.
- Adding GPL/MPL-only dependencies (DOMPurify is used under Apache-2.0).
- Treating this store as authoritative: links to persons/invoices belong in the app
  database, the mail store is rebuildable from the server.

## HOTSPOTS
- `core/sync.ts` 1306 and `core/index.ts` 918 - the two files almost every mail
  bug lands in.
- `protocol.ts` + `core/types.ts` - the cross-process contract; both must agree.
