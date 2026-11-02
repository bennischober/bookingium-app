// The pure half of the detail tables (RowTable / EventsTable), so the order and the
// count line are testable without a DOM (vitest runs in a node environment here).

/** A column as the table needs it for sorting: a key, a label and how to read it */
export type SortableColumn<T> = {
  /** Stable id of the column; the header text is the label, this is what sorts */
  key: string
  /** The value to compare; strings sort with `localeCompare`, numbers numerically */
  value: (row: T) => string | number
}

export type TableSort = { key: string; desc: boolean }

/**
 * Sorts a copy of the rows. `fallback` is the order the query delivered (events
 * newest first), so a column that ties keeps the order it came in.
 */
export function sortRows<T>(
  rows: T[],
  sort: TableSort | null,
  columns: SortableColumn<T>[] | undefined
): T[] {
  if (!sort || !columns) return rows
  const column = columns.find((entry) => entry.key === sort.key)
  if (!column) return rows

  const direction = sort.desc ? -1 : 1
  return [...rows].sort((a, b) => {
    const left = column.value(a)
    const right = column.value(b)
    if (typeof left === 'number' && typeof right === 'number') {
      return direction * (left - right)
    }
    return direction * String(left).localeCompare(String(right), 'de', { numeric: true })
  })
}

/** The next sort state when a header is clicked: same column flips, a new one starts ascending */
export function nextSort(current: TableSort | null, key: string): TableSort {
  return current?.key === key ? { key, desc: !current.desc } : { key, desc: false }
}

/** "12 Events" / "1 Event" - the count line above a detail table */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString('de-DE')} ${count === 1 ? singular : plural}`
}
