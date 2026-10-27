# tests/e2e - KNOWLEDGE BASE

**Score:** 8 (23 specs, 118 import refs) - distinct domain: only Playwright surface.

## OVERVIEW
Playwright specs that launch the BUILT Electron app (`out/main/index.js`) against a
throwaway userData folder and assert on rendered German UI or written files.

## WHERE TO LOOK
| Task | Spec | Notes |
|------|------|-------|
| Shell, routing, print | `app.spec.ts`, `navigation.spec.ts` | `printPageToPdf` helper |
| Pages | `band-page`, `company-page`, `person-page`, `venue-page`, `contact-list`, `list` | role/label navigation |
| Invoices / PDF / e-invoice | `einvoice.spec.ts`, `invoice-email.spec.ts`, `payment-qr`, `payment-reminders` | writes `__screenshots__/einvoice-*` |
| Mail client | `mail-client.spec.ts` | 2167L, 34 tests, sandbox-gated |
| Import / export / calendar | `import`, `import-bands`, `export`, `calendar-feed`, `follow-ups` | |
| Launch + app handle | `helpers/launch.ts` | `launchApp`, `createTestUserData`, `AppHandle` |
| Mail sandbox seeding | `helpers/mailSandbox.ts` | `seedMailSandbox`, `removeSentTestMails` |
| PDF probes | `helpers/pdf2png.mjs`, `pdf-text.mjs` | CLI, not imports |

## CONVENTIONS
- One launch per spec: `h = await launchApp()` in `test.beforeAll`, `await h.close()` in
  `test.afterAll`. Never launch per test - startup dominates.
- `pnpm build` first: specs run the compiled `out/main/index.js`, not the sources.
- Locate elements by role/label text (`getByRole('link', { name: 'Rechnungen' })`), never
  by CSS class; assertions quote German UI labels literally.
- Native dialogs are monkeypatched inside main via `app.evaluate`, e.g.
  `dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never` -
  the `as never` cast is the accepted idiom here.
- Artifacts go to `resolve(process.cwd(), 'tests/e2e/__screenshots__')` (gitignored).
  A renderer PNG failure is logged and tolerated; the PDF is the assertion target.
- In-app tRPC calls go through `page.evaluate` against `window.electronTRPC`
  (`mail-client.spec.ts` wraps this as `trpc()`).
- Config: `testDir ./tests/e2e`, 1 worker, `fullyParallel: false`, 60s timeout, no trace.
- The canary run is NOT here: `tests/e2e-canary/mail-canary.spec.ts`, its own
  `playwright.canary.config.ts`, opt-in with `BOOKINGIUM_CANARY=1` (I6).

## ANTI-PATTERNS
- Never point a spec at a real profile: default is a fresh `mkdtemp` userData. If
  `BOOKINGIUM_E2E_USER_DATA` is set it is used as-is and must NEVER be deleted.
- Keep `BOOKINGIUM_NO_LAUNCH=1` in `launch.ts`: it makes "send by e-mail" write files only
  instead of opening a real mail program.
- Never assert on PNG pixels (no pixel diffing exists) and never commit `__screenshots__`.
- Mail specs must use the suite's own sandbox user (`bookingum-e2e@example.test`) and clean
  up only their own subject prefix - Mailpit is shared. Never use `testuser@example.test`,
  never stop/reset the sandbox containers.
- `test.skip(!(await reachable(port)), …)` is a sandbox-absence guard, not a way to hide a
  red test; a skipped mail run is NOT a pass.
- `probe.spec.ts` is an ad-hoc debugging scratch file - no coverage value, do not extend it.
- `helpers/xpdfrc` is unreferenced dead config.
- `.mjs` helpers are the only files exempt from `explicit-function-return-type`; do not
  widen that override.

## HOTSPOTS
- `mail-client.spec.ts` 2167L - own IMAP/HTTP helpers, highest complexity.
- `einvoice.spec.ts` 189L feeds `tests/einvoice.verapdf.test.ts`; changing its output
  filenames silently disables that validator test.
- `launch.ts` is imported by all 23 specs - a signature change ripples repo-wide.

## COMMANDS
```bash
pnpm build                                     # required first
npx playwright test                            # all specs
npx playwright test tests/e2e/einvoice.spec.ts # one spec
BOOKINGIUM_E2E_USER_DATA=/path npx playwright test
```
Mail specs need the Dovecot/Mailpit sandbox on 127.0.0.1:10143 / 10144 / 1025 / 8025.
