import { useMemo } from 'react'
import QRCode from 'qrcode'
import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import { epcPayload, invoicePayment } from '../../../../main/payment/epcQr'

const STRINGS = {
  de: { title: 'Bequem bezahlen', text: 'Mit der Banking-App scannen' },
  en: { title: 'Pay by banking app', text: 'Scan with your banking app' }
}

/** Dark modules as one SVG path (drawn synchronously, so it is in every print) */
function qrPath(text: string): { size: number; path: string } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
  let path = ''
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(row, col)) path += `M${col} ${row}h1v1h-1z`
    }
  }
  return { size: modules.size, path }
}

/**
 * EPC payment QR code ("GiroCode") with a short caption, sized to sit next
 * to the totals. The quiet zone the code needs is the whitespace around it
 * (page margin, gaps). Renders nothing for invoices that get none (drafts,
 * cancelled, no IBAN, …).
 */
export function PaymentQr({ data, lang }: { data: InvoicePrintDto; lang: 'de' | 'en' }) {
  const payload = useMemo(() => {
    const payment = invoicePayment(data, lang)
    return payment ? epcPayload(payment) : null
  }, [data, lang])
  const qr = useMemo(() => (payload ? qrPath(payload) : null), [payload])
  if (!payload || !qr) return null

  const t = STRINGS[lang]
  return (
    <div className="flex items-center gap-3 pt-1" data-testid="payment-qr">
      <svg
        viewBox={`0 0 ${qr.size} ${qr.size}`}
        className="h-[21mm] w-[21mm] shrink-0"
        shapeRendering="crispEdges"
        role="img"
        aria-label="QR-Code für die Überweisung"
      >
        <path d={qr.path} fill="#000" />
      </svg>
      <div className="text-[8pt] leading-snug text-neutral-600">
        <div className="font-semibold text-black">{t.title}</div>
        <div>{t.text}</div>
      </div>
    </div>
  )
}
