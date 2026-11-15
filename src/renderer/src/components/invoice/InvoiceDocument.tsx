import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import { PagedDocument } from '../print/PagedDocument'
import { AgencyTemplate } from './AgencyInvoiceTemplate'
import { StandardTemplate } from './StandardInvoiceTemplate'

// Templates: StandardInvoiceTemplate.tsx and AgencyInvoiceTemplate.tsx, built
// from InvoiceParts.tsx and the helpers in invoiceFormat.ts

// ========================================
// Template catalog (hardcoded by design)
// ========================================

export const INVOICE_TEMPLATES = [
  { value: 'standard', label: 'Standard' },
  { value: 'agency-de', label: 'Agentur (Deutsch)' },
  { value: 'agency-en', label: 'Agentur (Englisch)' }
] as const

export type InvoiceTemplate = (typeof INVOICE_TEMPLATES)[number]['value']

// ========================================
// Document shell (A4 sheet + draft watermark)
// ========================================

export function InvoiceDocument({
  data,
  template,
  logoUrl,
  paymentQr = true
}: {
  data: InvoicePrintDto
  template: InvoiceTemplate
  logoUrl?: string
  /** EPC payment QR code on payable invoices (setting) */
  paymentQr?: boolean
}) {
  // Drafts and cancelled invoices carry a watermark on every print
  const watermark =
    data.invoice.status === 'draft'
      ? template === 'agency-en'
        ? 'DRAFT'
        : 'ENTWURF'
      : data.invoice.status === 'cancelled'
        ? template === 'agency-en'
          ? 'CANCELLED'
          : 'STORNIERT'
        : null

  return (
    <PagedDocument>
      {/* fixed in print: Chromium repeats fixed elements on every page, centered
          per page. inline-block so the rotation applies; translucent so it
          never hides the text underneath. */}
      {watermark && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center print:fixed">
          <span className="inline-block rotate-[-30deg] text-[60pt] font-bold text-black/10 select-none">
            {watermark}
          </span>
        </div>
      )}

      {template === 'standard' && <StandardTemplate data={data} paymentQr={paymentQr} />}
      {template === 'agency-de' && (
        <AgencyTemplate data={data} lang="de" logoUrl={logoUrl} paymentQr={paymentQr} />
      )}
      {template === 'agency-en' && (
        <AgencyTemplate data={data} lang="en" logoUrl={logoUrl} paymentQr={paymentQr} />
      )}
    </PagedDocument>
  )
}
