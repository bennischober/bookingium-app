import { useEffect, useState } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Printer } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { PrintViewToggle } from '@/components/print/PrintViewToggle'
import type { PrintView } from '@/components/print/PagedDocument'
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

export default function InvoicePrintPage() {
  const { invoiceId } = useParams({ strict: false })
  const navigate = useNavigate()
  const id = Number(invoiceId)

  const printQuery = trpcReact.invoice.getPrintData.useQuery(id, {
    enabled: Number.isFinite(id) && id > 0
  })

  const data = printQuery.data

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
  // A4 page view (real print output) or the plain document sheet
  const [view, setView] = useState<PrintView>('pages')

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

  return (
    <div className="min-h-screen bg-neutral-200 py-8 print:bg-white print:py-0">
      {/* Screen-only toolbar */}
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <Button variant="outline" onClick={() => navigate({ to: '/invoices' })}>
          <ArrowLeft className="h-4 w-4" /> Zurück
        </Button>
        <div className="flex items-center gap-3">
          <Select value={template} onValueChange={(value) => setTemplate(value as InvoiceTemplate)}>
            <SelectTrigger className="w-[220px]">
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
          <PrintViewToggle value={view} onChange={setView} />
          <Button onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Drucken / Als PDF speichern
          </Button>
        </div>
      </div>

      <InvoiceDocument data={data} template={template} logoUrl={logoUrl} view={view} />
    </div>
  )
}
