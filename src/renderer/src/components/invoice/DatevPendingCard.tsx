import { useNavigate } from '@tanstack/react-router'
import { Landmark } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { germanDate } from '@/lib/followUps'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoney, invoiceNumberLabel } from '@/lib/invoiceLabels'

/**
 * Dashboard card: issued invoices and Stornorechnungen of companies with a DATEV address that
 * have not been handed to DATEV yet, oldest first, so nothing is missing from the books. Each
 * opens its print page, where „An DATEV übergeben“ sends it. Hidden while there are none.
 */
export function DatevPendingCard() {
  const navigate = useNavigate()
  const query = trpcReact.datev.listNotHandedOver.useQuery()
  const invoices = query.data ?? []
  if (invoices.length === 0) return null

  return (
    <Card role="region" aria-labelledby="datev-pending-title">
      <CardHeader>
        <CardTitle id="datev-pending-title">Noch nicht an DATEV übergeben</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {invoices.map((invoice) => (
            <li
              key={invoice.id}
              className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="font-medium">
                  {invoice.kind === 'cancellation' ? 'Stornorechnung ' : ''}
                  {invoiceNumberLabel(invoice.invoiceNumber)} · {invoice.recipientName}
                </p>
                <p className="text-sm text-muted-foreground">
                  Gestellt am {germanDate(invoice.issueDate)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold">
                  {formatMoney(invoice.totalAmount, invoice.currency)}
                </span>
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() =>
                    navigate({
                      to: '/invoices/$invoiceId/print',
                      params: { invoiceId: String(invoice.id) }
                    })
                  }
                >
                  <Landmark className="h-4 w-4" />
                  An DATEV übergeben…
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
