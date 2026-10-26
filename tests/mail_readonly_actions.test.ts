// MR-35: the reading pane offered write actions on a read-only account.
//
// `MailPage` and `MailWindowPage` passed `onWriteTo` unconditionally, so clicking a sender on the
// production account opened an editor. Its autosave failed silently (`.catch(() => undefined)`) and the
// typed text was lost. The same applied to reply/forward (`onCompose`).
//
// The decision is pure, so it is testable: which reading-pane actions a given account may offer.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { readingActions } from '@/components/mail/readingActions'

const source = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

describe('MR-35: which reading-pane actions an account may offer', () => {
  it('offers every write action on a sandbox account', () => {
    const actions = readingActions({ kind: 'sandbox' })
    expect(actions).toEqual({ canWrite: true, canCompose: true, canWriteTo: true })
  })

  it('offers none of them on a read-only account', () => {
    // The regression: the production account could start an editor whose autosave failed silently.
    const actions = readingActions({ kind: 'production-readonly' })
    expect(actions).toEqual({ canWrite: false, canCompose: false, canWriteTo: false })
  })

  it('offers none when there is no account at all', () => {
    // While the account list is still loading, an editor must not open either.
    expect(readingActions(null)).toEqual({
      canWrite: false,
      canCompose: false,
      canWriteTo: false
    })
    expect(readingActions(undefined)).toEqual({
      canWrite: false,
      canCompose: false,
      canWriteTo: false
    })
  })

  it('the two pages pass the write callbacks only when the account may write', () => {
    // The pages cannot be rendered here, so the wiring itself is pinned: the unconditional props
    // this card removed must not come back, and both pages must use the shared rule.
    for (const page of [
      'src/renderer/src/pages/MailPage.tsx',
      'src/renderer/src/pages/MailWindowPage.tsx'
    ]) {
      const src = source(page)
      expect(src.indexOf('readingActions('), `${page} must use readingActions()`).toBeGreaterThan(-1)
      // the exact unconditional forms MR-35 removed
      expect(src, `${page} passes onCompose unconditionally`).not.toContain(
        'onCompose={composeFrom}'
      )
      expect(src, `${page} passes onWriteTo unconditionally`).not.toContain('onWriteTo={(address)')
      // and both are gated by the rule's own answer
      expect(src).toContain('reading.canCompose ?')
      expect(src).toContain('reading.canWriteTo')
    }
  })
})
