import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import type { Lang } from '../../../../main/invoice/taxSummary'
import { PagedDocument } from '../print/PagedDocument'
import { AgencyTemplate } from './AgencyInvoiceTemplate'
import { LetterTemplate } from './LetterInvoiceTemplate'
import { StandardTemplate } from './StandardInvoiceTemplate'
import { watermarkOf } from './invoiceFormat'

// Templates: LetterInvoiceTemplate.tsx, StandardInvoiceTemplate.tsx and AgencyInvoiceTemplate.tsx, built
// from InvoiceParts.tsx and the helpers in invoiceFormat.ts. Every layout prints in German and
// English; layout and language are picked on the print page and never stored.

// ========================================
// Layout and language catalog (hardcoded by design)
// ========================================

export const INVOICE_LAYOUTS = [
  { value: 'letter', label: 'Geschäftsbrief' },
  { value: 'standard', label: 'Standard' },
  { value: 'agency', label: 'Agentur' }
] as const

export type InvoiceLayout = (typeof INVOICE_LAYOUTS)[number]['value']

// ========================================
// Document shell (A4 sheet + draft watermark)
// ========================================

export function InvoiceDocument({
  data,
  layout,
  lang,
  logoUrl,
  paymentQr = true
}: {
  data: InvoicePrintDto
  layout: InvoiceLayout
  lang: Lang
  logoUrl?: string
  /** EPC payment QR code on payable invoices (setting) */
  paymentQr?: boolean
}) {
  // Drafts and cancelled invoices carry a watermark on every print
  const watermark = watermarkOf(data.invoice.status, lang)

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

      {layout === 'letter' && (
        <LetterTemplate data={data} lang={lang} logoUrl={logoUrl} paymentQr={paymentQr} />
      )}
      {layout === 'standard' && <StandardTemplate data={data} lang={lang} paymentQr={paymentQr} />}
      {layout === 'agency' && (
        <AgencyTemplate data={data} lang={lang} logoUrl={logoUrl} paymentQr={paymentQr} />
      )}
    </PagedDocument>
  )
}
