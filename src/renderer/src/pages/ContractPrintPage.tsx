import { useEffect, useState } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { PrintActions } from '@/components/print/PrintActions'
import { buildFileName } from '@/lib/fileName'
import { ContractDocument } from '@/components/contract/ContractDocument'

// Resolves a stored relative image path to a data URL via IPC (null if empty/missing)
function useStoredImageUrl(relativePath: string | undefined): string | null {
  const [resolved, setResolved] = useState<{ path: string; url: string | null }>({
    path: '',
    url: null
  })

  const path = relativePath ?? ''

  // Reset synchronously during render when the path changes; async IPC load
  // stays in an effect (state adjustment pattern, per "You Might Not Need an
  // Effect")
  if (resolved.path !== path) {
    setResolved({ path, url: null })
  }

  useEffect(() => {
    if (!path) return
    let active = true
    void window.api.getLogoPath(path).then((result) => {
      if (!active) return
      if (result.success && result.dataUrl) {
        setResolved({ path, url: result.dataUrl })
      }
    })
    return () => {
      active = false
    }
  }, [path])

  return resolved.url
}

export default function ContractPrintPage() {
  const { eventId } = useParams({ strict: false })
  const navigate = useNavigate()
  const id = Number(eventId)

  const contractQuery = trpcReact.contract.getData.useQuery(id, {
    enabled: Number.isFinite(id) && id > 0
  })

  const data = contractQuery.data
  const artistLogo = useStoredImageUrl(data?.artistLogoPath || undefined)
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
          onClick={() => navigate({ to: '/events/$eventId', params: { eventId: String(id) } })}
        >
          <ArrowLeft className="h-4 w-4" /> Zurück
        </Button>
        <div className="flex items-center gap-2">
          <PrintActions fileName={fileName} />
        </div>
      </div>

      <ContractDocument
        data={data}
        artistImageUrl={artistLogo ?? undefined}
        artistSignatureUrl={artistSignature ?? undefined}
      />
    </div>
  )
}
