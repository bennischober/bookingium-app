import { useState } from 'react'
import { CheckCircle2, Landmark } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { confirmAction } from '@/lib/confirm'
import { datevTransferLabel } from './datevTransfer'
import { PRODUCT_NAMES } from '../../../../main/api/terms'
import { DATEV_CATEGORY_LABELS, DatevCategory } from '../../../../main/api/schemas/datev.schema'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { t } from '../../../../main/i18n/translate'

/**
 * "An DATEV übergeben" of the invoice print page: the main process mails this page's PDF (with
 * e-invoice) to the issuing company's DATEV Upload Mail address of the chosen category, from the
 * "Senden von" account. DATEV files a document by the address it arrives at, so the category is
 * picked here: Rechnungsausgang by default, the others when the company has their address.
 * A second hand-over asks first: it would be a second copy of the same Beleg there.
 */
export function InvoiceDatevButton({
  invoiceId,
  companyId,
  fileName
}: {
  invoiceId: number
  companyId: number
  fileName: string
}) {
  const [sending, setSending] = useState(false)
  const [picked, setPicked] = useState<DatevCategory | null>(null)
  const navigate = useNavigate()
  const utils = trpcReact.useUtils()
  const transfers = trpcReact.datev.listForInvoice.useQuery(invoiceId)
  const settings = trpcReact.invoice.getCompanySettings.useQuery(companyId)
  const latest = transfers.data?.[0]

  const addresses = settings.data?.datevUploadEmails
  const available = DatevCategory.options.filter((category) => Boolean(addresses?.[category]))
  // Rechnungsausgang unless only other categories have an address
  const category: DatevCategory =
    picked ?? (available.includes('outgoing') || available.length === 0 ? 'outgoing' : available[0])

  const send = async () => {
    if (
      latest &&
      !(await confirmAction({
        title: t('Erneut an DATEV übergeben?'),
        description: `${datevTransferLabel(latest)}. DATEV legt dann einen zweiten Beleg an.`,
        confirmLabel: t('Erneut übergeben')
      }))
    ) {
      return
    }
    setSending(true)
    try {
      const result = await window.api.sendInvoiceToDatev(invoiceId, fileName, category)
      if (!result.success) {
        const tab = result.setup === 'datev' ? 'invoices' : 'email'
        toast.error(t('Übergabe an DATEV fehlgeschlagen'), {
          description: result.error,
          ...(result.setup
            ? {
                action: {
                  label: t('Einstellungen öffnen'),
                  onClick: () => void navigate({ to: '/settings', search: { tab } })
                }
              }
            : {})
        })
        return
      }
      const where = `${DATEV_CATEGORY_LABELS[category]} – ${result.to}`
      if (result.eInvoice?.state === 'incomplete') {
        toast.warning(t('An DATEV übergeben'), {
          description: `${where}. PDF ohne E-Rechnung – es fehlt: ${result.eInvoice.missing.join('; ')}`
        })
      } else {
        toast.success(t('An DATEV übergeben'), { description: where })
      }
    } finally {
      // An unclear send stays pending: the list shows it as still being confirmed
      void utils.datev.invalidate()
      setSending(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Select value={category} onValueChange={(value) => setPicked(value as DatevCategory)}>
        <SelectTrigger className="w-44" aria-label="DATEV-Belegkategorie">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DatevCategory.options.map((option) => (
            <SelectItem
              key={option}
              value={option}
              // Without an address the send could only fail; Rechnungsausgang stays pickable
              // so the error can lead to the settings
              disabled={option !== 'outgoing' && !available.includes(option)}
            >
              {DATEV_CATEGORY_LABELS[option]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        onClick={() => void send()}
        disabled={sending || transfers.isLoading}
        title={
          latest
            ? datevTransferLabel(latest)
            : t('PDF an {{datevOnline}} übergeben', { datevOnline: PRODUCT_NAMES.datevOnline })
        }
      >
        {latest?.sentAt ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        ) : (
          <Landmark className="h-4 w-4" />
        )}
        {sending ? t('Wird übergeben…') : t('An DATEV übergeben')}
      </Button>
    </div>
  )
}
