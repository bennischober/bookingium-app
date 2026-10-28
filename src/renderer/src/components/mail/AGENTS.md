# src/renderer/src/components/mail - KNOWLEDGE BASE

**Score:** 9 (10 files, 39 exports, 50 import refs) - the only renderer feature with unit-tested
pure logic.

## OVERVIEW
Mail-client UI (IMAP/SMTP via the main process). TSX views for list, folders, message, compose; three
`.ts` modules hold the pure logic so vitest can test it without a DOM. Anything mail outside the mail
page shows only while `useMailClientEnabled()` is true (the experimental switch, off by default).

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Message list | `MessageList.tsx` | selection, drag source (`MAIL_DRAG_TYPE`), snippets |
| Message reading | `MessageView.tsx` | `mailApi.getMessage`, remote images, attachments, raw .eml |
| Compose / reply / forward | `ComposeView.tsx` (917L) | draft save/send/discard, contact autocomplete |
| Folder tree | `FolderTree.tsx` | `FolderDrop` contract for drag-to-folder |
| Pane layout | `PaneResizer.tsx`, `MessageMenu.tsx`, `SelectionActions.tsx` | |
| Sync bar | `SyncIndicator.tsx` | connection, running op, retry countdown (`useNow`) |
| MailPage's state and handlers | `@/hooks/useMailSearch`, `useMailOps`, `useMessageActions`, `useFolderActions`, `useMailShortcuts` | R4; `paging.ts` holds the shared `PAGE_SIZE` |
| Draft state machine | `composeDraft.ts` | `ComposeState`, `emptyCompose`, `replyCompose`, `forwardCompose`, `fromSavedDraft`, `toDraftInput` |
| Formatting | `format.ts` | `messageKey`, `formatListDate`, `formatSize`, `formatAddresses`, `safeFileName`, `snippetParts` |
| Multi-select | `selection.ts` | `clickSelection`, `moveSelection`, `selectAll`, `nextAfterRemoval` |
| Large mail not yet downloaded (S1) | `completion.ts` | `withWholeMessage`: MessageView's open, save, .eml, document and forward wait for `mailApi.completeMessage`; `NOT_LOADED_NOTE` |

## CONVENTIONS
- Data access goes through `mailApi` (`@/lib/mailApi`), NOT `trpcReact`: it proxies the main-process
  mail core. Pass `accountId` as the last argument to every call.
- Pure logic belongs in the `.ts` modules (`composeDraft`, `format`, `selection`), covered by
  `tests/mail_compose_draft.test.ts` and `tests/mail_selection.test.ts`. Extend the helper, not the
  component, when the logic is testable.
- German UI copy inline; addresses are formatted `Name <a@example.test>`.
- Both the main window (`MailPage`) and the standalone `MailWindowPage` reuse these views - keep them
  free of page-level state.

## ANTI-PATTERNS
- Mail content must never become HTML: `snippetParts()` splits FTS5 `[hit]` markers into text parts
  ("mail content never becomes HTML here"). Do not introduce `dangerouslySetInnerHTML` - there is none in
  the renderer today, and mail bodies are the reason to keep it that way.
- `FolderTree.tsx` drop targets assume an internal drag source and deliberately do not validate the drag
  data ("not every drag source keeps a custom type"). Handlers must tolerate foreign drags (files).
- Stored mail passwords are never shown again (`settings/MailAccountsCard.tsx`); do not add a reveal path.
- `ComposeView.tsx:250,281` carry `react-hooks/exhaustive-deps` suppressions around draft sync effects -
  do not copy them into new effects.
- Do not move the mail core into the renderer; IMAP/SMTP lives in `src/main/mailclient/` and is reached
  only through `mailApi`.

## HOTSPOTS
- `ComposeView.tsx` 917L, `MessageView.tsx` 600L, `MessageList.tsx` 280L.
- `mailApi` is called from 23 places across the renderer; `format.ts` helpers are shared by both the
  main window and the mail window.

## COMMANDS
```bash
pnpm dev
pnpm typecheck:web
pnpm vitest run tests/mail_compose_draft.test.ts tests/mail_selection.test.ts
npx playwright test tests/e2e/mail-client.spec.ts
```
