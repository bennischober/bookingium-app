// The pure half of the detail tables: header sorting and the count line.
import { describe, it, expect } from 'vitest'
import {
  countLabel,
  nextSort,
  sortRows,
  type SortableColumn
} from '../src/renderer/src/components/detail/tableSort'

type Event = { id: number; name: string; date: string; status: string; venue: string }

// Newest first, the order the query delivers
const events: Event[] = [
  { id: 3, name: 'Berlin Tour', date: '2026-06-11', status: 'confirmed', venue: 'Berghain' },
  { id: 1, name: 'Hamburg', date: '2026-03-02', status: 'option', venue: 'Übel & Gefährlich' },
  { id: 2, name: 'München', date: '2026-04-30', status: 'confirmed', venue: 'Ampere' }
]

const columns: SortableColumn<Event>[] = [
  { key: 'Datum', value: (event) => event.date },
  { key: 'Event', value: (event) => event.name },
  { key: 'Status', value: (event) => event.status },
  { key: 'Spielstätte', value: (event) => event.venue }
]

const names = (rows: Event[]): string[] => rows.map((event) => event.name)

describe('sorting a detail table', () => {
  it('keeps the delivered order while no header was clicked', () => {
    // The query delivers newest first; the table must not reorder on its own
    expect(names(sortRows(events, null, columns))).toEqual(['Berlin Tour', 'Hamburg', 'München'])
  })

  it('sorts by date', () => {
    expect(names(sortRows(events, { key: 'Datum', desc: false }, columns))).toEqual([
      'Hamburg',
      'München',
      'Berlin Tour'
    ])
    expect(names(sortRows(events, { key: 'Datum', desc: true }, columns))).toEqual([
      'Berlin Tour',
      'München',
      'Hamburg'
    ])
  })

  it('sorts by venue, which the delivered order could not', () => {
    // German order: Ampere < Berghain < Übel & Gefährlich
    expect(names(sortRows(events, { key: 'Spielstätte', desc: false }, columns))).toEqual([
      'München',
      'Berlin Tour',
      'Hamburg'
    ])
  })

  it('sorts by status, which the delivered order could not', () => {
    expect(names(sortRows(events, { key: 'Status', desc: false }, columns))).toEqual([
      'Berlin Tour',
      'München',
      'Hamburg'
    ])
  })

  it('does not mutate the rows it was given', () => {
    const before = names(events)
    sortRows(events, { key: 'Event', desc: false }, columns)
    expect(names(events)).toEqual(before)
  })

  it('ignores a column that is not sortable', () => {
    // A key that is not in the sortable columns leaves the delivered order
    expect(names(sortRows(events, { key: 'Unbekannt', desc: false }, columns))).toEqual([
      'Berlin Tour',
      'Hamburg',
      'München'
    ])
  })
})

describe('clicking a header', () => {
  it('starts ascending on a new column and flips the current one', () => {
    expect(nextSort(null, 'Datum')).toEqual({ key: 'Datum', desc: false })
    expect(nextSort({ key: 'Datum', desc: false }, 'Datum')).toEqual({
      key: 'Datum',
      desc: true
    })
    expect(nextSort({ key: 'Datum', desc: true }, 'Event')).toEqual({
      key: 'Event',
      desc: false
    })
  })
})

describe('the count line', () => {
  it('uses the singular for one and the plural for many', () => {
    expect(countLabel(1, 'Event', 'Events')).toBe('1 Event')
    expect(countLabel(12, 'Event', 'Events')).toBe('12 Events')
    expect(countLabel(0, 'Event', 'Events')).toBe('0 Events')
  })

  it('formats the number the German way', () => {
    expect(countLabel(1234, 'Event', 'Events')).toBe('1.234 Events')
  })
})
