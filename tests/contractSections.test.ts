// Section numbering of the concert contract: optional sections ("Vorkasse",
// "Sondervereinbarungen") are left out entirely and the rest stays gapless.
import { describe, it, expect } from 'vitest'
import {
  CONTRACT_SECTIONS,
  contractDeposits,
  contractSectionNumbers
} from '../src/renderer/src/components/contract/contractSections'
import type { ContractData } from '../src/main/api/schemas/contract.schema'

function printedNumbers(numbers: Record<string, number | null>): number[] {
  return CONTRACT_SECTIONS.map((section) => numbers[section]).filter((n): n is number => n !== null)
}

describe('contractSectionNumbers', () => {
  it('puts "Vorkasse" right after "Abrechnung" as point 4 when it is printed', () => {
    const numbers = contractSectionNumbers({ deposits: true, specialAgreements: true })
    expect(numbers.billing).toBe(3)
    expect(numbers.deposits).toBe(4)
    expect(numbers.registration).toBe(5)
    expect(numbers.specialAgreements).toBe(CONTRACT_SECTIONS.length)
  })

  it('skips "Vorkasse" without a gap: point 4 is the next section', () => {
    const numbers = contractSectionNumbers({ deposits: false, specialAgreements: true })
    expect(numbers.deposits).toBeNull()
    expect(numbers.billing).toBe(3)
    expect(numbers.registration).toBe(4)
    expect(numbers.specialAgreements).toBe(CONTRACT_SECTIONS.length - 1)
  })

  it('numbers every printed section from 1 without gaps', () => {
    for (const deposits of [true, false]) {
      for (const specialAgreements of [true, false]) {
        const printed = printedNumbers(contractSectionNumbers({ deposits, specialAgreements }))
        expect(printed).toEqual(printed.map((_, index) => index + 1))
        expect(printed).toHaveLength(
          CONTRACT_SECTIONS.length - (deposits ? 0 : 1) - (specialAgreements ? 0 : 1)
        )
      }
    }
  })
})

describe('contractDeposits', () => {
  const memo = (deposits: ContractData['dealMemo']['deposits']) =>
    ({ deposits }) as ContractData['dealMemo']

  it('has no deposits when none or none above zero are set', () => {
    expect(contractDeposits(memo([]))).toEqual([])
    expect(contractDeposits(memo([{ amount: 0, dueDate: '2026-12-01' }]))).toEqual([])
  })

  it('keeps every deposit with an amount, in order, an empty date meaning "bei Vertragsabschluss"', () => {
    expect(
      contractDeposits(
        memo([
          { amount: 500, dueDate: null },
          { amount: 0, dueDate: null },
          { amount: 750.5, dueDate: '2026-12-01' },
          { amount: 300, dueDate: '' }
        ])
      )
    ).toEqual([
      { amount: 500, dueDate: null },
      { amount: 750.5, dueDate: '2026-12-01' },
      { amount: 300, dueDate: null }
    ])
  })
})
