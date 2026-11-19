// #245: capacity as a number or a range
import { describe, it, expect } from 'vitest'
import {
  capacityError,
  capacityInputText,
  formatCapacity,
  parseCapacityRange
} from '../src/main/api/schemas/capacity'

describe('parseCapacityRange', () => {
  it.each([
    ['1200', null, 1200],
    ['1.200', null, 1200],
    ['500-1000', 500, 1000],
    ['500 – 1.000', 500, 1000],
    ['500 bis 1000', 500, 1000],
    ['1000-500', 500, 1000],
    ['800-800', null, 800],
    ['bis 800', null, 800],
    ['', null, null],
    ['keine Angabe', null, null]
  ])('%s → %s to %s', (raw, min, max) => {
    expect(parseCapacityRange(raw)).toEqual({ min, max })
  })
})

describe('formatting', () => {
  it('shows a range with a dash and German thousands', () => {
    expect(formatCapacity(500, 1000)).toBe('500–1.000')
    expect(formatCapacity(null, 1200)).toBe('1.200')
    expect(formatCapacity(null, null)).toBe('')
    expect(capacityInputText(500, 1000)).toBe('500-1000')
    expect(capacityInputText(null, 1200)).toBe('1200')
  })

  it('accepts numbers and ranges, rejects words', () => {
    expect(capacityError('500-1000')).toBeUndefined()
    expect(capacityError('1200')).toBeUndefined()
    expect(capacityError('viele')).toBeDefined()
  })
})
