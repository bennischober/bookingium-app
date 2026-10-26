// B3: the mail shortcuts, as data. The page only maps a keydown to one of these
// actions; what a key means is decided here and pinned by a unit test.
//
// Outlook's keys, because the user comes from Outlook:
//   Ctrl+U  unread          Ctrl+Q  read
//   Del     to Trash         Ctrl+Shift+V  move (folder picker)
//   Ctrl+N  new mail         Ctrl+R  reply
//   Ctrl+Shift+R  reply all  Ctrl+L  forward

export type MailShortcut =
  | 'markUnread'
  | 'markRead'
  | 'toTrash'
  | 'move'
  | 'compose'
  | 'reply'
  | 'replyAll'
  | 'forward'

type KeyLike = {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

/**
 * The action a key event means, or null. `hasSelection` and `canWrite` gate the
 * actions that need mails or a writable account.
 */
export function shortcutFor(
  event: KeyLike,
  options: { hasSelection: boolean; canWrite: boolean; hasReader: boolean }
): MailShortcut | null {
  if (!options.canWrite) return null
  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()

  if (mod && event.shiftKey && key === 'v') return options.hasSelection ? 'move' : null
  if (mod && event.shiftKey && key === 'r') return options.hasReader ? 'replyAll' : null
  if (mod && key === 'u') return options.hasSelection ? 'markUnread' : null
  if (mod && key === 'q') return options.hasSelection ? 'markRead' : null
  if (mod && key === 'n') return 'compose'
  if (mod && key === 'r') return options.hasReader ? 'reply' : null
  if (mod && key === 'l') return options.hasReader ? 'forward' : null
  if (event.key === 'Delete' && !mod) return options.hasSelection ? 'toTrash' : null
  return null
}

/**
 * True when the event comes from somewhere the user is typing: a shortcut must never
 * steal a keystroke from an input, a textarea or the editor.
 */
export function isTypingTarget(
  target: { closest?: (selector: string) => unknown } | null
): boolean {
  if (!target) return false
  return Boolean(
    target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
  )
}

/**
 * MR-37: the surrounding places a mail shortcut must stay out of, beyond a text field.
 *
 * The handler is on `window`, so without this a key pressed in a dialog, a popover, a menu or the
 * compose area still reached the list: Entf on a confirm dialog moved the selected mail to Trash, and
 * Ctrl+N or Ctrl+R on a compose button replaced the open editor.
 */
const BLOCKING_SELECTORS = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  // Radix renders popovers and menus into a portal wrapper; the trigger alone is not enough
  '[data-radix-popper-content-wrapper]',
  // the compose form itself, so a key inside the editor never reaches the list
  'form[aria-label="E-Mail verfassen"]'
]

/**
 * Whether a mail shortcut must be ignored for this event.
 *
 * `composeOpen` covers the reported case on its own: with an editor open, a shortcut from the list
 * (Ctrl+N, Ctrl+R) would replace it and lose whatever was typed.
 */
export function shortcutBlocked(input: {
  target: { closest?: (selector: string) => unknown } | null
  composeOpen: boolean
}): boolean {
  if (input.composeOpen) return true
  if (!input.target) return false
  return BLOCKING_SELECTORS.some((selector) => Boolean(input.target?.closest?.(selector)))
}

/** The shortcut hints the menus show, so labels and behaviour cannot drift apart */
export const SHORTCUT_HINTS: Record<MailShortcut, string> = {
  markUnread: 'Strg+U',
  markRead: 'Strg+Q',
  toTrash: 'Entf',
  move: 'Strg+Umschalt+V',
  compose: 'Strg+N',
  reply: 'Strg+R',
  replyAll: 'Strg+Umschalt+R',
  forward: 'Strg+L'
}
