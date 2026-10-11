import { useEffect, useState } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Printer } from 'lucide-react'
import { trpcReact } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
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
  const artistSignature = useStoredImageUrl(data?.artist?.signaturePath || undefined)

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

  return (
    <div className="min-h-screen bg-neutral-200 py-8 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 0; }`}</style>

      {/* Screen-only toolbar */}
      <div className="mx-auto mb-4 flex w-[210mm] items-center justify-between print:hidden">
        <Button
          variant="outline"
          onClick={() => navigate({ to: '/events/$eventId', params: { eventId: String(id) } })}
        >
          <ArrowLeft className="h-4 w-4" /> Zurück
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Drucken / Als PDF speichern
        </Button>
      </div>

      <ContractDocument
        data={data}
        artistImageUrl={artistLogo ?? undefined}
        artistSignatureUrl={artistSignature ?? undefined}
      />
    </div>
  )
}
