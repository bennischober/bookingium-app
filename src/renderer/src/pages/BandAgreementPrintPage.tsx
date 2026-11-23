import { useState } from 'react'
import { useParams, useNavigate, useRouter, useCanGoBack } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { PrintActions } from '@/components/print/PrintActions'
import { buildFileName } from '@/lib/fileName'
import { PublishingAgreementDocument } from '@/components/contract/PublishingAgreementDocument'
import { LabelAgreementDocument } from '@/components/contract/LabelAgreementDocument'
import { AGREEMENT_FILE_NAMES } from '@/components/contract/contractLanguage'
import {
  DocumentLanguageSelect,
  type DocumentLang
} from '@/components/print/DocumentLanguageSelect'
import { contractEmailLang } from '../../../main/mail/contractEmail'
import { useStoredImageUrl } from '@/hooks/useStoredImageUrl'
import { t } from '../../../main/i18n/translate'

/** Print page of a publishing or label agreement, in German or English */
export default function BandAgreementPrintPage() {
  const { agreementId } = useParams({ strict: false })
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const id = Number(agreementId)

  // Reads live master data (companies, band): never render a cached copy
  const printQuery = trpcReact.bandAgreement.getPrintData.useQuery(id, {
    enabled: Number.isFinite(id) && id > 0,
    cacheTime: 0
  })
  const data = printQuery.data
  const letterhead = useStoredImageUrl(data?.companyLogoPath || undefined)
  // A label head of agreement starts in English (its reviewed template); a publishing contract
  // from the band company's country
  const [pickedLang, setLang] = useState<DocumentLang | null>(null)
  const lang =
    pickedLang ??
    (data?.agreement.kind === 'label' ? 'en' : contractEmailLang(data?.artist?.country))

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

  const fileName = buildFileName([
    AGREEMENT_FILE_NAMES[data.agreement.kind][lang],
    data.band.name,
    data.agreement.startDate ?? data.agreement.createdAt.slice(0, 10)
  ])

  return (
    <div className="min-h-screen bg-neutral-200 py-8 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <Button
          variant="outline"
          onClick={() => (canGoBack ? router.history.back() : navigate({ to: '/band' }))}
        >
          <ArrowLeft className="h-4 w-4" /> {t('Zurück')}
        </Button>
        <div className="flex items-center gap-2">
          <DocumentLanguageSelect value={lang} onChange={setLang} />
          <PrintActions fileName={fileName} />
        </div>
      </div>

      {data.agreement.kind === 'publishing' ? (
        <PublishingAgreementDocument
          data={{ ...data, agreement: data.agreement }}
          lang={lang}
          letterheadUrl={letterhead ?? undefined}
        />
      ) : (
        <LabelAgreementDocument
          data={{ ...data, agreement: data.agreement }}
          lang={lang}
          letterheadUrl={letterhead ?? undefined}
        />
      )}
    </div>
  )
}
