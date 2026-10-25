// G2/L1: the mail list answers a click before the server does.
//
// Deleting a mail used to await the whole write - connect, LOGIN, SELECT, MOVE, LOGOUT -
// before the row disappeared, so a quick run through Spam felt laggy. The row now goes at
// click time and comes back only if the move fails. These tests pin the two ways that can go
// wrong silently: a duplicate in the set, and a mail that never comes back.
import { describe, expect, it } from 'vitest'
import { hide, unhide, visible } from '@/components/mail/optimistic'

const rows = [{ id: 1 }, { id: 2 }, { id: 3 }]

describe('G2/L1: hiding a moved mail', () => {
  it('removes the mail from the list immediately', () => {
    expect(visible(rows, hide([], [2])).map((r) => r.id)).toEqual([1, 3])
  })

  it('keeps the list order, never the click order', () => {
    // The user clicks a run of mails in any order; the list must stay sorted
    const hidden = hide(hide([], [3]), [1])
    expect(visible(rows, hidden).map((r) => r.id)).toEqual([2])
  })

  it('does not duplicate an id when the same mail is hidden twice', () => {
    // A double click, or a retry, must not grow the set
    expect(hide(hide([], [2]), [2])).toEqual([2])
  })
})

describe('G2/L1: a failed move puts the mail back', () => {
  it('restores exactly the ids that failed', () => {
    const hidden = hide([], [1, 3])
    // 1 comes back, 3 is still hidden - so the visible ids are 1 and 2
    expect(visible(rows, unhide(hidden, [1])).map((r) => r.id)).toEqual([1, 2])
  })

  it('restores everything when the whole request failed', () => {
    const hidden = hide([], [1, 2, 3])
    expect(visible(rows, unhide(hidden, [1, 2, 3])).map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('leaves the other hidden mails alone', () => {
    // Two deletes in flight, the first one fails: only its mail returns, the second stays hidden
    const hidden = hide([], [1, 3])
    const after = unhide(hidden, [1])
    expect(after).toEqual([3])
    expect(visible(rows, after).map((r) => r.id)).toEqual([1, 2])
  })

  it('shows everything again once the set is cleared', () => {
    // The renderer clears the set when fresh list data arrives, never on a timer
    expect(visible(rows, []).map((r) => r.id)).toEqual([1, 2, 3])
  })
})
