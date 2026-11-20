import { useEffect, useState } from 'react'
import { useParams, useNavigate, useRouter, useCanGoBack, useSearch } from '@tanstack/react-router'
import { ArrowLeft, FileCode } from 'lucide-react'
import { toast } from '@/lib/toast'
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
  INVOICE_LAYOUTS,
  type InvoiceLayout
} from '@/components/invoice/InvoiceDocument'
import { ForeignRecipientHint } from '@/components/invoice/ForeignRecipientHint'
import {
  DocumentLanguageSelect,
  TOOLBAR_SELECT_CLASS,
  type DocumentLang
} from '@/components/print/DocumentLanguageSelect'
import type { InvoicePrintDto, ReminderKind } from '../../../main/api/schemas/invoice.schema'
import { suggestDocumentLang } from '../../../main/invoice/taxSummary'
import { EInvoiceStatus } from '@/components/invoice/EInvoiceStatus'
import { InvoiceDatevButton } from '@/components/invoice/InvoiceDatevButton'
import { InvoiceEmailButton } from '@/components/invoice/InvoiceEmailButton'
import { t } from '../../../main/i18n/translate'

// The words of the PDF's file name, in the document's language
const FILE_NAME_WORDS: Record<
  DocumentLang,
  { invoice: string; cancellation: string; draft: string; share: string; cancelled: string }
> = {
  de: {
    invoice: 'Rechnung',
    cancellation: 'Stornorechnung',
    draft: 'Entwurf',
    share: 'Managementbeteiligung',
    cancelled: 'storniert'
  },
  en: {
    invoice: 'Invoice',
    cancellation: 'Cancellation invoice',
    draft: 'Draft',
    share: 'Management share',
    cancelled: 'cancelled'
  }
}

/** Saves the bare XRechnung XML (upload portals of public-sector buyers) */
async function saveXRechnung(invoiceId: number, fileName: string) {
  const result = await window.api.saveEInvoiceXml(invoiceId, `${fileName}.xml`)
  if (!result.success) {
    toast.error(t('XRechnung konnte nicht gespeichert werden'), { description: result.error })
  } else if (!result.canceled && result.filePath) {
    toast.success(t('XRechnung gespeichert'), { description: result.filePath })
  }
}

export default function InvoicePrintPage() {
  const { invoiceId } = useParams({ strict: false })
  // Opened to send a Zahlungserinnerung or Mahnung (from the invoice page or Dashboard)
  const { email: reminder } = useSearch({ strict: false }) as { email?: ReminderKind }
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

  // Layout and language are picked here and never stored. The layout starts as the
  // Geschäftsbrief; the language follows the recipient's country (English abroad, except
  // German-speaking countries) until one is picked (state adjustment during render, per
  // "You Might Not Need an Effect")
  const [layout, setLayout] = useState<InvoiceLayout>('letter')
  const [suggestedLang, setSuggestedLang] = useState<DocumentLang>('de')
  const [suggestedFor, setSuggestedFor] = useState<InvoicePrintDto | undefined>(undefined)
  if (data && suggestedFor !== data) {
    setSuggestedFor(data)
    setSuggestedLang(suggestDocumentLang(data))
  }
  const [pickedLang, setLang] = useState<DocumentLang | null>(null)
  const lang = pickedLang ?? suggestedLang

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
        {t('Rechnung wird geladen…')}
      </div>
    )
  }

  if (printQuery.isError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{t('Rechnung nicht gefunden.')}</p>
        <Button variant="outline" onClick={() => navigate({ to: '/invoices' })}>
          <ArrowLeft className="h-4 w-4" /> {t('Zurück zu den Rechnungen')}
        </Button>
      </div>
    )
  }

  // e.g. "Rechnung_1040_Soundwave Records", "Rechnung_Entwurf_Soundwave Records",
  // "Rechnung_2026783_The New Roses_Managementbeteiligung 4. Quartal 2025"
  // English documents get an English file name ("Invoice_1040_Soundwave Records")
  const { invoice } = data
  const words = FILE_NAME_WORDS[lang]
  const fileName = buildFileName([
    invoice.kind === 'cancellation' ? words.cancellation : words.invoice,
    invoice.invoiceNumber ?? words.draft,
    data.managementShare?.bandName || data.recipient?.legalName || invoice.recipientName,
    data.managementShare ? `${words.share} ${invoice.periodLabel}` : null,
    invoice.status === 'cancelled' ? words.cancelled : null
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
          <ArrowLeft className="h-4 w-4" /> {t('Zurück')}
        </Button>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Select value={layout} onValueChange={(value) => setLayout(value as InvoiceLayout)}>
            <SelectTrigger
              className={`w-[160px] ${TOOLBAR_SELECT_CLASS}`}
              aria-label={t('Vorlage')}
            >
              <SelectValue placeholder={t('Vorlage')} />
            </SelectTrigger>
            <SelectContent>
              {INVOICE_LAYOUTS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DocumentLanguageSelect value={lang} onChange={setLang} />
          {eInvoice.data?.xrechnung && eInvoice.data.state === 'ready' && (
            <Button variant="outline" onClick={() => void saveXRechnung(invoice.id, fileName)}>
              <FileCode className="h-4 w-4" /> {t('XRechnung (XML)')}
            </Button>
          )}
          {/* Drafts have no number yet and are not sent */}
          {invoice.status !== 'draft' && (
            <InvoiceEmailButton
              invoiceId={invoice.id}
              fileName={fileName}
              lang={lang}
              kind={reminder}
            />
          )}
          {invoice.status !== 'draft' && invoice.createdInDatev && (
            <span className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm text-muted-foreground">
              {t('In DATEV erstellt')}
            </span>
          )}
          {invoice.status !== 'draft' && !invoice.createdInDatev && (
            <InvoiceDatevButton
              invoiceId={invoice.id}
              companyId={invoice.companyId}
              fileName={fileName}
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

      <div className="mx-auto mb-4 w-[210mm] empty:hidden print:hidden">
        <ForeignRecipientHint
          data={data}
          lang={lang}
          suggestedLang={suggestedLang}
          onUseLang={setLang}
        />
      </div>

      <InvoiceDocument
        data={data}
        layout={layout}
        lang={lang}
        logoUrl={logoUrl}
        paymentQr={settings.data?.paymentQr ?? true}
      />
    </div>
  )
}
