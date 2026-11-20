import { useState } from 'react'
import { useParams, useNavigate, useRouter, useCanGoBack } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { PrintActions } from '@/components/print/PrintActions'
import { buildFileName } from '@/lib/fileName'
import { ManagementContractDocument } from '@/components/contract/ManagementContractDocument'
import { ContractEmailButton } from '@/components/contract/ContractEmailButton'
import { CONTRACT_FILE_NAMES } from '@/components/contract/contractLanguage'
import {
  DocumentLanguageSelect,
  type DocumentLang
} from '@/components/print/DocumentLanguageSelect'
import { contractEmailLang } from '../../../main/mail/contractEmail'
import { useStoredImageUrl } from '@/hooks/useStoredImageUrl'
import { t } from '../../../main/i18n/translate'

export default function ManagementContractPrintPage() {
  const { contractId } = useParams({ strict: false })
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const id = Number(contractId)

  // Reads live master data (companies, people, band): never render a cached copy
  const printQuery = trpcReact.managementContract.getPrintData.useQuery(id, {
    enabled: Number.isFinite(id) && id > 0,
    cacheTime: 0
  })

  const data = printQuery.data
  const letterhead = useStoredImageUrl(data?.managementLogoPath || undefined)
  const signature = useStoredImageUrl(data?.management?.signaturePath || undefined)
  // Contract language: from the band company's country until one is picked; the email follows it
  const [pickedLang, setLang] = useState<DocumentLang | null>(null)
  const lang = pickedLang ?? contractEmailLang(data?.artist?.country)

  if (printQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        {t('Vertrag wird geladen…')}
      </div>
    )
  }

  if (printQuery.isError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">{t('Vertrag nicht gefunden.')}</p>
        <Button variant="outline" onClick={() => navigate({ to: '/band' })}>
          <ArrowLeft className="h-4 w-4" /> {t('Zurück zu den Bands')}
        </Button>
      </div>
    )
  }

  // e.g. "Managementvertrag_April Art_2026-10-18"
  const fileName = buildFileName([
    CONTRACT_FILE_NAMES.management[lang],
    data.band.name,
    data.contract.startDate ?? data.contract.createdAt.slice(0, 10)
  ])

  return (
    <div className="min-h-screen bg-neutral-200 py-8 print:bg-white print:py-0">
      {/* Screen-only toolbar */}
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <Button
          variant="outline"
          onClick={() => (canGoBack ? router.history.back() : navigate({ to: '/band' }))}
        >
          <ArrowLeft className="h-4 w-4" /> {t('Zurück')}
        </Button>
        <div className="flex items-center gap-2">
          <DocumentLanguageSelect value={lang} onChange={setLang} />
          <ContractEmailButton contract="management" id={id} fileName={fileName} lang={lang} />
          <PrintActions fileName={fileName} />
        </div>
      </div>

      <ManagementContractDocument
        data={data}
        lang={lang}
        letterheadUrl={letterhead ?? undefined}
        managementSignatureUrl={signature ?? undefined}
      />
    </div>
  )
}
