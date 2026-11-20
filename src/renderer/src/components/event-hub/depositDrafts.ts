// Editable rows of the contract's prepayments ("Vorkasse") in the Finanzen tab (pure, unit-tested).
import type { DealMemoDeposit } from '../../../../main/api/schemas/deal_memo.schema'
import { formatShortDate } from '@/lib/utils'
import { formatMoney } from '../../../../main/invoice/money'
import { t } from '../../../../main/i18n/translate'

/** One row as typed: the raw input values, '' for empty */
export interface DepositDraft {
  amount: string
  /** ISO date from the date input; '' = "bei Vertragsabschluss" */
  dueDate: string
  /** #201: ISO date it was paid; '' = still open */
  paidAt: string
}

export function toDepositDrafts(deposits: DealMemoDeposit[]): DepositDraft[] {
  return deposits.map((deposit) => ({
    amount: deposit.amount.toString(),
    dueDate: deposit.dueDate ?? '',
    paidAt: deposit.paidAt ?? ''
  }))
}

/** The rows to save, in order; a row without an amount above zero is dropped */
export function fromDepositDrafts(drafts: DepositDraft[]): DealMemoDeposit[] {
  return drafts
    .map((draft) => ({
      amount: parseFloat(draft.amount),
      dueDate: draft.dueDate || null,
      paidAt: draft.paidAt || null
    }))
    .filter((deposit) => deposit.amount > 0)
}

/** Whether saving the rows would change the stored prepayments */
export function depositsChanged(drafts: DepositDraft[], stored: DealMemoDeposit[]): boolean {
  const next = fromDepositDrafts(drafts)
  return (
    next.length !== stored.length ||
    next.some(
      (deposit, index) =>
        deposit.amount !== stored[index].amount ||
        deposit.dueDate !== stored[index].dueDate ||
        deposit.paidAt !== (stored[index].paidAt ?? null)
    )
  )
}

/** Read-mode text: one line per prepayment */
export function depositSummary(deposits: DealMemoDeposit[]): string {
  return deposits
    .map(
      (deposit, index) =>
        `${index + 1}. ${formatMoney(deposit.amount, 'EUR')}, ${
          deposit.dueDate
            ? t('fällig am {{date}}', { date: formatShortDate(deposit.dueDate) })
            : t('fällig bei Vertragsabschluss')
        }${deposit.paidAt ? t(', bezahlt am {{formatShortDate}}', { formatShortDate: formatShortDate(deposit.paidAt) }) : ''}`
    )
    .join('\n')
}
