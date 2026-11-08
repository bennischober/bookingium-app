// Editable prepayment ("Vorkasse") rows of the Finanzen tab: what is saved and when it is dirty.
import { describe, it, expect } from 'vitest'
import {
  depositsChanged,
  depositSummary,
  fromDepositDrafts,
  toDepositDrafts
} from '../src/renderer/src/components/event-hub/depositDrafts'

const stored = [
  { amount: 1500, dueDate: null },
  { amount: 1000.5, dueDate: '2026-12-01' }
]

describe('depositDrafts', () => {
  it('round-trips the stored deposits unchanged', () => {
    const drafts = toDepositDrafts(stored)
    expect(drafts).toEqual([
      { amount: '1500', dueDate: '' },
      { amount: '1000.5', dueDate: '2026-12-01' }
    ])
    expect(fromDepositDrafts(drafts)).toEqual(stored)
    expect(depositsChanged(drafts, stored)).toBe(false)
  })

  it('drops rows without an amount above zero, so an added empty row is not a change', () => {
    const drafts = [
      ...toDepositDrafts(stored),
      { amount: '', dueDate: '' },
      { amount: '0', dueDate: '2026-12-24' }
    ]
    expect(fromDepositDrafts(drafts)).toEqual(stored)
    expect(depositsChanged(drafts, stored)).toBe(false)
  })

  it('sees an edited amount, an edited date, a removed row and a new order', () => {
    const drafts = toDepositDrafts(stored)
    expect(depositsChanged([{ ...drafts[0], amount: '1600' }, drafts[1]], stored)).toBe(true)
    expect(depositsChanged([{ ...drafts[0], dueDate: '2026-11-30' }, drafts[1]], stored)).toBe(true)
    expect(depositsChanged([drafts[0]], stored)).toBe(true)
    expect(depositsChanged([drafts[1], drafts[0]], stored)).toBe(true)
  })

  it('summarises one line per deposit', () => {
    expect(depositSummary(stored)).toBe(
      '1. € 1500.00, fällig bei Vertragsabschluss\n2. € 1000.50, fällig am 01.12.2026'
    )
    expect(depositSummary([])).toBe('')
  })
})
