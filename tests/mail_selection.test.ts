// Selecting several mails in the list: Ctrl+click, Shift+click, Shift+arrows,
// select all, and which mail is selected once the selected ones are moved away
import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION,
  clickSelection,
  moveSelection,
  nextAfterRemoval,
  selectAll,
  single
} from '@/components/mail/selection'

const ORDER = [10, 11, 12, 13, 14]

describe('clickSelection', () => {
  it('selects one mail on a plain click', () => {
    const selection = clickSelection(selectAll(ORDER), ORDER, 12, {})
    expect(selection).toEqual(single(12))
  })

  it('adds and removes mails with Ctrl, in list order', () => {
    let selection = clickSelection(single(13), ORDER, 10, { ctrl: true })
    expect(selection.ids).toEqual([10, 13])
    expect(selection.anchor).toBe(10)
    selection = clickSelection(selection, ORDER, 13, { ctrl: true })
    expect(selection.ids).toEqual([10])
  })

  it('selects the range from the anchor with Shift, in both directions', () => {
    expect(clickSelection(single(11), ORDER, 13, { shift: true }).ids).toEqual([11, 12, 13])
    const up = clickSelection(single(13), ORDER, 10, { shift: true })
    expect(up.ids).toEqual([10, 11, 12, 13])
    // The anchor stays, so a second Shift+click replaces the range
    expect(up.anchor).toBe(13)
    expect(clickSelection(up, ORDER, 14, { shift: true }).ids).toEqual([13, 14])
  })

  it('adds the range to the selection with Ctrl+Shift', () => {
    const selection = clickSelection(single(10), ORDER, 13, { ctrl: true })
    expect(clickSelection(selection, ORDER, 14, { ctrl: true, shift: true }).ids).toEqual([
      10, 13, 14
    ])
  })

  it('selects just the mail when Shift has no anchor yet', () => {
    expect(clickSelection(EMPTY_SELECTION, ORDER, 12, { shift: true })).toEqual(single(12))
  })
})

describe('moveSelection', () => {
  it('moves to the next or previous mail and stops at the ends', () => {
    expect(moveSelection(single(12), ORDER, 1, false)).toEqual(single(13))
    expect(moveSelection(single(10), ORDER, -1, false)).toEqual(single(10))
    expect(moveSelection(single(14), ORDER, 1, false)).toEqual(single(14))
  })

  it('starts at the first mail when nothing is selected', () => {
    expect(moveSelection(EMPTY_SELECTION, ORDER, 1, false)).toEqual(single(10))
    expect(moveSelection(EMPTY_SELECTION, [], 1, false)).toBeNull()
  })

  it('grows and shrinks the range with Shift', () => {
    let selection = moveSelection(single(11), ORDER, 1, true)!
    selection = moveSelection(selection, ORDER, 1, true)!
    expect(selection.ids).toEqual([11, 12, 13])
    selection = moveSelection(selection, ORDER, -1, true)!
    expect(selection.ids).toEqual([11, 12])
    expect(selection.focus).toBe(12)
  })
})

describe('nextAfterRemoval', () => {
  it('takes the first mail after the removed ones', () => {
    expect(nextAfterRemoval(ORDER, [11, 12])).toBe(13)
    expect(nextAfterRemoval(ORDER, [10, 13])).toBe(14)
  })

  it('takes the last one before them at the end of the list', () => {
    expect(nextAfterRemoval(ORDER, [13, 14])).toBe(12)
    expect(nextAfterRemoval(ORDER, ORDER)).toBeNull()
    expect(nextAfterRemoval(ORDER, [99])).toBeNull()
  })
})
