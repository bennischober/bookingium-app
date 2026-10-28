// MR-37: the global mail shortcuts ignored dialogs, popovers and the compose area.
//
// `isTypingTarget` only asked "is the user typing in a field", so Entf while focus was on a confirm
// dialog, a popover or a compose button moved the selected list mail to Trash; Ctrl+N or Ctrl+R on a compose
// button replaced the open editor. The handler ran on `window`, so anything on the page was in scope.
//
// The guards are a pure question about the event's surroundings, so they are testable without a browser.
import { describe, expect, it } from 'vitest'
import { shortcutBlocked } from '@/components/mail/shortcuts'
import { readFileSync } from 'fs'
import { join } from 'path'

/** A target whose closest() answers for the selectors the guard asks about */
const target = (inside: string[]): { closest: (selector: string) => unknown } => ({
  closest: (selector: string) => (inside.includes(selector) ? {} : null)
})

describe('MR-37: where a mail shortcut must not fire', () => {
  it('stays out of a dialog', () => {
    // Entf in a confirm dialog must not move the selected mail to Trash
    expect(shortcutBlocked({ target: target(['[role="dialog"]']), composeOpen: false })).toBe(true)
  })

  it('stays out of an alert dialog', () => {
    expect(shortcutBlocked({ target: target(['[role="alertdialog"]']), composeOpen: false })).toBe(
      true
    )
  })

  it('stays out of a popover and a menu', () => {
    // Ctrl+N on a popover button must not open a second editor
    expect(shortcutBlocked({ target: target(['[role="menu"]']), composeOpen: false })).toBe(true)
    expect(
      shortcutBlocked({
        target: target(['[data-radix-popper-content-wrapper]']),
        composeOpen: false
      })
    ).toBe(true)
  })

  it('stays out of the compose area', () => {
    // the editor is a form; a shortcut inside it must not reach the list
    expect(
      shortcutBlocked({
        target: target(['form[aria-label="E-Mail verfassen"]']),
        composeOpen: true
      })
    ).toBe(true)
  })

  it('stays out of the list while compose is open', () => {
    // the reported case: Ctrl+N or Ctrl+R on a compose button replaced the open editor
    expect(shortcutBlocked({ target: target([]), composeOpen: true })).toBe(true)
  })

  it('still fires in the plain list', () => {
    // the negative half: blocking everything would kill the shortcuts entirely
    expect(shortcutBlocked({ target: target([]), composeOpen: false })).toBe(false)
  })

  it('treats a missing target as the plain list', () => {
    expect(shortcutBlocked({ target: null, composeOpen: false })).toBe(false)
  })
})

describe('MR-37: the page uses the guard', () => {
  it('asks shortcutBlocked before mapping a key', () => {
    // Pinned by source: the effect cannot be rendered here, and this is the line that was missing.
    // R4: the keyboard handler lives in the page's useMailShortcuts hook
    const src = readFileSync(
      join(process.cwd(), 'src/renderer/src/hooks/useMailShortcuts.ts'),
      'utf8'
    )
    expect(src).toContain('shortcutBlocked(')
    // and it must be asked BEFORE shortcutFor decides an action
    const blockedAt = src.indexOf('shortcutBlocked(')
    const forAt = src.indexOf('shortcutFor(event')
    expect(blockedAt).toBeGreaterThan(-1)
    expect(blockedAt).toBeLessThan(forAt)
  })
})
