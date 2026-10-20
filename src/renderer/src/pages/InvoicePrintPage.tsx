import { useEffect, useState } from 'react'
import { useParams, useNavigate, useRouter, useCanGoBack } from '@tanstack/react-router'
import { ArrowLeft, FileCode } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { PrintActions } from '@/components/print/PrintActions'
import { buildFileName } from '@/lib/fileName'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  InvoiceDocument,
  INVOICE_TEMPLATES,
  type InvoiceTemplate
} from '@/components/invoice/InvoiceDocument'
import type { InvoicePrintDto } from '../../../main/api/schemas/invoice.schema'
import { EInvoiceStatus } from '@/components/invoice/EInvoiceStatus'
import { InvoiceEmailButton } from '@/components/invoice/InvoiceEmailButton'

// Display labels for the template dropdown (DB/template values stay untouched)
const TEMPLATE_LABELS: Record<InvoiceTemplate, string> = {
  standard: 'Standard',
  'agency-de': 'Agentur (Deutsch)',
  'agency-en': 'Agentur (Englisch)'
}

// Suggests a template from the recipient's country snapshot
function suggestTemplate(data: InvoicePrintDto | undefined): InvoiceTemplate {
  if (!data) return 'standard'
  if (data.recipient?.country?.toLowerCase().includes('germany')) return 'agency-de'
  if (data.recipient?.country && !data.recipient.country.toLowerCase().includes('germany')) {
    return 'agency-en'
  }
  return 'standard'
}

/** Saves the bare XRechnung XML (upload portals of public-sector buyers) */
async function saveXRechnung(invoiceId: number, fileName: string) {
  const result = await window.api.saveEInvoiceXml(invoiceId, `${fileName}.xml`)
  if (!result.success) {
    toast.error('XRechnung konnte nicht gespeichert werden', { description: result.error })
  } else if (!result.canceled && result.filePath) {
    toast.success('XRechnung gespeichert', { description: result.filePath })
  }
}

export default function InvoicePrintPage() {
  const { invoiceId } = useParams({ strict: false })
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const id = Number(invoiceId)

  const printQuery = trpcReact.invoice.getPrintData.useQuery(id, {
    enabled: Number.isFinite(id) && id > 0
  })

  const data = printQuery.data
  const eInvoice = trpcReact.invoice.eInvoiceCheck.useQuery(id, {
    enabled: Number.isFinite(id) && id > 0
  })
  const settings = trpcReact.settings.get.useQuery()

  // Default template once data arrives; the user can override afterwards via
  // the dropdown (state adjustment during render, per "You Might Not Need an
  // Effect")
  const [suggestedTemplate, setSuggestedTemplate] = useState<InvoiceTemplate>('standard')
  const [suggestedFor, setSuggestedFor] = useState<InvoicePrintDto | undefined>(undefined)
  if (data && suggestedFor !== data) {
    setSuggestedFor(data)
    setSuggestedTemplate(suggestTemplate(data))
  }
  const [template, setTemplate] = useState<InvoiceTemplate>(suggestedTemplate)

  // Logo resolution is async IPC, so clearing on path change happens during
  // render, loading stays in an effect
  const logoPath = data?.issuer?.logoPath ?? ''
  const [logoUrl, setLogoUrl] = useState<string>('')
  const [lastLogoPath, setLastLogoPath] = useState<string>(logoPath)
  if (logoPath !== lastLogoPath) {
    setLastLogoPath(logoPath)
    setLogoUrl('')
  }

  useEffect(() => {
    if (!logoPath) return
    let revoked = false
    void window.api.getLogoPath(logoPath).then((result) => {
      if (result.success && result.dataUrl && !revoked) setLogoUrl(result.dataUrl)
    })
    return () => {
      revoked = true
    }
  }, [logoPath])

  if (printQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Rechnung wird geladen…
      </div>
    )
  }

  if (printQuery.isError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Rechnung nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/invoices' })}>
          <ArrowLeft className="h-4 w-4" /> Zurück zu den Rechnungen
        </Button>
      </div>
    )
  }

  // e.g. "Rechnung_1040_Soundwave Records", "Rechnung_Entwurf_Soundwave Records",
  // "Rechnung_2026783_The New Roses_Managementbeteiligung 4. Quartal 2025"
  const { invoice } = data
  const fileName = buildFileName([
    invoice.kind === 'cancellation' ? 'Stornorechnung' : 'Rechnung',
    invoice.invoiceNumber ?? 'Entwurf',
    data.managementShare?.bandName || data.recipient?.legalName || invoice.recipientName,
    data.managementShare ? `Managementbeteiligung ${invoice.periodLabel}` : null,
    invoice.status === 'cancelled' ? 'storniert' : null
  ])

  return (
    <div className="min-h-screen bg-neutral-200 py-8 print:bg-white print:py-0">
      {/* Screen-only toolbar */}
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        {/* Back to wherever the invoice was opened from (invoice list or an
            event's Finanzen tab); the list when opened directly */}
        <Button
          variant="outline"
          onClick={() => (canGoBack ? router.history.back() : navigate({ to: '/invoices' }))}
        >
          <ArrowLeft className="h-4 w-4" /> Zurück
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Select value={template} onValueChange={(value) => setTemplate(value as InvoiceTemplate)}>
            <SelectTrigger className="w-[190px]">
              <SelectValue placeholder="Vorlage" />
            </SelectTrigger>
            <SelectContent>
              {INVOICE_TEMPLATES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {TEMPLATE_LABELS[t.value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {eInvoice.data?.xrechnung && eInvoice.data.state === 'ready' && (
            <Button variant="outline" onClick={() => void saveXRechnung(invoice.id, fileName)}>
              <FileCode className="h-4 w-4" /> XRechnung (XML)
            </Button>
          )}
          {/* Drafts have no number yet and are not sent */}
          {invoice.status !== 'draft' && (
            <InvoiceEmailButton
              invoiceId={invoice.id}
              fileName={fileName}
              lang={template === 'agency-en' ? 'en' : 'de'}
            />
          )}
          <PrintActions fileName={fileName} invoiceId={invoice.id} />
        </div>
      </div>

      {eInvoice.data && (
        <div className="mx-auto mb-4 w-[210mm] print:hidden">
          <EInvoiceStatus check={eInvoice.data} />
        </div>
      )}

      <InvoiceDocument
        data={data}
        template={template}
        logoUrl={logoUrl}
        paymentQr={settings.data?.paymentQr ?? true}
      />
    </div>
  )
}
