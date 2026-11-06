import { useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { toast } from '@/lib/toast'
import { trpcReact } from '@/lib/trpc'
import { doneLabel, germanDate } from '@/lib/followUps'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { RecordLink } from './FollowUpList'

const PAGE = 50

/** #52: done follow-ups, the last ticked off first, each one can be opened again */
export function FollowUpHistoryDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Erledigte Wiedervorlagen</DialogTitle>
          <DialogDescription>
            Zuletzt erledigte zuerst. „Wieder öffnen“ holt eine zurück in die offenen.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted per opening: starts with the first page again */}
        {open && <History />}
      </DialogContent>
    </Dialog>
  )
}

function History() {
  const [limit, setLimit] = useState(PAGE)
  const utils = trpcReact.useUtils()
  const query = trpcReact.followUp.listDone.useQuery({ limit }, { keepPreviousData: true })
  const reopen = trpcReact.followUp.setDone.useMutation({
    onSuccess: () => {
      void utils.followUp.invalidate()
      toast.success('Wiedervorlage wieder offen')
    },
    onError: (error) => toast.error('Änderung fehlgeschlagen', { description: error.message })
  })

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Wird geladen…</p>
  }
  const items = query.data?.items ?? []
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">Noch keine erledigten Wiedervorlagen.</p>
  }

  return (
    <div className="max-h-[60vh] overflow-y-auto pr-1">
      <ul className="divide-y" aria-label="Erledigte Wiedervorlagen">
        {items.map((followUp) => (
          <li key={followUp.id} className="flex items-start gap-3 py-2 first:pt-0">
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-line text-sm text-muted-foreground line-through decoration-muted-foreground/40">
                {followUp.note}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {followUp.doneAt ? doneLabel(followUp.doneAt) : 'Erledigt'}
                {` · fällig ${germanDate(followUp.dueDate)} · `}
                {followUp.record ? <RecordLink record={followUp.record} /> : 'Allgemein'}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              aria-label={`Wieder öffnen: ${followUp.note}`}
              disabled={reopen.isLoading}
              onClick={() => reopen.mutate({ id: followUp.id, done: false })}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Wieder öffnen
            </Button>
          </li>
        ))}
      </ul>
      {query.data?.hasMore && (
        <Button
          variant="link"
          className="mt-2 h-auto p-0 text-sm text-muted-foreground hover:text-foreground"
          disabled={query.isFetching}
          onClick={() => setLimit((current) => current + PAGE)}
        >
          Ältere anzeigen
        </Button>
      )}
    </div>
  )
}
