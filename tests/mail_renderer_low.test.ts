// I10, the "Low: renderer" items that were still open. Each is pinned by the line that fixes it,
// because these live in .tsx files the node test env cannot render. The pattern is the one this
// repository already uses for renderer rules (mail_sync_bar, mail_message_view_hooks).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')
const MAIL_PAGE = 'src/renderer/src/pages/MailPage.tsx'
const COMPOSE = 'src/renderer/src/components/mail/ComposeView.tsx'
const READER = 'src/renderer/src/components/mail/MessageView.tsx'

describe('I10 Low: renderer fixes', () => {
  it('clears the hidden rows on an account switch', () => {
    // They belong to the account they were hidden in. Carried over, an id that exists in the new
    // account would stay invisible for no reason.
    const src = source(MAIL_PAGE)
    const start = src.indexOf('onValueChange={(id) => {')
    // up to the closing of that handler, which is the next "}}" at the same indent
    const handler = src.slice(start, src.indexOf('}}', start))
    expect(handler).toContain('setHiddenIds([])')
  })

  it('marks the mail edited when an attachment is added', () => {
    // Without this the autosave never runs and the attachment is lost when the window closes.
    const src = source(COMPOSE)
    const addFiles = src.slice(src.indexOf('const addFiles = async'), src.indexOf('const onPaste'))
    expect(addFiles).toContain('edited.current = true')
  })

  it('gives every reader icon button an accessible name', () => {
    // title is a tooltip, not an accessible name; a screen reader announced these as "button".
    const src = source(READER)
    for (const label of ['Antworten', 'Allen antworten', 'Weiterleiten']) {
      expect(src, `the ${label} button needs an aria-label`).toContain(`aria-label="${label}"`)
    }
  })
})
