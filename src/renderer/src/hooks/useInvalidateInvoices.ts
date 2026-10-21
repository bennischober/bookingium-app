import { trpcReact } from '@/lib/trpc'

/** Refreshes every view that shows invoices (lists, event, dashboard) */
export function useInvalidateInvoices() {
  const utils = trpcReact.useUtils()
  return () => {
    void utils.invoice.invalidate()
    void utils.dealMemo.getById.invalidate()
    void utils.dashboard.invalidate()
  }
}
