import { useState } from 'react'
import { Landmark } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { InvoiceDto } from '../../../../main/api/schemas/invoice.schema'

/**
 * #246: "Rechnung schon in DATEV erstellt" for an issued invoice. Bookingium has no line back
 * from DATEV, so an invoice written there is marked here: it then leaves the "Noch nicht an
 * DATEV übergeben" list and its print page offers no hand-over. While the invoice has gone
 * nowhere (no mail, no hand-over) it can also take DATEV's number.
 */
export function InvoiceDatevCreatedCard({ invoice }: { invoice: InvoiceDto }) {
  const utils = trpcReact.useUtils()
  const transfers = trpcReact.datev.listForInvoice.useQuery(invoice.id)
  const [number, setNumber] = useState(
    invoice.invoiceNumber === null ? '' : String(invoice.invoiceNumber)
  )
  const mutation = trpcReact.invoice.setCreatedInDatev.useMutation({
    onSuccess: async (updated) => {
      await Promise.all([
        utils.invoice.getById.invalidate(invoice.id),
        utils.invoice.getAllPaginated.invalidate(),
        utils.datev.listNotHandedOver.invalidate()
      ])
      toast.success(
        updated.createdInDatev
          ? `Als „In DATEV erstellt“ markiert (Nr. ${updated.invoiceNumber})`
          : 'Markierung „In DATEV erstellt“ entfernt'
      )
    },
    onError: (error) => toast.error('Nicht gespeichert', { description: error.message })
  })
  if (invoice.invoiceNumber === null) return null
  // the number can only change while the invoice has gone nowhere
  const numberLocked = invoice.emailedAt !== null || (transfers.data?.length ?? 0) > 0
  const typed = number.trim()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="h-4 w-4" /> DATEV
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {invoice.createdInDatev ? (
          <>
            <p>
              In DATEV erstellt. Die Rechnung wird nicht von hier an DATEV übergeben.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ id: invoice.id, createdInDatev: false })}
            >
              Markierung entfernen
            </Button>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">
              Schon direkt in DATEV geschrieben? Dann hier markieren, damit sie nicht doppelt
              übergeben wird.
            </p>
            {!numberLocked && (
              <div className="space-y-1">
                <Label htmlFor="datev-created-number">Rechnungsnummer aus DATEV</Label>
                <Input
                  id="datev-created-number"
                  inputMode="numeric"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                />
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={mutation.isPending || (!numberLocked && !/^\d+$/.test(typed))}
              onClick={() =>
                mutation.mutate({
                  id: invoice.id,
                  createdInDatev: true,
                  invoiceNumber: numberLocked ? null : Number(typed)
                })
              }
            >
              Rechnung schon in DATEV erstellt
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
