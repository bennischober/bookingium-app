import { useParams, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Printer } from 'lucide-react'
import { trpcReact } from '@/main'
import { Button } from '@/components/ui/button'
import type { InvoicePartySnapshotDto } from '../../../main/api/schemas/invoice.schema'

function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency: currency || 'EUR'
  }).format(value)
}

// Formats date-only ISO strings (YYYY-MM-DD) without timezone pitfalls
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-'
  const [year, month, day] = iso.split('-')
  if (!year || !month || !day) return iso
  return `${day}.${month}.${year}`
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 3 }).format(value)
}

function PartyBlock({ title, party }: { title: string; party: InvoicePartySnapshotDto | null }) {
  return (
    <div className="text-[10pt] leading-snug">
      <div className="font-semibold mb-1">{title}</div>
      {party ? (
        <div>
          <div className="font-medium">{party.legalName}</div>
          {(party.street || party.streetNumber) && (
            <div>
              {party.street} {party.streetNumber}
            </div>
          )}
          {(party.zipCode || party.city) && (
            <div>
              {party.zipCode} {party.city}
            </div>
          )}
          {party.country && <div>{party.country}</div>}
          {party.email && <div>{party.email}</div>}
          {party.phone && <div>{party.phone}</div>}
          {(party.vatNumber || party.ustNumber) && (
            <div className="mt-1">
              {party.vatNumber && <div>VAT ID: {party.vatNumber}</div>}
              {party.ustNumber && <div>Tax no.: {party.ustNumber}</div>}
            </div>
          )}
        </div>
      ) : (
        <div className="text-neutral-500">No party data recorded</div>
      )}
    </div>
  )
}

export default function InvoicePrintPage() {
  const { invoiceId } = useParams({ strict: false })
  const navigate = useNavigate()
  const id = Number(invoiceId)

  const printQuery = trpcReact.invoice.getPrintData.useQuery(id, {
    enabled: Number.isFinite(id) && id > 0
  })

  const data = printQuery.data

  if (printQuery.isLoading) {
    return <div className="flex h-full items-center justify-center text-muted-foreground">Loading invoice...</div>
  }

  if (printQuery.isError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Invoice not found.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/invoices' })}>
          <ArrowLeft className="h-4 w-4" /> Back to invoices
        </Button>
      </div>
    )
  }

  const { invoice, issuer, recipient } = data
  const isDraft = invoice.status === 'draft'

  return (
    <div className="min-h-screen bg-neutral-200 py-8 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 0; }`}</style>

      {/* Screen-only toolbar */}
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <Button variant="outline" onClick={() => navigate({ to: '/invoices' })}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </Button>
      </div>

      {/* A4 sheet */}
      <div className="relative mx-auto w-[210mm] min-h-[297mm] bg-white p-[18mm] text-black shadow-lg print:shadow-none print:m-0 print:w-auto print:min-h-0">
        {isDraft && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center print:block">
            <span className="rotate-[-30deg] text-[60pt] font-bold text-neutral-200 select-none">
              DRAFT
            </span>
          </div>
        )}

        {/* Header: issuer left, document meta right */}
        <div className="flex justify-between items-start">
          <PartyBlock title="From" party={issuer} />
          <div className="text-right">
            <div className="text-[20pt] font-bold tracking-wide">INVOICE</div>
            <div className="mt-2 text-[10pt]">
              <div>
                No. {invoice.companyId}-{invoice.invoiceNumber}
              </div>
              <div>Date: {formatDate(invoice.issueDate)}</div>
              {invoice.dueDate && <div>Due: {formatDate(invoice.dueDate)}</div>}
            </div>
          </div>
        </div>

        <hr className="my-6 border-neutral-300" />

        {/* Recipient + reference */}
        <div className="flex justify-between items-start gap-8">
          <div className="w-1/2">
            <PartyBlock title="Bill to" party={recipient} />
          </div>
          <div className="w-1/2 text-[10pt] leading-snug">
            {invoice.dealMemoName && (
              <div>
                <span className="font-semibold">Event:</span> {invoice.dealMemoName}
              </div>
            )}
            {invoice.periodLabel && (
              <div>
                <span className="font-semibold">Period:</span> {invoice.periodLabel}
              </div>
            )}
            {(invoice.periodStartDate || invoice.periodEndDate) && (
              <div>
                <span className="font-semibold">Service period:</span>{' '}
                {formatDate(invoice.periodStartDate)} – {formatDate(invoice.periodEndDate)}
              </div>
            )}
          </div>
        </div>

        {/* Line items */}
        <table className="mt-8 w-full text-[9.5pt]">
          <thead>
            <tr className="border-b border-neutral-400 text-left">
              <th className="py-2 pr-2 font-semibold">Pos.</th>
              <th className="py-2 pr-2 font-semibold">Description</th>
              <th className="py-2 pr-2 text-right font-semibold">Qty</th>
              <th className="py-2 pr-2 font-semibold">Unit</th>
              <th className="py-2 pr-2 text-right font-semibold">Net</th>
              <th className="py-2 pr-2 text-right font-semibold">VAT %</th>
              <th className="py-2 pr-2 text-right font-semibold">VAT</th>
              <th className="py-2 text-right font-semibold">Gross</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lineItems.map((item) => (
              <tr key={item.id} className="border-b border-neutral-200 align-top">
                <td className="py-2 pr-2">{item.position}</td>
                <td className="py-2 pr-2">{item.description}</td>
                <td className="py-2 pr-2 text-right">{formatQuantity(item.quantity)}</td>
                <td className="py-2 pr-2">{item.unit}</td>
                <td className="py-2 pr-2 text-right">{formatMoney(item.lineNetAmount, invoice.currency)}</td>
                <td className="py-2 pr-2 text-right">{formatQuantity(item.taxRate)}%</td>
                <td className="py-2 pr-2 text-right">{formatMoney(item.lineTaxAmount, invoice.currency)}</td>
                <td className="py-2 text-right">{formatMoney(item.lineGrossAmount, invoice.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-6 ml-auto w-[70mm] text-[10pt]">
          <div className="flex justify-between py-1">
            <span>Subtotal (net)</span>
            <span>{formatMoney(invoice.subtotalNetAmount, invoice.currency)}</span>
          </div>
          <div className="flex justify-between py-1">
            <span>VAT</span>
            <span>{formatMoney(invoice.subtotalTaxAmount, invoice.currency)}</span>
          </div>
          <div className="flex justify-between border-t border-neutral-400 py-2 font-bold text-[11pt]">
            <span>Total</span>
            <span>{formatMoney(invoice.totalGrossAmount, invoice.currency)}</span>
          </div>
        </div>

        {/* Notes */}
        <div className="mt-8 space-y-2 text-[9pt] text-neutral-700">
          {invoice.reverseChargeNote && <p>{invoice.reverseChargeNote}</p>}
          {invoice.paymentTerms && (
            <p>
              <span className="font-semibold text-black">Payment terms: </span>
              {invoice.paymentTerms}
            </p>
          )}
          {invoice.notes && (
            <p>
              <span className="font-semibold text-black">Notes: </span>
              {invoice.notes}
            </p>
          )}
        </div>

        {/* Footer */}
        {issuer && (issuer.iban || issuer.bic) && (
          <div className="mt-10 border-t border-neutral-300 pt-3 text-[8.5pt] text-neutral-600">
            {issuer.iban && (
              <span>
                IBAN: {issuer.iban}
                {issuer.bic ? ' · ' : ''}
              </span>
            )}
            {issuer.bic && <span>BIC: {issuer.bic}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
