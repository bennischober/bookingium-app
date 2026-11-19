// #225: the receipt form's text fields and the values they stand for. Pure, so it is tested.
import { fromCents, toCents } from '../../../../main/einvoice/amounts'
import { parseAmount } from '@/lib/invoiceLabels'
import type { ReceiptDto, ReceiptFields } from '../../../../main/api/schemas/receipt.schema'

/** The form as typed: amounts and dates are text until saved */
export type ReceiptFormState = Omit<ReceiptFields, 'amountCents' | 'receiptDate'> & {
  amount: string
  receiptDate: string
}

/** 119000 → "1.190,00"; null → "" */
export function amountText(cents: number | null): string {
  if (cents === null) return ''
  return fromCents(cents).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

export function formStateOf(fields: ReceiptFields): ReceiptFormState {
  const { amountCents, receiptDate, ...rest } = fields
  return { ...rest, amount: amountText(amountCents), receiptDate: receiptDate ?? '' }
}

export function formStateOfReceipt(receipt: ReceiptDto): ReceiptFormState {
  return formStateOf({
    companyId: receipt.companyId,
    category: receipt.category,
    receiptDate: receipt.receiptDate,
    amountCents: receipt.amountCents,
    currency: receipt.currency,
    supplierCompanyId: receipt.supplierCompanyId,
    supplierName: receipt.supplierCompanyId ? '' : receipt.supplierName,
    reference: receipt.reference,
    notes: receipt.notes,
    inDatev: receipt.datev === 'external',
    fileName: receipt.fileName.replace(/\.(pdf|xml)$/i, '')
  })
}

/** The fields to save, or the German reason they cannot be saved yet */
export function fieldsOf(state: ReceiptFormState): ReceiptFields | { error: string } {
  if (!state.fileName.trim()) return { error: 'Bitte einen Dateinamen angeben' }
  let amountCents: number | null = null
  if (state.amount.trim()) {
    const amount = parseAmount(state.amount)
    if (amount === null) return { error: 'Der Betrag ist keine Zahl' }
    amountCents = toCents(amount)
  }
  const date = state.receiptDate.trim()
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return { error: 'Bitte ein gültiges Datum angeben' }
  const currency = state.currency.trim().toUpperCase() || 'EUR'
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Währung mit 3 Buchstaben (z. B. EUR)' }
  const { amount: _amount, ...rest } = state
  void _amount
  return { ...rest, currency, amountCents, receiptDate: date || null }
}
