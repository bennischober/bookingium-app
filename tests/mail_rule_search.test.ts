import { describe, expect, it } from 'vitest'
import { filterRules } from '../src/renderer/src/components/settings/mailRuleSearch'

const rules = [
  { name: 'Anfragen Festival', summary: 'Absender enthält „festival.example.com“: verschieben' },
  { name: 'Newsletter', summary: 'Betreff enthält „Newsletter“: als gelesen markieren' },
  { name: 'Rechnungen', summary: 'Absender enthält „buchhaltung“: Firma „Bühne“ zuordnen' }
]
const summaryOf = (rule: (typeof rules)[number]): string => rule.summary

describe('filterRules', () => {
  it('keeps every rule for an empty query, in order', () => {
    expect(filterRules(rules, '  ', summaryOf)).toEqual(rules)
  })

  it('finds rules by name or by what they do, ignoring case', () => {
    expect(filterRules(rules, 'festival', summaryOf).map((r) => r.name)).toEqual([
      'Anfragen Festival'
    ])
    expect(filterRules(rules, 'GELESEN', summaryOf).map((r) => r.name)).toEqual(['Newsletter'])
    expect(filterRules(rules, 'bühne', summaryOf).map((r) => r.name)).toEqual(['Rechnungen'])
  })

  it('needs every word', () => {
    expect(filterRules(rules, 'absender verschieben', summaryOf).map((r) => r.name)).toEqual([
      'Anfragen Festival'
    ])
    expect(filterRules(rules, 'absender gelesen', summaryOf)).toEqual([])
  })
})
