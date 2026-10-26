// I16: the renderer leftovers of the review's Low list (items 15, 17, 18, 22).
//
// These live in .tsx files the node test env cannot render, so each is pinned by the line that fixes it - the
// pattern this repository already uses for renderer rules (mail_sync_bar, mail_message_view_hooks). The point is
// that the fix cannot quietly disappear again.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')
const WINDOW = 'src/renderer/src/pages/MailWindowPage.tsx'
const READER = 'src/renderer/src/components/mail/MessageView.tsx'

describe('I16 item 15: dead plumbing removed', () => {
  it('no longer threads pdfName through the window URL', () => {
    // It was carried from main to the URL to composeRequest and never read: ComposeView names the
    // attachment from the presetPdfPath basename.
    const src = source(WINDOW)
    expect(src).not.toContain('pdfName')
  })

  it('no longer passes presetPdfPath from an unreachable branch', () => {
    // The non-compose branch cannot run with a composeRequest, so that expression was always undefined.
    const src = source(WINDOW)
    expect(src).not.toContain('presetPdfPath={composeRequest?.pdfPath}')
  })
})

describe('I16 item 17: the compose branch checks canWrite', () => {
  it('renders ComposeView in compose mode only for a writable account', () => {
    // Defence in depth: main picks a sandbox account today, but the renderer must not depend on that.
    const src = source(WINDOW)
    // the branch condition itself, which is what has to carry canWrite
    const at = src.indexOf('{composeRequest && composeInitial')
    expect(at).toBeGreaterThan(-1)
    const composeBranch = src.slice(at, src.indexOf('? (', at))
    expect(composeBranch).toContain('canWrite')
  })

  it('tells a compose request on a read-only account why nothing opens', () => {
    // Review of I16: the gate alone let the request fall through to MessageView with no message id
    const src = source(WINDOW)
    expect(src).toContain('if (composeRequest && !canWrite)')
    expect(src).toContain('Mit diesem Konto kann nicht gesendet werden.')
  })
})

describe('I16 item 22: the attachment group is announced', () => {
  it('gives "Alle Anhänge" a role, so its aria-label is read', () => {
    // aria-label on a plain div is ignored by assistive tech; a role makes the name meaningful.
    const src = source(READER)
    const at = src.indexOf('aria-label="Alle Anhänge"')
    expect(at).toBeGreaterThan(-1)
    const tag = src.slice(src.lastIndexOf('<', at), src.indexOf('>', at))
    expect(tag).toMatch(/role="group"|role="region"/)
  })
})

describe('I16 item 18: the window follows its mail', () => {
  it('invalidates the message queries on any event of this account, not only op-events', () => {
    // It filtered to op-event, so an isDraft or folder change arriving as a sync event left the window
    // showing the old derivation until a refetch.
    const src = source(WINDOW)
    const sub = src.slice(
      src.indexOf('mail.events.useSubscription'),
      src.indexOf('const toggleFlag')
    )
    expect(sub).not.toContain("event.type !== 'op-event'")
    expect(sub).toContain('messageKey(accountId, messageId)')
  })

  it('does not refetch the mail for every remote image that loads', () => {
    // image-progress fires per image; MessageView listens to it itself
    const src = source(WINDOW)
    const sub = src.slice(
      src.indexOf('mail.events.useSubscription'),
      src.indexOf('const toggleFlag')
    )
    expect(sub).toContain("event.type === 'image-progress'")
  })
})
