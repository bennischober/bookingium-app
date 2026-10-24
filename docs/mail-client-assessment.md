# Mail client: assessment of the prototype and of the port into bookingum

Written 2026-10-24 on `feat/mail-client` at `62f5956` by Claude Opus 5.5, for the agents that continue the work
(opencode with smaller models). It records how mature each part is, what the evidence for that is worth, and
where the risks are. Read it before you change anything in `src/main/mailclient/`.

Companion documents:

- `docs/mail-client.md`: the design and the decisions (why things are the way they are). Do not re-decide them.
- `docs/mail-client-handbook.md`: how the code is built, the conventions, how to verify, traps. **Read before coding.**
- `docs/mail-client-tasks.md`: the work, as task cards with files, steps and acceptance criteria.
- `docs/NEXT_STEPS.md`: the Task 5 review (findings F1–F7), the ordered to-do list and the direction.

---

## 0. Maturity scale used here

| Level | Meaning |
|---|---|
| L0 | Not built. |
| L1 | Built in the prototype only, or built here without tests. |
| L2 | Works against the local sandbox (Dovecot + Mailpit) and has unit or E2E tests in bookingum. |
| L3 | Hardened: fault injection, crash replay, fuzz or soak runs passed **after** the last change to that code. |
| L4 | Verified on real data, read-only (the production IONOS account, full size: ~32k mails, 276 folders). |
| L5 | Write path proven on a real server (canary mailbox), then on the real account, stage by stage. |

Nothing in the mail client is L5. Nothing may be pushed toward L5 without the user (see the canary gate).

---

## 1. Verdict in short

**Prototype** (`D:\Projects\Arbeit\Brainstorm\email-prototype`, Tasks 1–5): a serious piece of engineering. Read-only
sync and search are proven at full size against production (L4). The write path is designed well (journal first,
verify before replay, exactly-once send) and was hardened with fault suites, fuzz and a soak (L3). But Task 5's last
changes (the op hard timeout and the file-write rework) introduced new defects (F1–F4 in `NEXT_STEPS.md`). They
came *after* most of the long-run evidence, so that evidence does not cover them. The write path needs those fixes
and one more long run before a canary.

**Port** (bookingum, `src/main/mailclient/`): a clean, well-layered integration. The core runs in a utility process;
credentials stay in main behind safeStorage; the IPC surface is an explicit allowlist. The UI is a usable desktop mail
client (three panes, multi-select, drag and drop, editor, pop-out window), tested end to end against the sandbox (L2).
But the port is a snapshot of prototype `56bae02` plus bookingum's own changes. It **lacks** the Task 5 safety fixes
(Gate 0, UIDPLUS gates, mutex dedupe) and still has F7. Its write path is **sandbox-shaped**: it cannot write to any
real server, by construction (see R1). That is right for now, but it means "port the fixes, then canary" is not
enough: the write path needs a redesign for real accounts first.

Overall: **reading is close to pilot-ready; writing is a well-tested sandbox feature, not a product feature yet.**

---

## 2. The prototype, area by area

| Area | Level | Evidence | Gaps / caveats |
|---|---|---|---|
| Read-only sync (UID sweeps, tiered FLAGS sweeps, IDLE, UIDVALIDITY swap) | **L4** | Full production download (276 folders, 32,417 mails, 14.5 GB, 0 errors), count and byte checks, overnight IDLE; `test-nocondstore`, `test-pause-resume`, `test-second-client` | No multi-day soak; laptop sleep/resume during IDLE never exercised |
| Prune gates (local deletion only after three gates) | L3 | `test-prune-gates.ts` (13 checks) after Gate 0 (`18eab47`) | — |
| Search (FTS5, weighted BM25, forced two-step plan, prefix cap) | **L4** | 30k synthetic oracle (`test-search-oracle.ts`, 22 checks), production search battery, latency benches | Attachment contents not indexed; no typo tolerance; no time facets |
| Sanitizer, iframe sandbox, remote images | L3 | `test-sanitize.ts`, `test-safety.ts` | No malicious-mail corpus yet |
| Write path: flags, move, delete-to-Trash, undo | L3 | crash points, fuzz, 2 h soak, UIDPLUS-less suite | F2 and F4 apply (timeout releases a foreign lock; abandoned op keeps writing) |
| Write path: expunge from Trash | L3 | `diag-expunge*`, UIDPLUS gating | — (the prototype has the F7 fix; bookingum does not) |
| Send (state machine, `unknown` + probe, never auto-resend) | L3 | crash points, `test-compose.ts` (Bcc policy) | F3: a hard timeout mid-SMTP ends `failed`, which invites a resend; no 25 MB *send* crash test |
| Drafts (save, replay) | L2–L3 | 25 MB crash-replay suite | F5: resume paths leave the old draft (duplicates) |
| File storage (opaque names, DB owns path) | **L1–L2** | `test-file-decoupling.ts` (11) | F1: rows without a file are possible; likely the open "seed 33" flake. Treat as **not proven** |
| Op hard timeout + forced mutex release | **L1** | Built in Task 5 to stop wedges | F2/F3/F4: unsafe as written, redesign needed |
| Core boundary (no HTTP/UI/env in core) | L3 | `test-core-boundary.ts` (18) | The check lives in the prototype only |
| Harnesses (fault proxy, fuzz, soak) | good | `fuzz-long.ts`, `soak-2h.ts`, `fault-proxy.mjs` | Fuzz must run `--parallel 1` (Dovecot caps 10 connections per user+IP) |

**What the long-run numbers are worth** (REPORT5 §8):

- **B4, 1200 seeds:** *not* evidence of correctness. 237 seeds were killed with no output and about 35 have
  truncated details.
- **B5, 150/150 clean, and the 2 h soak, zero drift:** real evidence. But both ran before F1–F4 were found, and
  partly before the timeout code existed in its final form.
- **Seed 33 (I6, missing files):** unexplained in the report. F1 explains it: on Windows the rename of a freshly
  written file fails while Defender or the indexer holds it, and the row then points at a name that does not exist.

**Prototype docs:** REPORT–REPORT5, TASK1–5, `docs/WRITE_PATH.md`, `docs/LESSONS.md` and `docs/SEARCH.md` are good
and worth reading for background. `ROADMAP.md` dates from Task 2/3 and is partly outdated: multi-account and draft
resume exist now, and the paths are prototype paths.

---

## 3. The port into bookingum, area by area

Baseline on 2026-10-24 (`62f5956`): `pnpm typecheck` passes; `vitest` 244 passed / 2 skipped (33 files); Playwright
`mail-client.spec.ts` 14/14 against the sandbox; sandbox per-folder counts are the same before and after the suite.
**`pnpm lint` fails** (19 errors, all in `src/main/mailclient/core/`, see R6).

| Area | Level | Where | Notes |
|---|---|---|---|
| Process model (utility process, crash limit, bounded stop) | L2 | `MailClientService.ts`, `worker.ts`, `protocol.ts` | Good. Worker restarts on account change; 3 crashes in 60 s stop restarts; `stop()` kills after 15 s |
| Credentials | L2 | `accounts.ts` | safeStorage only, never plaintext; the worker asks main per connection; passwords never reach the renderer |
| Account settings + connection test | L2 | `MailAccountsCard.tsx`, `mail.router.ts`, `core/connection_test.ts` | One attempt, 15 s, worker paused for live accounts (≤ 2 connections); saved only when the test passes; rejected login stops all contact |
| IPC surface | L2 | `protocol.ts` `MAIL_API_METHODS`, `mail.router.ts` `call` | Explicit allowlist, checked twice (zod enum in the router, list in the worker); E2E proves unknown methods are refused |
| Store, migrations, bodies table | L2 | `core/store.ts`, `core/migrations.ts` | `PRAGMA user_version`, append-only, newer DB refused; tested in `mail_store_migrations.test.ts` |
| Read-only sync | L2 here (L4 in the prototype at `56bae02`) | `core/sync.ts` | Same engine as the prototype at import, plus bookingum's own changes (honest progress, connection limits, a fresh store per mailbox) |
| Search | L2 here (L4 in prototype) | `core/store.ts` search | The 30k oracle exists only in the prototype |
| Reading UI (sanitized iframe, remote images opt-in) | L2 | `MessageView.tsx`, `core/sanitize.ts` | — |
| Writes: flags, move, drag and drop, delete, archive, undo, multi-select | L2 | `MailPage.tsx`, `MessageList.tsx`, `SelectionActions.tsx`, `MessageMenu.tsx`, core `write_engine.ts` | Sandbox only. Batch moves are one op per mail (slow for large selections, correct) |
| Compose, drafts, reply/forward, send, pop-out window | L2 | `ComposeView.tsx`, `composeDraft.ts`, `core/compose.ts`, `MailWindowPage.tsx` | Sandbox only (Mailpit). No attachments in compose yet |
| Expunge (permanent delete) | **broken** (F7) | `write_engine.ts:344-345` | No UI calls it yet; keep it that way until fixed |
| Folder management | L0 | — | — |
| Integration with persons/companies/invoices/documents | L0 | — | Invoices still go out through `src/main/mail/openEmail.ts` (external program) |
| Production writes | L0 by design | `core/write_guard.ts` | See R1 |

### Code quality of the port

- **Host side** (`MailClientService.ts`, `worker.ts`, `accounts.ts`, `protocol.ts`, `mail.router.ts`): high. Small
  modules, comments explain *why*, errors are German user texts, and failure paths (crash loops, stop deadlines,
  paused worker) are deliberate.
- **Renderer**: good, but `MailPage.tsx` (944 lines) and `ComposeView.tsx` (538) are large. Selection logic was
  pulled into the pure, unit-tested `selection.ts`. That is the pattern to follow: pure logic out of components, with
  tests. Do not split working components preemptively (repo rule); split when you change a concern.
- **Core**: the prototype's style (semicolons, long lines, terse comments, some `any`, empty `catch {}`). It is
  deliberately **not** prettier-formatted, so hand-ports from the prototype stay diffable. Four core files have CRLF
  working copies (`README.md`, `remote_images.ts`, `sanitize.ts`, `write_guard.ts`; the index is LF). Harmless.

---

## 4. Prototype vs bookingum core: what differs

bookingum's core = prototype `56bae02` + bookingum commits (connection limits, migrations, bodies table, fresh store
per mailbox, honest progress, compose core, moves returning ops). Task 5 commits after `56bae02` are **not** in
bookingum:

| Prototype commit | In bookingum? | Action (card in `mail-client-tasks.md`) |
|---|---|---|
| `92cf76a` opaque file names, DB owns path, `checkFileConsistency`, expunge fix | no | F7 part: A1. File part: bookingum already names files `<message_key>.eml` with the DB owning the path; do the write order right instead (A3) |
| `18eab47` Gate 0 (empty LIST never prunes) | no | A2a |
| `fb4411a` UIDPLUS-less: refuse before copy, no plain EXPUNGE, resume in target | no | A2b |
| `98c024f` socketTimeout + error listener | yes, own version (`imap_options.ts`, `sync.ts:345`) | none, do not port again |
| `ae1ad02` single file base + draft Message-ID probe | no | A4 (with the F6 fix) and A5 (with the F5 fix) |
| `b600830` + `8041735` op hard timeout + forced mutex release | no | A6, **redesigned**, never as written |
| `4f962d7` mutex dedupe + self-move refusal | no | A2c (bookingum `write_engine.ts:97` still nests the same folder twice) |
| test suites (prune gates, UIDPLUS-less, big message, search oracle) | no | A8 |

bookingum has things the prototype lacks: versioned migrations, the bodies table, connection-test stages, the
rejected-login stop, moves returning `OpSummary[]` (batch undo), the compose core (`compose.ts`), and the utility
process host. **Never copy prototype files over bookingum's core**: you would silently lose all of that.

---

## 5. Risk register (most severe first)

**R1: the write path is sandbox-shaped, so writes for one account can go to another.**
`write_guard.ts` keeps one module-global `SandboxConfig` (host, ports, user, password). `WriteEngine.sandboxClient()`
and `sandboxSmtp()` always use it, whatever account the op belongs to. `MailClientService.workerInit()` fills it from
the **first** sandbox account. So:

- with two sandbox accounts, writes for the second account go to the first account's mailbox;
- write connections are always `secure: false` with `rejectUnauthorized: false`, and SMTP always uses port 1025;
- a canary on IONOS is impossible without a redesign.

That is safe today, since the guard allows loopback only. But it must be rebuilt before the canary: per-account
write endpoints, TLS, SMTP settings per account, and an account-level allowlist (card A7). Until then, at most one
sandbox account.

**R2: F7, expunge corrupts FTS and unlinks a cwd-relative path** (`write_engine.ts:344-345`). Card A1. No UI calls
expunge yet. Do not add "Papierkorb leeren" before A1.

**R3: self-move deadlock.** `execute()` nests `runUnderFolderMutex` for source and target. If they are equal (a
mail dropped on its own folder, or a batch that includes mails already in the target), the inner acquire waits
forever, and the serial op chain stops for the rest of the session. The UI prevents most self-moves, but the core
must refuse them (card A2c).

**R4: the `.eml` write is not crash-safe.** `sync.ts` `storeMessage` writes the final file in place (no tmp, no
fsync), then inserts the row. A power loss can leave a row whose file is truncated or empty. Fix the write order
properly (A3), and **do not** take the prototype's version (F1).

**R5: the orphan sweep is never scheduled in bookingum.** `MailCore.sweepOrphans()` exists, but neither `worker.ts`
nor `index.ts` calls it, so orphan files only cost disk. That is also why F1-type bugs could not delete mail here
yet. Schedule it only after A3 (card A3, last step).

**R6: `pnpm lint` is red** (19 errors in core: `no-empty`, `no-explicit-any`, unused vars, a control-char regex,
a useless escape), plus about 2350 prettier warnings from core. The repo gate is
`pnpm test && pnpm lint && pnpm typecheck && pnpm build`. Card T1.

**R7: E2E tests depend on each other.** Later tests use the account saved by the first one (`sandboxId`). After a
failure Playwright starts a new worker, which loses that state, so every later test fails with
"Kein E-Mail-Konto eingerichtet". That hides the real failure in noise. Card T3.

**R8: documentation drift.**

- `docs/mail-client.md` said types live in `core/api.ts`; they are in `core/types.ts` (fixed in this commit).
- It said `mail_link` is keyed by a "Message-ID based key", but `message_key` is
  `sha1(account|folder|uidValidity|uid)`: it **changes on every move**. Links must use the Message-ID (see C2).
  Clarified in this commit.
- `core/README.md` still described prototype paths; updated in this commit.

**R9: no CI.** All gates run by hand. Every agent must run them (handbook §6).

**R10: full-size verification exists only in the prototype.** bookingum has not been checked against a full-size
store since import. Before the read-only pilot, run the read-only production checks from bookingum (handbook §7,
with the user's go-ahead).

**R11: big renderer components.** `MailPage.tsx` is the place where the next features (folder management,
attachments, linking) would pile up. Split along concerns as you touch them (folder tree actions, list, reader,
compose state).

---

## 6. What "done" means for the mail client as a product

1. Read-only pilot (gate 2): the user runs bookingum's mail page next to Outlook for 1–2 weeks against the real
   account. Needs: R10 checks, onboarding text for the long first sync, no crashes in the worker log.
2. Canary (gate 3): needs A1–A7 merged, the long fuzz and soak rerun green in the prototype after F1–F6, and the
   user's canary mailbox. Then the write-path suite runs against the canary.
3. Staged writes on the real account (gate 4): flags → move → delete → send, each with a backup and the kill switch,
   and only with the user's explicit go per stage.
4. Integration (cards C1–C7) can be built and tested against the sandbox at any time. Real sending through it waits
   for gate 4 (send).
