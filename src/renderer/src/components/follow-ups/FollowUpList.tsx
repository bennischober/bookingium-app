import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Check, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { trpcReact } from '@/lib/trpc'
import { cn } from '@/lib/utils'
import { dueLabel, dueState, localIsoDate } from '@/lib/followUps'
import { RowActionButton } from '@/components/row-action-button'
import { FollowUpDialog } from './FollowUpDialog'
import type { FollowUpDto } from '../../../../main/api/schemas/followUp.schema'

const DUE_STYLES = {
  overdue: 'text-red-700 dark:text-red-400 font-medium',
  today: 'text-amber-700 dark:text-amber-400 font-medium',
  upcoming: 'text-muted-foreground'
} as const

/** Marks a follow-up done, with "Rückgängig" in the toast */
function useSetDone() {
  const utils = trpcReact.useUtils()
  const setDone = trpcReact.followUp.setDone.useMutation({
    onSuccess: () => void utils.followUp.invalidate(),
    onError: (error) => toast.error('Änderung fehlgeschlagen', { description: error.message })
  })
  return (followUp: FollowUpDto) =>
    setDone.mutate(
      { id: followUp.id, done: true },
      {
        onSuccess: () =>
          toast.success('Wiedervorlage erledigt', {
            description: followUp.note,
            action: {
              label: 'Rückgängig',
              onClick: () => setDone.mutate({ id: followUp.id, done: false })
            }
          })
      }
    )
}

/** The record a follow-up is on, as a link to its page */
function RecordLink({ record }: { record: NonNullable<FollowUpDto['record']> }) {
  const className = 'hover:text-foreground hover:underline'
  const id = String(record.id)
  switch (record.type) {
    case 'event':
      return (
        <Link to="/events/$eventId" params={{ eventId: id }} className={className}>
          {record.name}
        </Link>
      )
    case 'band':
      return (
        <Link to="/band/$bandId" params={{ bandId: id }} className={className}>
          {record.name}
        </Link>
      )
    case 'venue':
      return (
        <Link to="/venues/$venueId" params={{ venueId: id }} className={className}>
          {record.name}
        </Link>
      )
    case 'company':
      return (
        <Link to="/companies/$companyId" params={{ companyId: id }} className={className}>
          {record.name}
        </Link>
      )
    case 'person':
      return (
        <Link to="/persons/$personId" params={{ personId: id }} className={className}>
          {record.name}
        </Link>
      )
    case 'invoice':
      // No page of its own: the invoices list opens it in the sheet
      return (
        <Link to="/invoices" search={{ open: record.id }} className={className}>
          {record.name}
        </Link>
      )
  }
}

/**
 * Open follow-ups as rows: tick off, edit, and (showRecord) a link to the
 * record each one is on.
 */
export function FollowUpList({
  followUps,
  showRecord = false
}: {
  followUps: FollowUpDto[]
  showRecord?: boolean
}) {
  // Kept after closing, so the dialog doesn't change while it fades out
  const [editing, setEditing] = useState<FollowUpDto | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const markDone = useSetDone()
  const today = localIsoDate()

  return (
    <>
      <ul className="divide-y">
        {followUps.map((followUp) => (
          <li key={followUp.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
            <button
              type="button"
              title="Erledigt"
              aria-label={`Erledigt: ${followUp.note}`}
              onClick={() => markDone(followUp)}
              className="group mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/50 hover:border-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Check className="size-3 text-primary opacity-0 group-hover:opacity-100" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-line text-sm">{followUp.note}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span className={cn(DUE_STYLES[dueState(followUp.dueDate, today)])}>
                  {dueLabel(followUp.dueDate, today)}
                </span>
                {showRecord && (
                  <>
                    {' · '}
                    {followUp.record ? <RecordLink record={followUp.record} /> : 'Allgemein'}
                  </>
                )}
              </p>
            </div>
            <RowActionButton
              icon={Pencil}
              label="Bearbeiten"
              onClick={() => {
                setEditing(followUp)
                setEditOpen(true)
              }}
            />
          </li>
        ))}
      </ul>

      <FollowUpDialog open={editOpen} onOpenChange={setEditOpen} followUp={editing ?? undefined} />
    </>
  )
}
