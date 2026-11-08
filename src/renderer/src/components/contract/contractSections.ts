// Section numbering and the optional "Vorkasse" clause of the concert contract (pure, unit-tested).
// Optional sections are left out entirely, so every later section moves up one number.
import type { ContractData } from '../../../../main/api/schemas/contract.schema'

/** Every section of the concert contract, in print order */
export const CONTRACT_SECTIONS = [
  'engagement',
  'fee',
  'billing',
  'deposits',
  'registration',
  'technics',
  'stage',
  'travel',
  'accommodation',
  'catering',
  'artisticFreedom',
  'associations',
  'security',
  'advertising',
  'cancellation',
  'merchandising',
  'recordings',
  'guestList',
  'rider',
  'legal',
  'general',
  'specialAgreements'
] as const

export type ContractSection = (typeof CONTRACT_SECTIONS)[number]

/** Sections that are printed only when they have content */
type OptionalSection = 'deposits' | 'specialAgreements'

/**
 * Number of each printed section, from 1 without gaps; an optional section that is
 * not printed has no number.
 */
export function contractSectionNumbers(
  include: Record<OptionalSection, boolean>
): Record<ContractSection, number | null> {
  const numbers = {} as Record<ContractSection, number | null>
  let next = 1
  for (const section of CONTRACT_SECTIONS) {
    const printed =
      section === 'deposits' || section === 'specialAgreements' ? include[section] : true
    numbers[section] = printed ? next++ : null
  }
  return numbers
}

/** A prepayment: net euros like the guarantee, an ISO due date or null for "bei Vertragsabschluss" */
export type ContractDeposit = ContractData['dealMemo']['deposits'][number]

/** The prepayments to print: those with an amount above zero, in their order */
export function contractDeposits(dealMemo: ContractData['dealMemo']): ContractDeposit[] {
  return dealMemo.deposits
    .filter((deposit) => deposit.amount > 0)
    .map((deposit) => ({ amount: deposit.amount, dueDate: deposit.dueDate || null }))
}
