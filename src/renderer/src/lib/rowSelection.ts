// #200: rows picked in a list (DataTable). Pure, so the rules are unit tested; the list page
// keeps the set in its state.

/** One row on or off */
export function toggleRow(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** How the header checkbox shows the loaded rows: none, some or all of them picked */
export function selectionState(
  selected: ReadonlySet<number>,
  loadedIds: readonly number[]
): 'none' | 'some' | 'all' {
  const picked = loadedIds.filter((id) => selected.has(id)).length
  if (picked === 0) return 'none'
  return picked === loadedIds.length ? 'all' : 'some'
}

/** The header checkbox: all loaded rows picked unpicks them, otherwise picks them all */
export function toggleAllRows(
  selected: ReadonlySet<number>,
  loadedIds: readonly number[]
): Set<number> {
  const next = new Set(selected)
  if (selectionState(selected, loadedIds) === 'all') {
    for (const id of loadedIds) next.delete(id)
  } else {
    for (const id of loadedIds) next.add(id)
  }
  return next
}

/**
 * Only rows the list still shows stay picked: after a delete, an archive or another search a
 * row that is gone must not be acted on unseen. Returns the same set when nothing changed.
 */
export function keepShownRows(
  selected: ReadonlySet<number>,
  shownIds: readonly number[]
): ReadonlySet<number> {
  const shown = new Set(shownIds)
  const kept = [...selected].filter((id) => shown.has(id))
  return kept.length === selected.size ? selected : new Set(kept)
}

/** "1 Event ausgewählt" / "3 Events ausgewählt" */
export function selectionLabel(
  count: number,
  itemLabel: { singular: string; plural: string }
): string {
  return `${count.toLocaleString('de-DE')} ${count === 1 ? itemLabel.singular : itemLabel.plural} ausgewählt`
}
