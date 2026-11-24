// Marketing-Atlas picker: what it shows and what the quick picks select
import { describe, it, expect } from 'vitest'
import {
  pickerShows,
  selectInTab,
  type PickerEntry
} from '../src/renderer/src/components/band/marketing/pickerFilters'

const entry = (key: string, extra: Partial<PickerEntry> = {}): PickerEntry => ({
  key,
  category: 'radios',
  group: 'DACH',
  name: key,
  country: 'DE',
  type: 'Rockradio',
  priority: 'A',
  quality: 'b',
  reason: '',
  ...extra
})

const entries = [
  entry('Zeta FM', { priority: 'B' }),
  entry('Alpha FM'),
  entry('Klein FM', { priority: 'C', isNew: true }),
  entry('Beispiel Festival', { category: 'festivals', reason: 'Hard Rock' })
]
const base = { category: 'radios' as const, query: '', onlyNew: false }

describe('atlas picker', () => {
  it('shows the tab sorted by priority; a search looks through every tab', () => {
    expect(pickerShows(entries, base).map((e) => e.key)).toEqual([
      'Alpha FM',
      'Zeta FM',
      'Klein FM'
    ])
    expect(pickerShows(entries, { ...base, query: 'hard rock' }).map((e) => e.key)).toEqual([
      'Beispiel Festival'
    ])
    expect(pickerShows(entries, { ...base, onlyNew: true }).map((e) => e.key)).toEqual(['Klein FM'])
  })

  it('quick picks change only the shown entries', () => {
    const shown = pickerShows(entries, base)
    const start = new Set(['Klein FM', 'Beispiel Festival'])
    expect([...selectInTab(start, shown, 'A')].sort()).toEqual(['Alpha FM', 'Beispiel Festival'])
    expect([...selectInTab(start, shown, 'AB')].sort()).toEqual([
      'Alpha FM',
      'Beispiel Festival',
      'Zeta FM'
    ])
    expect(selectInTab(start, shown, 'all').size).toBe(4)
    expect([...selectInTab(start, shown, 'none')]).toEqual(['Beispiel Festival'])
  })
})
