/**
 * Selection in the message list, as in desktop mail clients: click selects one,
 * Ctrl+click adds or removes one, Shift+click and Shift+arrows select a range from
 * the anchor (the last mail clicked without Shift). `focus` is the row the keyboard
 * is on. All functions take the list's ids in display order.
 */
export type Selection = {
  ids: number[]
  anchor: number | null
  focus: number | null
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: null, focus: null }

export const single = (id: number): Selection => ({ ids: [id], anchor: id, focus: id })

/** The rows from `from` to `to`, both included; just `to` when `from` is not in the list */
function range(order: number[], from: number, to: number): number[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a < 0 || b < 0) return [to]
  return a <= b ? order.slice(a, b + 1) : order.slice(b, a + 1)
}

const inOrder = (order: number[], ids: Iterable<number>): number[] => {
  const wanted = new Set(ids)
  return order.filter((id) => wanted.has(id))
}

export function clickSelection(
  selection: Selection,
  order: number[],
  id: number,
  modifiers: { ctrl?: boolean; shift?: boolean }
): Selection {
  if (modifiers.shift && selection.anchor !== null) {
    const rows = range(order, selection.anchor, id)
    // Ctrl+Shift adds the range to what is selected
    const ids = modifiers.ctrl ? inOrder(order, [...selection.ids, ...rows]) : rows
    return { ids, anchor: selection.anchor, focus: id }
  }
  if (modifiers.ctrl) {
    const ids = selection.ids.includes(id)
      ? selection.ids.filter((x) => x !== id)
      : inOrder(order, [...selection.ids, id])
    return { ids, anchor: id, focus: id }
  }
  return single(id)
}

/** Arrow keys: the next or previous row, or with Shift the range up to it */
export function moveSelection(
  selection: Selection,
  order: number[],
  step: 1 | -1,
  shift: boolean
): Selection | null {
  if (order.length === 0) return null
  const at = selection.focus === null ? -1 : order.indexOf(selection.focus)
  const next = order[at < 0 ? 0 : Math.min(Math.max(at + step, 0), order.length - 1)]
  if (shift && selection.anchor !== null && order.includes(selection.anchor)) {
    return { ids: range(order, selection.anchor, next), anchor: selection.anchor, focus: next }
  }
  return single(next)
}

export const selectAll = (order: number[]): Selection => ({
  ids: [...order],
  anchor: order[0] ?? null,
  focus: order[order.length - 1] ?? null
})

/**
 * The row to select once `removed` left the list: the first one after them, else the
 * last one before them
 */
export function nextAfterRemoval(order: number[], removed: number[]): number | null {
  const gone = new Set(removed)
  const indexes = order.map((id, i) => (gone.has(id) ? i : -1)).filter((i) => i >= 0)
  if (indexes.length === 0) return null
  const after = order.slice(Math.max(...indexes) + 1).find((id) => !gone.has(id))
  if (after !== undefined) return after
  return (
    order
      .slice(0, Math.min(...indexes))
      .reverse()
      .find((id) => !gone.has(id)) ?? null
  )
}
