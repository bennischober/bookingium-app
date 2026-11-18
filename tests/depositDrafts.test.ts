// Editable prepayment ("Vorkasse") rows of the Finanzen tab: what is saved and when it is dirty.
import { describe, it, expect } from 'vitest'
import {
  depositsChanged,
  depositSummary,
  fromDepositDrafts,
  toDepositDrafts
} from '../src/renderer/src/components/event-hub/depositDrafts'

const stored = [
  { amount: 1500, dueDate: null, paidAt: null },
  { amount: 1000.5, dueDate: '2026-12-01', paidAt: null }
]

describe('depositDrafts', () => {
  it('round-trips the stored deposits unchanged', () => {
    const drafts = toDepositDrafts(stored)
    expect(drafts).toEqual([
      { amount: '1500', dueDate: '', paidAt: '' },
      { amount: '1000.5', dueDate: '2026-12-01', paidAt: '' }
    ])
    expect(fromDepositDrafts(drafts)).toEqual(stored)
    expect(depositsChanged(drafts, stored)).toBe(false)
  })

  it('drops rows without an amount above zero, so an added empty row is not a change', () => {
    const drafts = [
      ...toDepositDrafts(stored),
      { amount: '', dueDate: '', paidAt: '' },
      { amount: '0', dueDate: '2026-12-24', paidAt: '' }
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

  it('#201: keeps the paid date and sees it change; a deposit stored before it is open', () => {
    const drafts = toDepositDrafts(stored)
    const paid = [{ ...drafts[0], paidAt: '2026-11-16' }, drafts[1]]
    expect(depositsChanged(paid, stored)).toBe(true)
    expect(fromDepositDrafts(paid)[0].paidAt).toBe('2026-11-16')
    expect(depositsChanged(drafts, [{ amount: 1500, dueDate: null }, stored[1]])).toBe(false)
    // The amount's spacing comes from formatMoney: only the paid note is new
    expect(depositSummary(fromDepositDrafts(paid))).toBe(
      depositSummary(stored).replace(
        'bei Vertragsabschluss',
        'bei Vertragsabschluss, bezahlt am 16.11.2026'
      )
    )
  })

  it('summarises one line per deposit', () => {
    expect(depositSummary(stored)).toBe(
      '1. 1.500,00 €, fällig bei Vertragsabschluss\n2. 1.000,50 €, fällig am 01.12.2026'
    )
    expect(depositSummary([])).toBe('')
  })
})
