import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { toast } from '@/lib/toast'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { EInvoicePartySource } from '../../../../main/api/schemas/einvoice_party.schema'
import type { CompanyEnrichmentDto } from '../../../../main/api/schemas/company_enrichment.schema'
import { COMPANY_ENRICHMENT_EVENT } from './companyEnrichmentEvents'
import { t } from '../../../../main/i18n/translate'

/** The confirmation: every value the invoice adds, then "Übernehmen" */
export function CompanyEnrichmentDialog({
  enrichment,
  onClose
}: {
  enrichment: CompanyEnrichmentDto
  onClose: () => void
}) {
  const utils = trpcReact.useUtils()
  const apply = trpcReact.companyEnrichment.apply.useMutation({
    onSuccess: () => {
      void utils.company.invalidate()
      void utils.companyEnrichment.invalidate()
      toast.success(t('{{companyName}} ergänzt', { companyName: enrichment.companyName }))
      onClose()
    },
    onError: (error) =>
      toast.error(t('Firma konnte nicht ergänzt werden'), { description: error.message })
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {enrichment.companyName} {t('ergänzen')}
          </DialogTitle>
          <DialogDescription>
            {enrichment.origin === 'einvoice'
              ? t('Aus den Daten der E-Rechnung.')
              : t('Aus dem Text der Rechnung gelesen – bitte kurz prüfen.')}{' '}
            {t('Nur leere Felder werden gefüllt, nichts wird überschrieben.')}
          </DialogDescription>
        </DialogHeader>
        <dl
          className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm"
          aria-label={t('Angaben')}
        >
          {enrichment.fills.map((fill) => (
            <div key={fill.key} className="contents">
              <dt className="text-muted-foreground">{fill.label}</dt>
              <dd className="break-words">{fill.value}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Abbrechen')}
          </Button>
          <Button
            disabled={apply.isPending}
            onClick={() =>
              apply.mutate({ companyId: enrichment.companyId, party: enrichment.party })
            }
          >
            {t('Übernehmen')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * #236: under an invoice attachment of a known company with empty fields - "CARGO RECORDS:
 * 6 Angaben aus der Rechnung ergänzen". Shows nothing when there is nothing to add.
 */
export function CompanyEnrichmentHint({
  source,
  senderEmail
}: {
  source: EInvoicePartySource
  senderEmail: string
}) {
  const [open, setOpen] = useState(false)
  const check = trpcReact.companyEnrichment.check.useQuery(
    { source, senderEmail },
    { staleTime: 60_000, retry: false }
  )
  const enrichment = check.data
  if (!enrichment) return null
  const count = enrichment.fills.length
  return (
    <>
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm dark:bg-amber-950"
        role="status"
      >
        <Building2 className="h-4 w-4 shrink-0 text-amber-700" />
        <span>
          <strong>{enrichment.companyName}</strong>: {count}{' '}
          {count === 1 ? t('Angabe') : t('Angaben')} {t('aus der Rechnung ergänzen (')}
          {enrichment.fills.map((fill) => fill.label).join(', ')})
        </span>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {t('Ergänzen…')}
        </Button>
      </div>
      {open && <CompanyEnrichmentDialog enrichment={enrichment} onClose={() => setOpen(false)} />}
    </>
  )
}

/** In the root layout: shows the confirmation openCompanyEnrichment asked for */
export function CompanyEnrichmentHost() {
  const [enrichment, setEnrichment] = useState<CompanyEnrichmentDto | null>(null)
  useEffect(() => {
    const listener = (event: Event) =>
      setEnrichment((event as CustomEvent<CompanyEnrichmentDto>).detail)
    window.addEventListener(COMPANY_ENRICHMENT_EVENT, listener)
    return () => window.removeEventListener(COMPANY_ENRICHMENT_EVENT, listener)
  }, [])
  return enrichment ? (
    <CompanyEnrichmentDialog enrichment={enrichment} onClose={() => setEnrichment(null)} />
  ) : null
}
