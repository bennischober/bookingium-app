// B3: the mail shortcuts as data. Outlook's keys, because the user comes from Outlook.
import { describe, expect, it } from 'vitest'
import {
  SHORTCUT_HINTS,
  isTypingTarget,
  shortcutFor,
  type MailShortcut
} from '@/components/mail/shortcuts'

const ALL = { hasSelection: true, canWrite: true, hasReader: true }
const key = (
  k: string,
  mods: { ctrl?: boolean; shift?: boolean; meta?: boolean } = {}
): { key: string; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean; altKey: boolean } => ({
  key: k,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  metaKey: mods.meta ?? false,
  altKey: false
})

const action = (k: string, mods = {}, opts = ALL): MailShortcut | null =>
  shortcutFor(key(k, mods), opts)

describe('mail shortcuts (B3)', () => {
  it('maps Outlook keys to the mail actions', () => {
    expect(action('u', { ctrl: true })).toBe('markUnread')
    expect(action('q', { ctrl: true })).toBe('markRead')
    expect(action('Delete')).toBe('toTrash')
    expect(action('v', { ctrl: true, shift: true })).toBe('move')
    expect(action('n', { ctrl: true })).toBe('compose')
    expect(action('r', { ctrl: true })).toBe('reply')
    expect(action('R', { ctrl: true, shift: true })).toBe('replyAll')
    expect(action('l', { ctrl: true })).toBe('forward')
  })

  it('accepts Cmd on macOS as the same modifier', () => {
    expect(action('u', { meta: true })).toBe('markUnread')
    expect(action('n', { meta: true })).toBe('compose')
  })

  it('leaves unrelated keys alone', () => {
    expect(action('a')).toBeNull()
    expect(action('u')).toBeNull()
    expect(action('Delete', { ctrl: true })).toBeNull()
    expect(action('x', { ctrl: true })).toBeNull()
    // Ctrl+Shift+R is reply-all, plain Ctrl+R is reply - never the other way round
    expect(action('r', { ctrl: true, shift: true })).toBe('replyAll')
  })

  it('needs a selection for the actions that work on mails', () => {
    const none = { hasSelection: false, canWrite: true, hasReader: true }
    expect(shortcutFor(key('u', { ctrl: true }), none)).toBeNull()
    expect(shortcutFor(key('q', { ctrl: true }), none)).toBeNull()
    expect(shortcutFor(key('Delete'), none)).toBeNull()
    expect(shortcutFor(key('v', { ctrl: true, shift: true }), none)).toBeNull()
    // composing needs no selection
    expect(shortcutFor(key('n', { ctrl: true }), none)).toBe('compose')
  })

  it('needs an open reader for reply, reply all and forward', () => {
    const noReader = { hasSelection: true, canWrite: true, hasReader: false }
    expect(shortcutFor(key('r', { ctrl: true }), noReader)).toBeNull()
    expect(shortcutFor(key('R', { ctrl: true, shift: true }), noReader)).toBeNull()
    expect(shortcutFor(key('l', { ctrl: true }), noReader)).toBeNull()
    // marking and trashing only need the selection
    expect(shortcutFor(key('u', { ctrl: true }), noReader)).toBe('markUnread')
    expect(shortcutFor(key('Delete'), noReader)).toBe('toTrash')
  })

  it('is disabled entirely for a read-only account', () => {
    for (const [k, mods] of [
      ['u', { ctrl: true }],
      ['q', { ctrl: true }],
      ['Delete', {}],
      ['v', { ctrl: true, shift: true }],
      ['n', { ctrl: true }],
      ['r', { ctrl: true }]
    ] as const) {
      expect(
        shortcutFor(key(k, mods), { hasSelection: true, canWrite: false, hasReader: true })
      ).toBeNull()
    }
  })

  it('never steals a keystroke while the user is typing', () => {
    expect(isTypingTarget({ closest: () => ({}) })).toBe(true)
    expect(isTypingTarget({ closest: () => null })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('has a German hint for every action', () => {
    const actions: MailShortcut[] = [
      'markUnread',
      'markRead',
      'toTrash',
      'move',
      'compose',
      'reply',
      'replyAll',
      'forward'
    ]
    for (const a of actions) expect(SHORTCUT_HINTS[a]).toMatch(/Strg|Entf/)
  })
})
