RENDERER BUG HUNT: bookingum mail client (feat/mail-client). This was a read-only review. I edited and ran nothing. No mail content was read from any data directory.

Status legend: "Confirmed" means I verified it by reading the code. "Plausible" means it depends on behaviour I did not fully trace.

## HIGH

**1. toEditorHtml passes any reply or forward text through as raw HTML** (Confirmed)
- Where: src/renderer/src/components/mail/composeBody.ts:166-167 (`if (/<[a-zA-Z/][^>]*>/.test(body)) return body`). The result is fed to `el.innerHTML` in ComposeView.tsx:256-262.
- What triggers it: any text containing `<letter…>`.
  - Every forward of a sender with a display name. composeDraft.ts:108 writes `Name <a@b.de>`.
  - Quoted plain-text parts with `<https://…>` or earlier `Name <x@y>` attribution lines.
  - A literal "<b>" the user typed into a saved draft.
- Failure 1, the body is mangled: the text is parsed as HTML. Newlines collapse, and `<a@b.de>` becomes an unknown element that disappears. After the first keystroke, bodyText is re-derived from that DOM, so the sent mail has a one-line quote with the addresses missing.
- Failure 2, security: attacker-controlled mail text, fromName or subject becomes live markup in the privileged renderer (sandbox:false, window.api exposed).
  - CSP `script-src 'self'` blocks scripts and inline handlers.
  - `style-src 'unsafe-inline'` allows an injected `<style>` that restyles or overlays the whole app, for example hiding or faking the To field. That is UI redress inside the trusted window.
  - Injected form controls and buttons inside the compose `<form>` are also possible (Plausible: I did not check whether navigation is blocked).
- The outgoing body is still filtered by ALLOWED on send, but the editor itself is not.
- Fix: never sniff for HTML. Escape plain text always. Use HTML only for `bodyHtml`, and only after it has gone through composeBody's allowlist sanitizer. Add unit cases for a forward header, `<https://…>` and a literal `<b>`.

**2. Enter in the Betreff field sends the mail** (Confirmed)
- Where: ComposeView.tsx. The subject `<Input>` (~659) sits inside `<form onSubmit>` (~545), which has a `type="submit"` button, so implicit submission fires.
- RecipientField's onKeyDown returns without `preventDefault` when the chip text is empty (~167). Enter in an empty An/Cc field therefore also submits.
- Failure: the user types a subject, presses Enter to move on, and a half-written mail is sent. If the subject is empty, it goes out after only the "Ohne Betreff senden?" prompt.
- Fix: don't make the editor a submitting form, or `preventDefault` Enter in single-line fields. Send only via the button and Ctrl+Enter.

**3. Ctrl+Enter / submit can send twice** (Confirmed)
- Where: `send()` (ComposeView.tsx:403-454) has no `busy` re-entry guard. Ctrl+Enter (549-554) calls it directly.
- Failure: a key repeat, or Ctrl+Enter followed by a click, starts two `sendMail` calls before `setBusy` re-renders. Both await the same `queue.current`. The result is two sent copies, or the second send failing on an already-deleted draftUid.
- Fix: a `sendingRef` guard at the top of `send()`.

**4. Autosave races with send and leaves an orphan draft** (Confirmed in the renderer; the core outcome is Plausible)
- Where: ComposeView.tsx:304-312 and 403-454.
- Mechanism: `send()` awaits `queue.current` and then calls `sendMail`, but never clears the pending autosave timer. `closed.current = true` is set only after `sendMail` resolves. If the user typed less than 1.5 s before sending, the timer fires during `sendMail`. `save()` then queues `saveDraft(input, draftUid)` against the draft that the send is consuming.
- Result: a new draft is appended in Entwürfe after the mail was sent.
- Fix: in `send()`, set a `sending` flag or `closed` first and clear the timer. Have the timer callback check it, and make `save()` refuse while sending.

**5. C1 invoice compose window garbles umlauts** (Confirmed)
- Where: main/index.ts:195 encodes the draft as UTF-8 base64. MailWindowPage.tsx:51 decodes it with bare `atob()`, which is Latin-1.
- Failure: the default invoice body ("über", "Rechnung …") and any recipient name or subject with umlauts appear as "Ã¼ber" in the editor and are sent to the customer like that.
- Fix: `new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)))`.
- Test gap: the C1 e2e test (mail-client.spec.ts ~1210-1306) overwrites the subject and never asserts the body, so the bug is invisible.

**6. Archive inside the Archive folder hides mails until restart, with a false success toast** (Confirmed)
- Where: MailPage.tsx:643/668/1292. `hasArchive` is global, so Archivieren is offered in the menu, the bulk pane and the reader even when the mail is already in Archive.
- Mechanism:
  - The core's `moveToFolder` silently skips self-moves (core/index.ts:477-479) and returns `[]`.
  - `moveAway` has already hidden the rows. With `done = []` and `notDone = []` it shows "Archiviert".
  - The G7 release effect (MailPage.tsx:405-417) only un-hides an id once the list no longer contains it, but the mail never leaves.
- Result: the rows stay invisible until an account switch or restart. A mixed selection (some already archived) hides those mails the same way.
- Delete in Trash is correctly filtered by `trashable`. Archive has no equivalent filter.
- Fix: filter archivable items as with `trashable`, and hide the action when the folder is Archive. Defensively, in `moveAway`, un-hide any id that is not covered by a returned op.

## MEDIUM

**7. Header-address "write to" buttons appear on read-only accounts** (Confirmed)
- Where: MessageView.tsx:350-363 and 523-541 render a button whenever `onWriteTo` is passed. MailPage.tsx:1295 and MailWindowPage.tsx:226 always pass it; the `canWrite` gate (MessageView 265) covers only the toolbar. The prop doc says "writable accounts only".
- Failure: on the production read-only account, clicking a sender opens a full editor.
- The core WRITE GUARD rejects the writes, which still fails badly:
  - Autosave failures are swallowed (`save().catch(() => undefined)`, line 308).
  - The user types a whole mail, and leaving the editor gives only "Entwurf konnte nicht gespeichert werden", so the text is lost.
  - Send fails at the end.
- Fix: pass `onWriteTo` only when `canWrite`, in both pages.

**8. Global mail shortcuts ignore dialogs and non-text compose controls** (Confirmed)
- Where: `isTypingTarget` (shortcuts.ts) checks only input, textarea, select and contenteditable. The MailPage keydown effect (842-895) has no dialog or compose check.
- Failures:
  - Delete or Entf while focus is on a compose toolbar button, a recipient chip or attachment remove button, a Radix confirm dialog or a popover trashes the selected list mail behind it.
  - Ctrl+N or Ctrl+R with focus on a compose button replaces the open editor. The unmount save keeps the draft, but this is surprising and also triggers a save toast.
- Fix: return early if `target.closest('[role=dialog],[role=alertdialog],[data-compose]')` or when `compose` is open, for destructive keys.

**9. hiddenIds survive an account switch** (Confirmed in the renderer)
- Where: MailPage.tsx:936-945 resets folder, selection, compose and search, but not `hiddenIds`. Message ids are per-account store rowids, so collisions between accounts are possible.
- Failure: an in-flight or stuck hidden id (see #6) hides an unrelated mail in the other account. The release effect then drops it, but only once data arrives.
- Fix: `setHiddenIds([])` on account change, or key the set by account.

**10. Reopening a saved draft loses its formatting** (Confirmed)
- Where: `fromSavedDraft` sets `bodyHtml: null` (composeDraft.ts).
- Failure: bold, italic and list formatting from F3 disappears on reopen. Combined with #1, a draft containing a literal `<…>` is re-parsed as HTML.
- Fix: carry the stored HTML through, sanitized.

**11. Autosave re-uploads every attachment every 1.5 s of typing** (Confirmed)
- Where: `toDraftInput` includes the base64 attachments. `isDirty` JSON-stringifies them on every check, and each save sends them all over IPC and to the core's APPEND.
- Failure: with a 10-20 MB attachment, typing is sluggish (stringify on each keystroke-triggered effect) and every save is a multi-MB IMAP APPEND.
- Fix: hash or ID the attachments for the dirty check, or upload them once and reference them.

**12. `addFiles` does not set `edited.current`** (Confirmed)
- Effect: adding an attachment to an untouched reply does not start autosave. Only the unmount save catches it, and closing the window holds the close via beforeunload. This is minor, but inconsistent with F5's "saved while typing".

**13. MailWindowPage spins forever when `getDraft` fails** (Confirmed)
- Where: MailWindowPage.tsx:114-128 and 172. When `isSavedDraft` is true and `compose` is null, a spinner shows. On rejection it only toasts; `compose` is never set.
- Fix: track an error state and fall back to MessageView or an error message.

**14. Invoice form event picker** (Confirmed; this is the D3 check)
- Where: InvoiceForm.tsx:182-186 takes the first 100 non-archived events with no server search.
- Failures:
  - Editing an invoice linked to an archived event, or to an event beyond the first 100, shows an empty selection.
  - `eventDate` in the e-invoice readiness check (line 301) becomes null and can flag "incomplete" wrongly.
- The other pickers (AttachmentToDocumentDialog, DocumentRepository, getAllPaginated) correctly exclude archived events through `notArchived()`. I found no archived-event leak into pickers.
- Fix: a server-side search, and resolve the selected id separately.

## LOW

15. **Dead plumbing in MailWindowPage.**
    - `search.pdfName` is threaded from main to the URL to `composeRequest` but never used. ComposeView names the attachment from the `presetPdfPath` basename (ComposeView ~429).
    - Line 199 (`presetPdfPath={composeRequest?.pdfPath}` in the non-compose branch) is unreachable.
16. **The preset PDF is not counted against MAX_ATTACHMENT_BYTES.** It is attached after validation in `send()`.
17. **The compose-mode branch of MailWindowPage renders ComposeView without a `canWrite` check.** Main picks a sandbox account, so this is defence-in-depth only.
18. **Subscription filtering is incomplete.**
    - MailPage ignores events for other accounts, so their caches stay stale until refetch.
    - The sync event does not invalidate `search` results.
    - MailWindowPage invalidates only folders and the message, so an `isDraft` or folder change of the shown mail is not re-derived until refetch.
19. **Redundant signature in MailPage.tsx:1295.** `composeTo(address, signature)` is passed into `startCompose`, which applies `withSignature` again. It is harmless only because `withSignature` dedupes by `includes`; use one place.
20. **Undo after a not-done op.** `moveAway` shows "Rückgängig" on partial failure toasts using only the done ops. That is correct, but the success toast count uses `ids.length` even when some ids were skipped by the core (see #6).
21. **Maintainability.** MailPage.tsx is 1313 lines; pages/AGENTS.md says 944 and components/AGENTS.md says ComposeView is 538 lines while it is ~739. The docs have drifted. The keyboard effect re-subscribes on every render (no deps). That works but is wasteful, and it reads `trashable` and `selection` from the render closure.
22. **Accessibility.**
    - Reader toolbar icon buttons use only `title`, with no `aria-label` (MessageView 269-341). Screen readers get the title, but inconsistently with the link-copy button, which has an `aria-label`.
    - The "Alle Anhänge" `<div aria-label>` has no role, so the label is ignored.

## CHECKED AND OK
- MessageView hook order: the subscription is above the early returns (c9487a0 holds).
- iframe sandbox: no allow-scripts and no allow-same-origin.
- The link list goes through the main-process window-open handler, which allows only http, https and mailto.
- The executable-attachment second confirm is in place.
- The MessageList Delete key handler calls `stopPropagation`, so there is no double trash.
- Drag source and folder-move are gated by `canWrite`.
- The drop handler filters same-folder moves.
- The unmount save captures the old `accountId` on account switch.
- Close-hold: main and mail windows both use createAppWindow's will-prevent-unload and mail:closeWindow path.
- The draft save queue (`draftUid` replace chain) serialises autosaves correctly. The only hole is #4.

## TEST GAPS
- **tests/mail_compose_body.test.ts.** `toEditorHtml` is covered only for `'<p><b>fett</b></p>'`, plain text, a reply, an empty string and `'a < b'`. There is no forward header, `<url>` or `<addr>` case, which is exactly where #1 lives.
- **mail-client.spec.ts, C1 test.** It never asserts the body text or umlauts (#5).
- **No test for:**
  - Enter-to-send in Betreff (#2)
  - double send (#3)
  - autosave during send (#4)
  - archive inside Archive (#6)
  - shortcuts with a dialog open (#8)
  - hiddenIds across account switch (#9)
  - a read-only header-address click (#7)
- **No renderer component tests exist at all.** The optimism tests (mail_renderer_optimism, mail_optimistic_race) cover only the pure `hide`/`unhide`/`visible` helpers, not MailPage's release effect or the empty-ops path.

## KEY FILES
- C:\Users\benni\Documents\repos\bookingum-app\src\renderer\src\components\mail\composeBody.ts
- C:\Users\benni\Documents\repos\bookingum-app\src\renderer\src\components\mail\ComposeView.tsx
- C:\Users\benni\Documents\repos\bookingum-app\src\renderer\src\components\mail\composeDraft.ts
- C:\Users\benni\Documents\repos\bookingum-app\src\renderer\src\components\mail\MessageView.tsx
- C:\Users\benni\Documents\repos\bookingum-app\src\renderer\src\components\mail\shortcuts.ts
- C:\Users\benni\Documents\repos\bookingum-app\src\renderer\src\pages\MailPage.tsx
- C:\Users\benni\Documents\repos\bookingum-app\src\renderer\src\pages\MailWindowPage.tsx
- C:\Users\benni\Documents\repos\bookingum-app\src\renderer\src\components\forms\InvoiceForm.tsx
- C:\Users\benni\Documents\repos\bookingum-app\src\main\index.ts (line 195, the encoding side of #5)
- C:\Users\benni\Documents\repos\bookingum-app\src\main\mailclient\core\index.ts (lines 466-539, the self-move skip behind #6)