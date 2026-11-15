import { useMemo } from 'react'
import { trpcReact } from '@/lib/trpc'
import type {
  EInvoiceCheckDto,
  PreviewInvoicePartiesInput
} from '../../../main/api/schemas/invoice.schema'
import { prepareEInvoice, type EInvoiceInput } from '../../../main/einvoice/prepare'

/** The invoice as the form holds it: everything the check needs except the parties */
export type EInvoiceDraft = Omit<EInvoiceInput, 'invoiceNumber' | 'seller' | 'buyer'>

/**
 * The e-invoice check of an invoice being edited, with the parties as issuing
 * would freeze them. Only asks for the parties while `active` (the form's last
 * step) and when e-invoices are switched on. The check is null until then.
 */
export function useInvoiceEInvoiceCheck({
  parties: partiesInput,
  draft,
  active
}: {
  parties: PreviewInvoicePartiesInput
  draft: EInvoiceDraft
  active: boolean
}): { enabled: boolean; check: EInvoiceCheckDto | null } {
  const settings = trpcReact.settings.get.useQuery()
  const enabled = settings.data?.eInvoiceEmbed ?? false
  const parties = trpcReact.invoice.previewParties.useQuery(partiesInput, {
    enabled: enabled && active
  })

  const {
    issueDate,
    dueDate,
    currency,
    buyerReference,
    periodStartDate,
    periodEndDate,
    eventDate,
    paymentTerms,
    taxNote,
    notes,
    lines,
    xrechnung
  } = draft
  const check = useMemo(() => {
    if (!parties.data) return null
    const result = prepareEInvoice(
      {
        invoiceNumber: null,
        issueDate,
        dueDate,
        currency,
        buyerReference,
        periodStartDate,
        periodEndDate,
        eventDate,
        paymentTerms,
        taxNote,
        notes,
        seller: parties.data.issuer,
        buyer: parties.data.recipient,
        lines,
        xrechnung
      },
      { ignoreNumber: true }
    )
    return {
      state: result.complete ? ('draft' as const) : ('incomplete' as const),
      missing: result.missing,
      xrechnung: xrechnung ?? false
    }
  }, [
    parties.data,
    issueDate,
    dueDate,
    currency,
    buyerReference,
    periodStartDate,
    periodEndDate,
    eventDate,
    paymentTerms,
    taxNote,
    notes,
    lines,
    xrechnung
  ])

  return { enabled, check }
}
