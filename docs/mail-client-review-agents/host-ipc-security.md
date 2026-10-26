## Review: main-process host, IPC, integration and security boundaries (feat/mail-client)

Scope: MailClientService/worker/protocol/accounts/attachments, mail/mail_link/invoice routers, MailLinkService, SearchService, src/main/mail, preload, index.ts window and IPC handlers, migrations 0010-0015, and the core sanitize/remote_images/address/write_guard modules. I made no edits.

Cross-cutting context that affects every IPC finding: preload exposes `window.electron = electronAPI` from @electron-toolkit/preload. That gives the renderer a generic `ipcRenderer.invoke/send` on any channel, so the per-channel allowlists in preload provide no protection. The windows also run with `sandbox: false`. Any renderer compromise (including H1 if it is ever combined with a script vector) therefore reaches every `ipcMain` handler directly.

---

### HIGH

**H1. HTML sanitizer bypass via `</style >`**
- **Where:** `src/main/mailclient/core/sanitize.ts:139` (lift-out regex) and `:220` (raw re-insertion).
- **Confirmed** by running the real `sanitizeEmailHtml` under Node 24.
- **How it works:** style blocks are cut out with `/<style\b[^>]*>([\s\S]*?)<\/style>/gi` before DOMPurify runs. They are then pasted back as raw strings: `` `<style>${css}</style>` ``. The textContent assignment at :156 is thrown away, because the output uses the `styles` string, not `doc.head`.
- **Scenario:** a mail contains `<style>a{}</style ><form>…<a href="ms-settings:…">…<meta http-equiv=refresh…><style>b{}</style>`. The regex treats everything up to the second `</style>` as CSS, so it skips DOMPurify. The browser, however, closes the style element at `</style ` (the space is legal), so all markup in between is live in the reading pane.
- **Impact:**
  - Forms, meta, blocked-scheme anchors and arbitrary attributes come back.
  - These links are missing from the links manifest, so the "visible URL" UI is bypassed.
  - `href` values to any scheme survive. With `allow-popups-to-escape-sandbox`, clicking one can launch protocol handlers.
  - Scripts and form submission are still blocked by the iframe sandbox (no allow-scripts, no allow-forms) and by the meta CSP. That is why this is High rather than Critical. The phishing and UI-spoofing surface is fully open.
- **Confidence:** high.
- **Fix:** build the head through DOM APIs (`doc.head.appendChild(styleEl)` with textContent) and serialize `doc.documentElement.outerHTML`. At minimum, reject or escape any CSS that matches `/<\/style/i` or contains `<`. Make the lift-out regex tolerant of `</style\s*>`. Add a regression test with `</style >`, `</STYLE\t>` and nested cases.

**H2. Arbitrary local file read through the compose PDF channels**
- **Where:** `src/main/index.ts:176-219` (`openComposeWindow`, which calls `composePdfs.add(input.pdfPath)`) and `:568-575` (`mail:readComposePdf`). Preload line ~54 exposes `composeInOwnEditor`.
- **Scenario:** renderer code calls `mail:composeWindow` with `pdfPath: 'C:/Users/…/mail/accounts.json'` (or any file), then calls `mail:readComposePdf` with the same path and receives the file as base64. The "only registered paths" guard is self-registering. The set also never shrinks.
- **Confidence:** high.
- **Fix:** register the path only inside the `invoice:email` handler, which knows the PDF it just wrote. Pass an opaque token to the compose window instead of a path. Remove the entry after it is read or the window closes, and do not accept `pdfPath` from the renderer.

**H3. Duplicate invoice mail (C1) on double Ctrl+Enter or retry after "Versand unklar"**
- **Where:** `src/renderer/src/components/mail/ComposeView.tsx`, `send()` (~395 onward) and the onKeyDown Ctrl+Enter handler.
- **Scenario 1:** `send()` has no `if (busy) return` guard, and the keyboard path bypasses the disabled button. Pressing Ctrl+Enter twice quickly creates two sendMail ops, each with its own Message-ID, so the customer gets the invoice twice.
- **Scenario 2:** a send that ends `unknown` throws "Versand unklar" and leaves the editor open. Clicking Send again creates a new op and Message-ID, so the dedup or probe logic cannot match it and the mail can go out twice.
- **Scenario 3:** in that `unknown` case, `composeSent` is never fired, so the invoice is never marked emailed even if a later probe shows it was delivered.
- **Confidence:** high for scenario 1, medium for scenarios 2 and 3.
- **Fix:** add a ref-based in-flight guard. Generate the Message-ID once per compose session and reuse it on retry. Make the main side idempotent per invoice (refuse a second send within the session). Mark the invoice from a probe-confirmed result.

**H4. Account signature (B8) is never shown and is wiped on edit**
- **Where:** `src/main/mailclient/accounts.ts`, `toDto` (~297-307) omits `signature`.
- **Consumers:** the renderer reads `account.signature` in MailPage ~509, MailWindowPage ~164/227 and MailAccountsCard ~132, and always gets undefined.
- **Scenario:** the signature is never inserted into new mails. Opening and saving the account form sends `signature: undefined`, which overwrites the stored value. This has been broken since a0171c6.
- **Test gap:** only the pure `withSignature` helper is tested.
- **Confidence:** high.
- **Fix:** include `signature` in the DTO. Merge on update with `input.signature ?? existing.signature` (the same anti-pattern AGENTS.md warns about). Add a round-trip test: create, toDto, update without signature, signature still present.

---

### MEDIUM

**M1. The canary write guard can be opened from the renderer, and the canary flag survives host edits**
- **Where:** `core/write_guard.ts:117-129`, `accounts.ts:327-372`, `mail.router.ts:35-53` and MailAccountsCard ~185-222.
- **The server trusts the renderer for `kind:'sandbox'` and `canary:true`.** There is no main-side `is.dev` or packaged-app check; the DEV-only gating exists only in the UI. Once canary is set, any real host becomes writable: flags, moves, `expungeFromTrash`, `deleteFolder` and send.
- **Editing the account does not drop canary.** Changing host, port or user keeps `canary`. A new id is assigned but no re-confirmation happens, so a different, real mailbox silently becomes writable.
- **The send recipient check uses a free-text field.** `sendRefusal` limits recipients to `account.email`, but that field is free text. Setting it to someone else's address defeats "own address only".
- **The allowlist is not loopback-only.** `sandbox-dovecot` and `sandbox-mailpit` are on SANDBOX_ALLOWLIST but resolve through DNS, while the connection uses `rejectUnauthorized:false`.
- **Confidence:** high on mechanism. Exploitation needs renderer access or a dev build.
- **Fix:**
  - Enforce sandbox/canary creation main-side (dev only, or behind an explicit main-process confirmation dialog).
  - Clear `canary` whenever host, port, user or email changes.
  - Restrict the allowlist to literal loopback IPs, or pin certificates.

**M2. C1 picks the wrong account for invoice sending**
- **Where:** `index.ts:535`, `listMailAccounts().find(a => a.kind === 'sandbox')`.
- **Scenario:** the first sandbox account may be the local Mailpit sink. In that case the invoice is marked emailed with a messageId although the customer received nothing. If it is the canary instead, every customer send is refused by `sendRefusal`. Either way the feature as wired cannot do what the UI implies.
- **Confidence:** high.
- **Fix:** use an explicit "invoice sending account" setting, validated main-side as writable for that recipient, and fail closed with a clear message.

**M3. Invoice mail can be sent without the invoice PDF**
- **Where:** `ComposeView.tsx` ~430.
- **Scenario:** `readComposePdf` returns '' (path not registered, file moved, read error). The mail is sent with no attachment and no error, and the invoice is marked emailed.
- **Confidence:** high.
- **Fix:** treat a missing PDF as a hard error for invoice composes. Have main attach the PDF itself rather than round-tripping base64 through the renderer.

**M4. Remote image loading: no body timeout or size cap, SSRF to LAN, renderer-chosen URLs**
- **Where:** `core/remote_images.ts:53-78` and `index.ts` ~380.
- **Timeout and size:** `clearTimeout` runs once the headers arrive, so `res.arrayBuffer()` has no timeout. The size is checked only after the whole body is buffered, and Content-Length is never checked. An endless or multi-GB image response can hang the worker or run it out of memory. Repeated crashes then trigger the worker crash lockout, which is a denial of service of the mail client.
- **SSRF:** there is no filter for private, loopback or link-local addresses and no check on redirects (`redirect:'follow'`). "Bilder laden" therefore issues blind GETs to `127.0.0.1:*`, `192.168.*` or router admin URLs chosen by the mail author.
- **URL source:** the URLs come from renderer arguments (`loadRemoteImages(id, remoteImages)`), not from the stored message's sanitized manifest.
- **Confidence:** high.
- **Fix:**
  - Keep the abort timer running through the body read.
  - Stream the body with a running byte cap and reject on Content-Length.
  - Resolve the host and block private ranges, and re-check every redirect hop (or use `redirect:'manual'`).
  - Derive the URL list main-side from the message.

**M5. Opening attachments: no Mark-of-the-Web, incomplete executable list, renderer-supplied filename**
- **Where:** `mail.router.ts:140-178` and `attachments.ts`.
- **No Mark-of-the-Web:** temp files are opened with `shell.openPath` without a Zone.Identifier ADS, which bypasses SmartScreen and Office Protected View for macro documents.
- **Incomplete executable list:** it misses url, pif, cpl, msc, wsf, wsh, chm, scf, iso, img, vhd, vhdx, appinstaller, msix, appx, settingcontent-ms, library-ms, search-ms, docm, xlsm, pptm, html, htm, svg, py, and others.
- **Renderer-supplied filename:** the filename comes from the renderer, not from the message metadata.
- **RTLO not stripped:** U+202E is kept, so names like `invoice\u202Efdp.exe` are spoofed in the warning dialog.
- **Temp folder collision:** the temp subfolder `${messageId}-${partId}` can collide across accounts.
- **`openAnyway` is trusted:** the flag comes from the renderer with no main-side confirmation.
- **Confidence:** high.
- **Fix:**
  - Write `:Zone.Identifier` (ZoneId=3).
  - Invert the check to an allowlist of safe-to-open types, with everything else going to "Speichern unter".
  - Take the filename from the stored attachment metadata.
  - Strip bidi control characters.
  - Show the confirmation dialog main-side.

**M6. MailLinkService cursor check: full rescans, and missed mails after a store rebuild**
- **Where:** `MailLinkService.ts:278-290`, `storeHasRowAt`.
- **The check is stricter than its comment.** It requires a row exactly at the cursor, while the comment says "at or below". If the last-scanned mail is deleted or moved, the cursor resets to 0 and the whole mailbox is rescanned.
- **The rescan blocks the main process.** It runs synchronously there, in batches of 500, with about 4 queries per address plus per-link selects and inserts, and no transaction per batch. At a mailbox of ~30k mails that is a multi-second UI freeze, repeated whenever this happens.
- **The opposite case loses links.** A rebuilt store that happens to have a row at id = cursor is not detected as rebuilt, so new mails with id ≤ cursor are never linked.
- **Confidence:** medium-high.
- **Fix:** key the cursor to a store generation or UIDVALIDITY plus id rather than a bare row id. Use `id <= cursor` semantics. Wrap each batch in one synchronous transaction and yield between batches.

**M7. Thread inheritance re-links owners the user dismissed**
- **Where:** `MailLinkService.ts:156-170`.
- **Scenario:** `threadOwners` does not filter `dismissed`. After the user dismisses a wrong link, every reply in that thread links the dismissed owner again.
- **Confidence:** high.
- **Fix:** exclude dismissed (entity, thread) pairs when inheriting.

**M8. Path traversal in `invoice:email` (pre-existing)**
- **Where:** `src/main/mail/openEmail.ts:136-137`, `` join(folder, `${fileName}.pdf`) `` with `fileName` from the renderer.
- **Scenario:** `../../..\\Startup\\x` writes a file outside the folder. A legitimate invoice name containing `/` fails with ENOENT.
- **Confidence:** high.
- **Fix:** sanitize the name with the existing `safeAttachmentName`, then assert the resolved path stays under the folder.

**M9. Stored password sent to any host by the connection test**
- **Where:** `mail.router.ts:115-128`.
- **Scenario:** `accounts.test` with an `id` and no password uses the stored password against whatever host and port the renderer supplies, such as a typo, an edited field or an attacker's host. The user's IMAP password goes to a third party.
- **Confidence:** high.
- **Fix:** only use the stored secret when host, port and user match the stored account. Otherwise require the password to be re-entered.

---

### LOW

**L1. Close-hold protocol and window lifecycle**
- **Where:** `index.ts:83-104`.
- `closing` is never reset after a held close fails, so the window can no longer be closed normally.
- Compose windows are not in `mailWindows`. Closing the main window leaves them open and the app keeps running.
- On macOS, a quit that begins at `before-quit` (Cmd+Q) stops the worker before the windows save their drafts. The draft save's `mail.call` then re-spawns a worker that is never stopped. This risks draft loss and a stray process.
- Closing the compose window while a send is in flight can run `finish({sent:false})` before `composeSent`. The mail goes out but the invoice is not marked emailed.
- **Confidence:** medium.

**L2. Linker errors swallowed, and some Sent folders never linked**
- **Where:** `index.ts:675`.
- `.catch(() => undefined)` hides linker failures with no log.
- The linker runs only on folder-done for INBOX or `*SENT`, so "Gesendete Objekte" (Exchange/Outlook German) is never linked.
- **Fix:** log the error, and use the folder's special-use `\Sent` flag.

**L3. Shared-address cap counts contacts, not owners**
- The 20-contact limit is generous for shared addresses like `info@`, and aliases of the user's own address are not excluded, so own mail can be linked to many records.

**L4. Migrations**
- 0011-0014 are hand-written and have no meta snapshots; only 0010 and 0015 do, though the journal lists all of them. Commit 5563502 already had to hand-trim a drifted generate.
- The coalesce unique index on `mail_link` is not declared in `schema.ts`, so a future `db:generate` may try to drop it.
- The delete triggers cover all 7 entity types, and no applied migration was edited.
- **Fix:** add the index to schema.ts (or document it as SQL-only), and regenerate snapshot parity once.

**L5. D3 archive filtering (checked, mostly fine)**
- These all filter correctly: list, search, dashboard, calendar feed, search service, contact list and band documents.
- By-id reads (ContractRepository:20, InvoiceRepository:372/448, DocumentRepository:64, DealMemo getById) are intentionally unfiltered.
- Follow-ups and invoices stay visible on purpose, as the commit message says.
- `mail_link.router.ts:53` (a band's mails include its events) includes archived events. That is arguably correct for an audit trail, but undocumented.
- No defect found.

---

### Doc drift

- **AGENTS.md and src/main/AGENTS.md** still say the app never sends mail ("nothing is transmitted"). C1 invoice sending and the canary path now transmit over SMTP. This guidance will mislead future agents into treating sendMail as dead code.
- **The `write_guard.ts` header** says accounts are "admitted by name … revoked by deleting one constant", but admission is now a persisted, renderer-settable `canary` flag (see M1).
- **The worker comment** calls remote images "opt-in", but `enabled: true` is hard-coded. The opt-in is only the per-message click.

### Verified OK

- `mail:openWindow` input validation; `mail:copyLink` scheme allowlist.
- `print:openPdf` is restricted to the `savedPdfPaths` set; `showEmailFile` checks the dirname.
- `setWindowOpenHandler` allows only http, https and mailto.
- Attachment "save as" goes through the native dialog.
- `safeAttachmentName` handles traversal and reserved names, and the executable check runs on the final name.
- The worker re-checks the `MAIL_API_METHODS` allowlist.
- `sendMail` awaits the real SMTP result; a failure cancels the op, and unknown or conflict results throw.
- Credentials are encrypted with safeStorage.
- The renderer CSP blocks remote iframe navigation.

### Test gaps (highest value first)

1. A sanitizer regression test for the `</style >` family, asserting that no element outside the allowlist survives and that every anchor is in the manifest.
2. IPC tests showing that `readComposePdf` refuses unregistered paths and that `composeWindow` cannot register one.
3. An account DTO round-trip test that preserves the signature and clears canary when the host changes.
4. A main-side test that sandbox/canary creation is refused outside dev.
5. Remote image tests: body timeout, streamed size cap, private-IP and redirect rejection.
6. A ComposeView double-submit test, plus an idempotent invoice-send test.
7. MailLinkService tests: deleted-cursor-row (no full rescan), store rebuild, and dismissed-owner inheritance.
8. Traversal tests for the `invoice:email` filename.
9. An executable-extension table test, including RTLO names.

### Notes on method

- H1 was confirmed by running the real sanitizer under Node 24 type stripping (a harmless MODULE_TYPELESS warning).
- No app run, no mail server contact, no .env or key files read, and no mail content was viewed or printed.