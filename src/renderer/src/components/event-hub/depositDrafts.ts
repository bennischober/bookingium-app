// Editable rows of the contract's prepayments ("Vorkasse") in the Finanzen tab (pure, unit-tested).
import type { DealMemoDeposit } from '../../../../main/api/schemas/deal_memo.schema'
import { formatShortDate } from '@/lib/utils'

/** One row as typed: the raw input values, '' for empty */
export interface DepositDraft {
  amount: string
  /** ISO date from the date input; '' = "bei Vertragsabschluss" */
  dueDate: string
}

export function toDepositDrafts(deposits: DealMemoDeposit[]): DepositDraft[] {
  return deposits.map((deposit) => ({
    amount: deposit.amount.toString(),
    dueDate: deposit.dueDate ?? ''
  }))
}

/** The rows to save, in order; a row without an amount above zero is dropped */
export function fromDepositDrafts(drafts: DepositDraft[]): DealMemoDeposit[] {
  return drafts
    .map((draft) => ({ amount: parseFloat(draft.amount), dueDate: draft.dueDate || null }))
    .filter((deposit) => deposit.amount > 0)
}

/** Whether saving the rows would change the stored prepayments */
export function depositsChanged(drafts: DepositDraft[], stored: DealMemoDeposit[]): boolean {
  const next = fromDepositDrafts(drafts)
  return (
    next.length !== stored.length ||
    next.some(
      (deposit, index) =>
        deposit.amount !== stored[index].amount || deposit.dueDate !== stored[index].dueDate
    )
  )
}

/** Read-mode text: one line per prepayment */
export function depositSummary(deposits: DealMemoDeposit[]): string {
  return deposits
    .map(
      (deposit, index) =>
        `${index + 1}. € ${deposit.amount.toFixed(2)}, fällig ${
          deposit.dueDate ? `am ${formatShortDate(deposit.dueDate)}` : 'bei Vertragsabschluss'
        }`
    )
    .join('\n')
}
