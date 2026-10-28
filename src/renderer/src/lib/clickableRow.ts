import type React from 'react'

/** Focus ring for a clickable table row; an outline, since a row draws no box-shadow */
export const CLICKABLE_ROW_FOCUS =
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring'

/**
 * Props that make a table row open on click and by keyboard: Tab focuses it,
 * Enter or Space opens it. The row stays a row, so the table keeps its semantics.
 */
export function clickableRowProps(open: () => void) {
  return {
    tabIndex: 0,
    onClick: open,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      // A key pressed on a button or link inside the row belongs to that control
      if (event.target !== event.currentTarget) return
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        open()
      }
    }
  }
}
