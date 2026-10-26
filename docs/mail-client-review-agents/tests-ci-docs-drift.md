# Test, CI and docs review: feat/mail-client (read-only, 2026-10-26)

## 1. Gate results (local, Windows)

**`pnpm -s test` exits 1 (CI would be red).** I ran it twice and got the same result both times.
- **Counts:**
  - 92 files: 90 passed, 2 skipped (`einvoice.verapdf`, `einvoice.kosit`, both because no validator is installed).
  - 675 tests: 673 passed, 2 skipped.
  - **1 unhandled error.** Vitest fails the run because of it.
- **Duration:** about 18.6 s (about 21 s wall).
- **Sandbox suites ran locally:** `mail_crash_points` and `mail_smtp_auth` ran because Dovecot and Mailpit are up.

**The unhandled error is a reproducible `read ECONNRESET` from `tests/mail_write_guard.test.ts`**, in the test "sends each account to its own endpoint with its own credentials".
- **Location:** line 140, `await second.close()`.
- **Cause:** line 140 closes the second fake server's sockets while the imapflow client `other` is still connected. Its `logout()` only runs later, in `afterEach` (lines 100-103). The client socket has no error listener, so the reset escapes as an unhandled error.
- **Fix:** log the clients out before closing the servers. One way is to drop line 140 and close `second` in `afterEach` after the connections.
- **Stale header:** lines 3-4 still say the two-account case "runs against the real sandbox". It uses `fakeImap` now.

**`pnpm -s lint`:** exit 0, with 0 errors and 44 warnings.
- 43 are `prettier/prettier` in the new mail tests, `helpers/fakeSmtp.ts`, `no_pii.test.ts` and `mailProgram.ts`.
- 1 is `react-hooks/incompatible-library` at `data-table.tsx:94`.

**`pnpm -s typecheck`:** exit 0 for both the node and web configs.

## 2. CI (`.github/workflows/ci.yml`)

- **When it runs:** on push to `main` and `feat/mail-client`, and on every pull request.
- **Runner:** `ubuntu-latest` only. There is no Windows job, although this is a Windows-first Electron app.
- **Steps:** pnpm/action-setup@v4, then Node 24, then `pnpm install --frozen-lockfile`, then `pnpm test` (with `CI=true`), lint, typecheck and build.
- **Not run:** no e2e and no e-invoice validators. The header comment says so honestly.
- **Secrets:** none are referenced. No `.env` is used and no artifacts are uploaded, so there is no leak path.

**Would it be green? No.**
1. **ECONNRESET.** The unhandled error above makes `pnpm test` exit 1 on any OS, because it is a socket race and not something local to this machine.
2. **Native module ABI (unverified).** `postinstall` runs `electron-builder install-app-deps && npx @electron/rebuild`, which rebuilds better-sqlite3 for Electron's ABI. Vitest then loads it under plain Node 24.
   - If the ABIs differ, every DB suite fails with `NODE_MODULE_VERSION` on CI.
   - Locally it works, but I did not verify CI.
   - A CI run on the branch is the quickest check. If it fails, rebuild for Node before `pnpm test`.

**What CI cannot prove:**
- With `CI` set, `sandboxRequired()` turns the sandbox suites into skips with a `console.warn`. So these never run in CI:
  - the crash-point replay;
  - the SMTP AUTH proof (`mail_smtp_auth` is gated on IMAP :10143 because of the Sent APPEND, so even the `fakeSmtp` part skips).
- A green CI therefore says nothing about crash safety or sending.
- The workflow comment ("skip there with a visible reason") is accurate, but the job does not fail or annotate when they skip.

## 3. Weak or false-confidence tests

**HIGH: `tests/e2e/mail-canary.spec.ts` cannot pass, and is safe only by accident.**
- **Why it cannot pass:**
  - It uses `CANARY_ID = 'canary'` and calls `mail('getAccount', CANARY_ID)`. But `MailCore.getAccount()` takes no parameter and returns the active account.
  - It then calls `sendMail(draft, null, CANARY_ID)`, `getFolders(CANARY_ID)` and `listMessages(..., CANARY_ID)`. `MailCore.entry()` throws `unknown account "canary"`, because account ids are `randomUUID()` (`accounts.ts:183`).
- **What happens today:**
  - On a fresh e2e profile, the worker is not running and the call throws. The `.catch(() => null)` at about line 89 swallows it, so the test is skipped.
  - With `BOOKINGIUM_E2E_USER_DATA` pointing at a real-profile copy, it fails at `expect(mode).toBe('canary')` or at the send, before any mail goes out.
- **No guard:**
  - There is no explicit opt-in env flag.
  - The spec sits in `testDir`, so a plain `npx playwright test` includes it.
  - If someone "fixes" the id lookup, every full e2e run against a real-profile copy would send real mail through the user's real provider.
  - Remaining safety nets:
    - The write guard refuses `production-readonly` accounts.
    - `sendRefusal` limits canary sends to the account's own address.
- **Other defects:**
  - The `.catch(() => null)` turns any worker crash into a skip.
  - The `onMessage` listeners are never removed.
  - The header (lines 4-6) still describes the old `CANARY_ACCOUNT_ID` constant.
- **Recommendation:** require an explicit env flag such as `BOOKINGIUM_CANARY=1` plus a matching account id. Fail rather than skip when the flag is set but the setup is wrong. Look the account up by its `canary` flag via a list call.

**HIGH: `tests/mail_crash_points.test.ts` overstates what it proves.**
- **Lines 2-4:** the header claims it "kills the process that runs one op, then replays in a fresh process". It kills nothing and starts no process; it runs a pending journal op in the same process.
- **Lines 11-12:** "every mail this suite creates is removed again" is false. Test 1 never removes the mail it moves into CrashB, so it leaves residue in the shared sandbox.
- **Test 1, around line 211:** it accepts either `'done'` or `'conflict'`, asserts only destination +1, and never checks that the source copy is gone.
- **Test 2 cannot fail when nothing is sent:**
  - around line 247 it accepts `'done'`, `'unknown'` or `'failed'`;
  - the replay runs only on `'done'`;
  - lines 258-261 return (a pass) if the Mailpit API is unreachable;
  - line 262 asserts deliveries `<= 1`, so 0 deliveries passes.
- **Mailpit query:** it uses `limit=500`, so on a busy sandbox it can miss the message.

**MEDIUM: `tests/helpers/fakeImap.ts` diverges from real IMAP.**
- **Commands it handles:** CAPABILITY, LOGIN, AUTHENTICATE, LIST (INBOX only), SELECT and EXAMINE (fixed UIDVALIDITY 1, UIDNEXT 100), STATUS, APPEND (without APPENDUID), NOOP and LOGOUT.
- **Commands it fakes:** it advertises `UIDPLUS` and `MOVE` but implements neither. Every other command (UID, MOVE, COPY, EXPUNGE, FETCH, SEARCH, STORE) gets a bare `OK`.
- **Today:** this is fine for its only user, the `mail_write_guard` endpoint and credential wiring.
- **Risk:** any future test that uses it for move, COPYUID or expunge would pass falsely.
- **Fix:** answer `BAD` for unimplemented commands, and stop advertising UIDPLUS and MOVE.

**MEDIUM: `tests/helpers/fakeSmtp.ts`.**
- It advertises `AUTH PLAIN LOGIN` but implements only PLAIN; an `AUTH LOGIN` gets `250 Ok`.
- It does no dot-unstuffing.
- Its only consumer is sandbox-gated, so CI never runs it.

**MEDIUM: `tests/e2e/mail-client.spec.ts` (2050 lines, about 40 tests).** I read part of it and grepped the rest.
- **Order dependence:** the first test deletes all accounts, and later tests rely on the `ensureSandboxAccount` / `ensureReadOnlyAccount` helpers.
- **Silent skips:** `beforeAll` skips the whole file when :10143 is down, and many conditional `test.skip` calls depend on missing Drafts, Sent or Trash, Mailpit, the IONOS-like port or `BAND_ID`.
  - Around line 1369 the skip depends on data: it skips when no mail has an attachment, so the test can silently never run.
- **Cleanup errors swallowed:** `.catch(() => undefined)` at about lines 397, 399, 1203, 1491, 1511 and 1776, so leftovers in the shared sandbox go unnoticed.
- **Fixed sleeps:** `waitForTimeout(300)` at about line 582, and a 3 s `setTimeout` after `triggerSync` at about lines 1491-1492. Both are flake sources.
- **Not done:** I did not run e2e (per instructions) and did not audit every leftover.

**LOW: `tests/sandbox_gate.test.ts` and `helpers/sandboxGate.ts`.**
- The logic is correct: a missing sandbox fails locally, CI skips, and `BOOKINGIUM_NO_SANDBOX=1` opts out. The env is restored after mutation.
- The gap is the CI blind spot described in section 2.

**`tests/no_pii.test.ts`: see section 5.**

## 4. Docs drift

| Location | Says | Fact |
|---|---|---|
| `AGENTS.md:57` (and the same bullet in `src/main/AGENTS.md`) | "Sending mail from the app... nothing is transmitted" | The mail client sends over SMTP (C1, `sendMail`, invoice compose via the client). Only the legacy `mail/` and `invoice:email` path writes files. |
| `src/main/mailclient/AGENTS.md:40-41` | "`sandbox` is one global endpoint for all writable accounts (R1) - never assume per-account sandboxes" | A7 part 1 made the guard per account (`writeRefusal(account)`), and the global `SandboxConfig` is gone. |
| `docs/mail-client-assessment.md:146-147` (R1), `:45`, `:105` | R1: one module-global `SandboxConfig` | Fixed by A7 part 1; R1 should be marked resolved. |
| `src/main/mailclient/core/write_guard.ts:8-11` | Canary "admitted by name... revoked by deleting one constant" | Admission is the `account.canary === true` flag (lines 22-34 of the same file), set by a UI toggle. The canary is admitted for **all** writes (flags, move, delete, expunge), not only sends; `sendRefusal` only restricts recipients. |
| `tests/e2e/mail-canary.spec.ts:4-6` | `CANARY_ACCOUNT_ID` constant | Flag-based (8ca6fd4). |
| `docs/mail-client-tasks.md:36`, `:502-510` | A7 part 2 "APPROVED, not yet built", `CANARY_ACCOUNT_ID` constant, "never from the UI" | Built in 820d30f, then changed in 8ca6fd4 to a flag plus a UI danger toggle ("Als echtes Testpostfach freigeben"). That contradicts the approved "never from the UI" design and needs explicit sign-off. |
| `docs/mail-client-tasks.md:29`, `:549-550` | P1 "open" / "still running" | Prototype REPORT6.md (2026-10-25, commit eb005b1) closes F1, F1b and F2-F6, and the 2000-seed fuzz is clean on both profiles. But the soak's own verdict is `SOAK FAIL invariantFails=1` (a transient orphan that healed itself), and seed 33 on profile B failed 19 of 20 runs with an error class that was never identified. So P1 is "done with residuals"; the strict acceptance was not met. |
| `docs/mail-client-tasks.md:38` vs `:892-896`, `:71`, `:565-566` | A9 "blocked on A7 part 2 and P1" | The same file says A9 phase 1 was done manually by the user, and G2/G4 record deletes and moves on the real IONOS mailbox. Those are phase-2-class writes, while `:565-566` says phase 2 needs its own go-ahead. The H-section claim that the "harness stays for repeatability" is wrong: the harness is broken by the id mismatch in section 3. |
| `docs/mail-client-tasks.md:539-540` | Sandbox tests use `it.skip` when the sandbox is closed | Since 393dcfa they fail locally and skip only with `CI` or `BOOKINGIUM_NO_SANDBOX=1`. |
| `docs/mail-client-tasks.md:534` | `mail_uidplus` "yes (:10144)" | Not verified; that suite is not in the `sandboxGate` users. |
| `docs/mail-client-tasks.md:26` | T2 "done (this commit)" | Stale relative reference. |
| `tests/AGENTS.md` | "33 files, ~6.1k LOC"; mail skips are sandbox-absence guards | 92 vitest files; the sandbox suites fail locally when it is missing. |
| `tests/e2e/AGENTS.md` | `mail-client.spec.ts` "692L, 14 tests"; lists `probe.spec.ts` | It is 2050 lines with about 40 tests. `probe.spec.ts` was deleted in 8ca6fd4, and `mail-canary.spec.ts` is missing from the list. |
| `docs/mail-client-handbook.md:199` | Baseline: vitest 244 passed / 2 skipped; lint fails with 19 errors | Now 673 passed / 2 skipped / 92 files, plus 1 unhandled error. Lint has 0 errors and 44 warnings. |
| `src/main/mailclient/core/README.md:205-206` | "a move renames the file and updates the row" | Since A3, file names are opaque and permanent, so a move only updates the row (`write_engine.ts:908`). |
| `src/main/mailclient/core/README.md:124` | `sweepOrphans` "not yet scheduled" | The worker schedules it (`src/main/mailclient/worker.ts:77`, `:87`). |
| `tests/mail_write_guard.test.ts:3-4` | Runs against the real sandbox | Uses `fakeImap`. |
| `tests/mail_crash_points.test.ts:2-4`, `:11-12` | Kill and fresh process; all mail removed | Neither is true (section 3). |

## 5. PII

**What `tests/no_pii.test.ts` actually scans:**
- Only git-tracked `src/main/db/seed.ts`, `tests/**`, `scripts/**` and `sample_data/*.example.json`, limited to `.ts`, `.tsx`, `.mjs`, `.js` and `.json`.
- It skips comment lines entirely (around line 84).
- It detects only email addresses and mod-97-valid IBANs. It does not detect names, phone numbers, postal addresses or BICs.
- Its own header describes this scope accurately.
- **It is much narrower than the AGENTS.md rule** ("in code, seeds, tests or commit messages"). It does not scan:
  - `docs/**` or any `*.md`;
  - `src/**` other than `seed.ts`;
  - commit messages or history.

**Branch history scan** (`5dd65f6..HEAD`, added lines plus commit messages). Counts and file names only:
- **Current tree:**
  - `docs/mail-client-tasks.md`: **1 address that looks real** (around line 892). It appears to be the user's real canary mailbox. It was missed because docs are not scanned. Recommend replacing it with a placeholder.
  - `src/main/mailclient/core/address.ts` (2) and `src/renderer/src/components/mail/AGENTS.md` (1) are trivial `a@b`-style examples.
- **History only (since removed, but still in branch history):**

  | File | Addresses | Added in | Removed in | Assessment |
  |---|---|---|---|---|
  | `tests/mail_address_guard.test.ts` | 29 | a54a1f0 | c0ab4a8 | 1-2-character domains, likely synthetic |
  | `tests/mail_recipient_lookup.test.ts` | 18 | f2047f5 | 26d2888 | |
  | `tests/mail_contacts_backfill.test.ts` | 8 | f2047f5 | 26d2888 | All on a freemail domain; **could be real, needs a human check** |
  | `tests/mail_recipient_lookup_service.test.ts` | 4 | f2047f5 | 26d2888 | |

  - `tests/mail_signature.test.ts`: 2 phone-like strings, likely fixtures.
- **Commit messages:**
  - The 26d2888 message names 2 real company or provider domains.
  - a54a1f0 has 3 trivial single-letter addresses.
  - 4999e93 has 1 address that needs a human check.
- **Nothing else found:** 0 valid IBANs, and no committed data files (`.eml`, `.sqlite`, `.db`, `test-results/`).
- **Implication:** if any of the history items are real, squashing or rewriting before merging to `main` is the only way to remove them. The removal commits do not remove them from history.

## 6. Recommended order

1. Fix the ECONNRESET in `mail_write_guard` so `pnpm test` exits 0. Then confirm CI on Ubuntu, especially the better-sqlite3 ABI after `postinstall`.
2. Fix the canary spec:
   - an explicit opt-in env flag;
   - account lookup by the `canary` flag;
   - fail instead of skip when the flag is set.
   Also decide formally on the UI-toggle canary and the manual phase-2 writes already done.
3. Make `mail_crash_points` able to fail:
   - require exactly 1 delivery;
   - fail when Mailpit is unreachable;
   - check that the source is gone;
   - clean up CrashB.
4. Have `fakeImap` answer `BAD` for unimplemented commands.
5. Widen `no_pii` to `docs/**` and `*.md`, and add a commit-message check. Replace the real address in `docs/mail-client-tasks.md`. Have a human review the 4 history files and commit messages listed in section 5 before merging.
6. Correct the docs-drift rows in section 4. The AGENTS.md "nothing is transmitted" bullet and the R1 "global sandbox" bullet matter most, because they misdirect agents.
7. Optionally add a Windows CI job and a scheduled sandbox job (Dovecot and Mailpit service containers), so crash and SMTP suites run somewhere other than a developer machine.

Nothing was edited or committed. I ran no e2e, no build and no app, and connected to no mail server.