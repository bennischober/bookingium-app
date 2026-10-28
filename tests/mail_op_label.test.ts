// H2: the quiet "working" indicator in the mail sync bar.
//
// The bar already showed a spinner while syncing; a send or a move was invisible until it
// finished. These tests pin the two things that decide whether the indicator is quiet or
// noisy: which ops reach the bar, and what they say.
import { describe, expect, it } from 'vitest'
import { runningOpLabel, VISIBLE_OPS } from '@/components/mail/opLabel'

describe('H2: a running op shows a label', () => {
  it('names the three ops a user starts', () => {
    expect(runningOpLabel('send')).toBe('Sendet…')
    expect(runningOpLabel('move')).toBe('Verschiebt…')
    expect(runningOpLabel('move_batch')).toBe('Verschiebt…')
  })

  it('treats both delete paths as deleting', () => {
    expect(runningOpLabel('expunge')).toBe('Löscht…')
    expect(runningOpLabel('draft_delete')).toBe('Löscht…')
  })

  it('shows nothing when no op is running', () => {
    expect(runningOpLabel(null)).toBeNull()
    expect(runningOpLabel(undefined)).toBeNull()
    expect(runningOpLabel('')).toBeNull()
  })
})

describe('H2: background ops stay out of the bar', () => {
  it('hides the autosave, which runs every 1.5 s while typing', () => {
    // Showing this one would blink the bar nonstop - the opposite of quiet
    expect(runningOpLabel('draft_save')).toBeNull()
    expect(VISIBLE_OPS.has('draft_save')).toBe(false)
  })

  it('hides flag changes, which fire on every read/unread', () => {
    expect(runningOpLabel('flag')).toBeNull()
    expect(VISIBLE_OPS.has('flag')).toBe(false)
  })

  it('hides internal kinds rather than showing them raw', () => {
    for (const kind of ['queue', 'result', 'sandbox', 'folder_create', 'folder_rename']) {
      expect(runningOpLabel(kind)).toBeNull()
    }
  })
})
