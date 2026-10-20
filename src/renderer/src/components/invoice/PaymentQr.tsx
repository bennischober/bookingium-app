import { useMemo } from 'react'
import QRCode from 'qrcode'
import type { InvoicePrintDto } from '../../../../main/api/schemas/invoice.schema'
import { epcPayload, invoicePayment } from '../../../../main/payment/epcQr'

// Quiet zone around the code, in modules (the QR spec asks for 4)
const QUIET_ZONE = 4

const STRINGS = {
  de: {
    title: 'Bequem bezahlen',
    text: 'QR-Code mit der Banking-App scannen – Empfänger, IBAN, Betrag und Verwendungszweck sind ausgefüllt.'
  },
  en: {
    title: 'Pay by banking app',
    text: 'Scan the QR code with your banking app – recipient, IBAN, amount and reference are filled in.'
  }
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
 * EPC payment QR code ("GiroCode") with a short hint. Renders nothing for
 * invoices that get none (drafts, cancelled, no IBAN, …).
 */
export function PaymentQr({ data, lang }: { data: InvoicePrintDto; lang: 'de' | 'en' }) {
  const payload = useMemo(() => {
    const payment = invoicePayment(data, lang)
    return payment ? epcPayload(payment) : null
  }, [data, lang])
  const qr = useMemo(() => (payload ? qrPath(payload) : null), [payload])
  if (!payload || !qr) return null

  const t = STRINGS[lang]
  const box = qr.size + QUIET_ZONE * 2
  return (
    <div className="mt-6 flex break-inside-avoid items-center gap-4" data-testid="payment-qr">
      <svg
        viewBox={`${-QUIET_ZONE} ${-QUIET_ZONE} ${box} ${box}`}
        className="h-[28mm] w-[28mm] shrink-0"
        shapeRendering="crispEdges"
        role="img"
        aria-label="QR-Code für die Überweisung"
      >
        <rect x={-QUIET_ZONE} y={-QUIET_ZONE} width={box} height={box} fill="#fff" />
        <path d={qr.path} fill="#000" />
      </svg>
      <div className="max-w-[90mm] text-[9pt] leading-snug">
        <div className="font-semibold">{t.title}</div>
        <div className="text-neutral-700">{t.text}</div>
      </div>
    </div>
  )
}
