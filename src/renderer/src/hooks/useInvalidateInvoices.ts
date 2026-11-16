import { trpcReact } from '@/lib/trpc'

/** Refreshes every view that shows invoices (lists, event, dashboard) */
export function useInvalidateInvoices() {
  const utils = trpcReact.useUtils()
  return () => {
    void utils.invoice.invalidate()
    void utils.dealMemo.getById.invalidate()
    void utils.dashboard.invalidate()
    // A new or cancelled invoice changes what is still to be handed to DATEV
    void utils.datev.invalidate()
  }
}
