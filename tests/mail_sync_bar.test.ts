// G3: the sync bar must exist from the first moment, not only after the first sync status.
//
// `syncStatus` is enabled only when the worker reports `running`, so during startup `status` is
// undefined. SyncIndicator returned null for that, which made the whole bar disappear - and since
// it reads as "this feature does not exist", the person reported the status bar as missing.
//
// The component is a .tsx with hooks, so this pins the decision the way the project tests renderer
// rules: the "no status" branch must render a starting state instead of returning null, and a
// running write op must still win over it.
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { runningOpLabel } from '@/components/mail/opLabel'

const page = readFileSync(join(process.cwd(), 'src/renderer/src/pages/MailPage.tsx'), 'utf8')

/** The SyncIndicator function body, so assertions cannot match elsewhere in the page */
function indicatorBody(): string {
  const start = page.indexOf('function SyncIndicator(')
  expect(start).toBeGreaterThan(-1)
  // Ends at the next top-level function
  const end = page.indexOf('\nfunction ', start + 1)
  return page.slice(start, end === -1 ? undefined : end)
}

describe('G3: the sync bar exists before the first status', () => {
  it('does not return null when there is no status yet', () => {
    // The regression: `if (!status) return null` made the bar vanish during startup
    const body = indicatorBody()
    expect(body).not.toMatch(/if \(!status\) return null/)
  })

  it('shows a starting state instead', () => {
    const body = indicatorBody()
    expect(body).toContain("'Startet…'")
    // and it is inside the !status branch, not somewhere else
    const branch = body.slice(body.indexOf('if (!status)'), body.indexOf('auth-failed'))
    expect(branch).toContain('Startet…')
  })

  it('still shows a running write op while starting', () => {
    // A send started before the first sync status arrived must not be hidden
    const body = indicatorBody()
    const branch = body.slice(body.indexOf('if (!status)'), body.indexOf('auth-failed'))
    expect(branch).toContain('label')
  })

  it('keeps the labels the H2 work introduced', () => {
    // The indicator was reported as missing; the write-op labels must not have been lost with it
    expect(runningOpLabel('send')).toBe('Sendet…')
    expect(runningOpLabel('move')).toBe('Verschiebt…')
    expect(runningOpLabel('expunge')).toBe('Löscht…')
  })
})
