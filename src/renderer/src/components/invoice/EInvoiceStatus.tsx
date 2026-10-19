import { CircleAlert, CircleCheck } from 'lucide-react'
import type { EInvoiceCheckDto } from '../../../../main/api/schemas/invoice.schema'

const READY_TEXT: Partial<Record<EInvoiceCheckDto['state'], string>> = {
  ready: 'E-Rechnung vollständig – „Als PDF speichern“ bettet sie ins PDF ein (ZUGFeRD).',
  draft: 'E-Rechnung vollständig – das PDF erhält sie, sobald die Rechnung gestellt ist.'
}

/**
 * Whether an invoice's PDF will carry the e-invoice, or what it still needs
 * ("Für die E-Rechnung fehlt: …"). Nothing when the e-invoice is switched
 * off; a short note for cancelled invoices.
 */
export function EInvoiceStatus({
  check,
  className = ''
}: {
  check: EInvoiceCheckDto
  className?: string
}) {
  if (check.state === 'disabled') return null

  if (check.state === 'cancelled') {
    return (
      <p className={`text-sm text-muted-foreground ${className}`}>
        Stornierte Rechnungen erhalten keine E-Rechnung.
      </p>
    )
  }

  if (check.state === 'incomplete') {
    return (
      <div
        role="status"
        aria-label="E-Rechnung"
        className={`rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 ${className}`}
      >
        <p className="flex items-center gap-2 font-medium">
          <CircleAlert className="h-4 w-4 shrink-0" /> Für die E-Rechnung fehlt:
        </p>
        <ul className="mt-1 list-disc pl-10">
          {check.missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs">Ohne diese Angaben wird das PDF ohne E-Rechnung gespeichert.</p>
      </div>
    )
  }

  return (
    <p
      role="status"
      aria-label="E-Rechnung"
      className={`flex items-center gap-2 text-sm text-green-800 dark:text-green-400 ${className}`}
    >
      <CircleCheck className="h-4 w-4 shrink-0" /> {READY_TEXT[check.state]}
    </p>
  )
}
