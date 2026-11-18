import { useNavigate } from '@tanstack/react-router'
import { Landmark } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { formatShortDate } from '@/lib/utils'
import { formatMoney } from '@/lib/invoiceLabels'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fromCents } from '../../../../main/einvoice/amounts'
import { RECEIPT_CATEGORY_LABELS } from '../../../../main/api/schemas/receipt.schema'

// At most this many on the Dashboard; the receipts page lists the rest
const SHOWN = 5

/**
 * Dashboard card (#225): receipts of companies with a DATEV address for their category that
 * were not handed over yet, oldest first, each with its send. Hidden while there are none.
 */
export function ReceiptPendingCard() {
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const query = trpcReact.receipt.listNotHandedOver.useQuery()
  const send = trpcReact.receipt.sendToDatev.useMutation({
    onSuccess: (result) => {
      void utils.receipt.invalidate()
      if (result.success) toast.success('An DATEV übergeben', { description: result.to })
      else toast.error('Nicht an DATEV übergeben', { description: result.error })
    },
    onError: (error) => toast.error('Nicht an DATEV übergeben', { description: error.message })
  })
  const receipts = query.data ?? []
  if (receipts.length === 0) return null

  return (
    <Card role="region" aria-labelledby="receipt-pending-title">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle id="receipt-pending-title">Belege noch nicht an DATEV übergeben</CardTitle>
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/receipts' })}>
          Alle Belege
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {receipts.slice(0, SHOWN).map((receipt) => (
            <li
              key={receipt.id}
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{receipt.supplierName || receipt.fileName}</p>
                <p className="text-sm text-muted-foreground">
                  {RECEIPT_CATEGORY_LABELS[receipt.category]}
                  {receipt.receiptDate ? ` · ${formatShortDate(receipt.receiptDate)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {receipt.amountCents !== null && (
                  <span className="text-sm font-semibold">
                    {formatMoney(fromCents(receipt.amountCents), receipt.currency)}
                  </span>
                )}
                <Button
                  variant="outline"
                  className="gap-1.5"
                  disabled={send.isPending}
                  onClick={() => send.mutate({ id: receipt.id })}
                >
                  <Landmark className="h-4 w-4" />
                  An DATEV übergeben
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {receipts.length > SHOWN && (
          <p className="mt-3 text-sm text-muted-foreground">
            und {receipts.length - SHOWN} weitere
          </p>
        )}
      </CardContent>
    </Card>
  )
}
