import { useParams, useNavigate, useRouter, useCanGoBack } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { PrintActions } from '@/components/print/PrintActions'
import { buildFileName } from '@/lib/fileName'
import { ContractDocument } from '@/components/contract/ContractDocument'
import { useStoredImageUrl } from '@/hooks/useStoredImageUrl'

export default function ContractPrintPage() {
  const { eventId } = useParams({ strict: false })
  const navigate = useNavigate()
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const id = Number(eventId)

  // The contract reads live master data (band, companies, people, event), so
  // any edit elsewhere can change it: never render a cached copy
  const contractQuery = trpcReact.contract.getData.useQuery(id, {
    enabled: Number.isFinite(id) && id > 0,
    cacheTime: 0
  })

  const data = contractQuery.data
  const letterhead = useStoredImageUrl(data?.letterheadLogoPath || undefined)
  // The VP1 signature belongs to the issuing agency (the "vertreten durch"
  // company), falling back to the band company's signature
  const signaturePath = data?.representative?.signaturePath || data?.artist?.signaturePath || ''
  const artistSignature = useStoredImageUrl(signaturePath || undefined)

  if (contractQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Vertrag wird geladen…
      </div>
    )
  }

  if (contractQuery.isError || !data) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Vertrag nicht gefunden.</p>
        <Button variant="outline" onClick={() => navigate({ to: '/events' })}>
          <ArrowLeft className="h-4 w-4" /> Zurück zu den Events
        </Button>
      </div>
    )
  }

  // e.g. "Konzertvertrag_Pretty Wild_Berghain_2026-10-21"
  const fileName = buildFileName([
    'Konzertvertrag',
    data.band?.name,
    data.venue?.name,
    data.dealMemo.date
  ])

  return (
    <div className="min-h-screen bg-neutral-200 py-8 print:bg-white print:py-0">
      {/* Screen-only toolbar */}
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <Button
          variant="outline"
          // Back to the event tab the contract was opened from; the event
          // itself when opened directly
          onClick={() =>
            canGoBack
              ? router.history.back()
              : navigate({ to: '/events/$eventId', params: { eventId: String(id) } })
          }
        >
          <ArrowLeft className="h-4 w-4" /> Zurück
        </Button>
        <div className="flex items-center gap-2">
          <PrintActions fileName={fileName} />
        </div>
      </div>

      <ContractDocument
        data={data}
        letterheadUrl={letterhead ?? undefined}
        artistSignatureUrl={artistSignature ?? undefined}
      />
    </div>
  )
}
