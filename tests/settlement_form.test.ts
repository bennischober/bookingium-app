// #228: the settlement tab's text ↔ number helpers, with the currency of a settlement from abroad
import { describe, expect, it } from 'vitest'
import {
  moneyText,
  parseRate,
  rateText
} from '../src/renderer/src/components/event-hub/settlementForm'

describe('settlement form', () => {
  it('writes amounts in the settlement currency', () => {
    expect(moneyText(422150, 'EUR')).toBe('4.221,50 €')
    expect(moneyText(422150, 'GBP')).toBe('4.221,50 GBP')
  })

  it('reads a rate with a comma or a dot, empty as no rate', () => {
    expect(parseRate('1,17')).toBe(1.17)
    expect(parseRate('1.17')).toBe(1.17)
    expect(parseRate('1,168234')).toBe(1.168234)
    expect(parseRate('')).toBeNull()
    expect(parseRate('0')).toBeUndefined()
    expect(parseRate('abc')).toBeUndefined()
  })

  it('writes a rate with at least two decimals', () => {
    expect(rateText(1.17)).toBe('1,17')
    expect(rateText(1.168234)).toBe('1,168234')
    expect(rateText(null)).toBe('')
  })
})
