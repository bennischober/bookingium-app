// Ultrawork audit, G7: the optimistic hide must survive a refresh while its write is in flight.
//
// The first version cleared the whole hidden set whenever the list query reported fresh data. An
// op-event triggers a refresh 300 ms after the op STARTS, so a slow move had its rows put back on
// screen while still in flight - the mail the user just deleted reappeared. That is the flicker the whole
// responsiveness fix exists to remove, reintroduced by its own cleanup rule.
//
// The rule that holds: a hidden id is released only when the fresh data no longer contains it (the mail has
// really left this folder) or when the op failed (an explicit unhide).
//
// This asserts the ORDER in the source, which is the property that regressed: the effect must filter by
// presence in the data, not clear the set outright.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hide, unhide } from '@/components/mail/optimistic'

const page = readFileSync(join(process.cwd(), 'src/renderer/src/pages/MailPage.tsx'), 'utf8')

describe('G7: a hidden mail stays hidden while it is still listed', () => {
  it('does not clear the whole set on fresh list data', () => {
    // The regression: setHiddenIds([]) on every listUpdatedAt change
    expect(page).not.toMatch(/if \(listUpdatedAt\) setHiddenIds\(\[\]\)/)
    expect(page).not.toMatch(/if \(listUpdatedAt\)\s*\{\s*setHiddenIds\(\[\]\)/)
  })

  it('keeps only the ids that are still listed', () => {
    // The fix: filter by presence in the fresh data
    const effect = page.slice(page.indexOf('const listUpdatedAt'))
    expect(effect).toContain('listed.has(id)')
    // and it must come after the data it reads
    expect(page.indexOf('const listUpdatedAt')).toBeGreaterThan(page.indexOf('const messages'))
  })

  it('still restores explicitly on a failed op', () => {
    // A failure must not rely on the refresh: it unhides its own ids
    const moveAway = page.slice(page.indexOf('const moveAway = async'))
    expect(moveAway).toContain('unhideMails(ids)')
  })

  it('the pure set still supports both directions', () => {
    // Guard against a helper change that would make the filter above meaningless
    expect(hide([], [1, 2])).toEqual([1, 2])
    expect(unhide([1, 2], [2])).toEqual([1])
  })
})
