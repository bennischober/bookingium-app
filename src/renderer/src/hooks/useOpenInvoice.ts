import { useNavigate } from '@tanstack/react-router'
import { isInvoiceLocked, type InvoiceStatus } from '../../../main/api/schemas/invoice.schema'

/**
 * Opens an invoice where it lives: issued ones on their page, drafts in
 * the edit sheet of the invoice list
 */
export function useOpenInvoice() {
  const navigate = useNavigate()
  return (invoice: { id: number; status: InvoiceStatus }) =>
    isInvoiceLocked(invoice.status)
      ? navigate({ to: '/invoices/$invoiceId', params: { invoiceId: String(invoice.id) } })
      : navigate({ to: '/invoices', search: { open: invoice.id } })
}
