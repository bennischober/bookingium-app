// Ultrawork audit, criterion 4: every list-mutating action hides at click time.
//
// The pattern that made an inbox delete feel instant (G2/L1) must hold for every action that
// removes a mail from the list. This asserts the ORDER in the source: hideMails() must come before the
// awaited mail API call, and unhideMails() must exist on the failure path. A component with hooks
// cannot be rendered in the node test env, so the order is read from the source - which is exactly the
// property that regressed.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(join(process.cwd(), 'src/renderer/src/pages/MailPage.tsx'), 'utf8')

/** The body of one named async function, up to the next top-level const */
function fnBody(name: string): string {
  const start = page.indexOf(`const ${name} = async (`)
  expect(start).toBeGreaterThan(-1)
  const end = page.indexOf('\n  const ', start + 1)
  return page.slice(start, end === -1 ? undefined : end)
}

describe('criterion 4: every list-mutating action hides at click time', () => {
  it('moveAway hides before awaiting the move', () => {
    const body = fnBody('moveAway')
    const hideAt = body.indexOf('hideMails(ids)')
    const awaitAt = body.indexOf('await mailApi.')
    expect(hideAt).toBeGreaterThan(-1)
    expect(awaitAt).toBeGreaterThan(-1)
    expect(hideAt).toBeLessThan(awaitAt)
    // and a failure restores the rows
    expect(body).toContain('unhideMails(ids)')
  })

  it('expunge (permanent delete) hides before awaiting', () => {
    const body = fnBody('expunge')
    const hideAt = body.indexOf('hideMails(ids)')
    const awaitAt = body.indexOf('await mailApi.expungeFromTrash')
    expect(hideAt).toBeGreaterThan(-1)
    expect(awaitAt).toBeGreaterThan(-1)
    expect(hideAt).toBeLessThan(awaitAt)
    expect(body).toContain('unhideMails(ids)')
  })

  it('emptyTrash hides each collected page before awaiting the expunge', () => {
    const body = fnBody('emptyTrash')
    const hideAt = body.indexOf('hideMails(')
    const awaitAt = body.indexOf('await mailApi.expungeFromTrash')
    expect(hideAt).toBeGreaterThan(-1)
    expect(awaitAt).toBeGreaterThan(-1)
    expect(hideAt).toBeLessThan(awaitAt)
    expect(body).toContain('unhideMails(ids)')
  })

  it('discardDraft closes before awaiting the discard', async () => {
    const compose = readFileSync(
      join(process.cwd(), 'src/renderer/src/components/mail/ComposeView.tsx'),
      'utf8'
    )
    const body = compose.slice(
      compose.indexOf("setBusy('discard')"),
      compose.indexOf('const addFiles')
    )
    expect(body).not.toContain('await mailApi.discardDraft')
    expect(body.indexOf('void mailApi')).toBeLessThan(body.indexOf('onClose()'))
  })
})
